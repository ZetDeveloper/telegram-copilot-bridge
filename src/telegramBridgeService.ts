import * as vscode from "vscode";
import { StreamEvent, TelegramBridgeState, TelegramMessageEvent, UiNotice } from "./types";

type TelegramApiResponse<T> = {
  ok: boolean;
  result: T;
  description?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramIncomingMessage;
  edited_message?: TelegramIncomingMessage;
  channel_post?: TelegramIncomingMessage;
};

type TelegramIncomingMessage = {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  from?: {
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  chat?: {
    id: number | string;
    title?: string;
    username?: string;
    type?: string;
  };
};

type TelegramGetMeResult = {
  id: number;
  is_bot: boolean;
  first_name?: string;
  username?: string;
};

type TelegramConfig = {
  pollingEnabled: boolean;
  pollIntervalMs: number;
  longPollTimeoutSeconds: number;
  allowedChatIds: string[];
  openChatOnMessage: boolean;
  autoReplyEnabled: boolean;
  promptPrefix: string;
  maxStreamItems: number;
};

const BOT_TOKEN_SECRET_KEY = "telegramCopilot.botToken";
const LAST_UPDATE_ID_KEY = "telegramCopilot.lastUpdateId";

export class TelegramBridgeService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<TelegramBridgeState>();
  private readonly output = vscode.window.createOutputChannel("Telegram Copilot Bridge");
  private readonly state: TelegramBridgeState = {
    configured: false,
    running: false,
    mode: "polling",
    tokenStored: false,
    lastStartAt: null,
    lastProbeAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastError: null,
    lastPrompt: null,
    lastUpdateId: null,
    bot: null,
    allowedChatIds: [],
    openChatOnMessage: true,
    autoReplyEnabled: false,
    pollingEnabled: true,
    pollIntervalMs: 2000,
    longPollTimeoutSeconds: 25,
    modelAccess: "unknown",
    lastNotice: null,
    stream: [],
  };

  private pollAbortController: AbortController | null = null;
  private pollLoopPromise: Promise<void> | null = null;

  public readonly onDidChangeState = this.emitter.event;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.output.appendLine("Telegram Copilot Bridge initialized.");
  }

  public async initialize(): Promise<void> {
    await this.refreshStateFromStorage();
    await this.probeBot(false);
    if (this.state.tokenStored && this.state.pollingEnabled) {
      void this.startPolling();
    }
  }

  public dispose(): void {
    void this.stopPolling();
    this.emitter.dispose();
    this.output.dispose();
  }

  public getState(): TelegramBridgeState {
    return {
      ...this.state,
      allowedChatIds: [...this.state.allowedChatIds],
      stream: [...this.state.stream],
      bot: this.state.bot ? { ...this.state.bot } : null,
      lastNotice: this.state.lastNotice ? { ...this.state.lastNotice } : null,
    };
  }

  public async refreshStateFromStorage(): Promise<void> {
    const config = this.readConfig();
    const token = await this.getToken();
    this.state.tokenStored = Boolean(token);
    this.state.configured = Boolean(token);
    this.state.pollingEnabled = config.pollingEnabled;
    this.state.pollIntervalMs = config.pollIntervalMs;
    this.state.longPollTimeoutSeconds = config.longPollTimeoutSeconds;
    this.state.allowedChatIds = config.allowedChatIds;
    this.state.openChatOnMessage = config.openChatOnMessage;
    this.state.autoReplyEnabled = config.autoReplyEnabled;
    this.state.lastUpdateId = this.context.globalState.get<number | null>(LAST_UPDATE_ID_KEY, null);
    this.updateModelAccess();
    this.emitState();
  }

  public async saveToken(token: string): Promise<void> {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      throw new Error("Bot token is required.");
    }
    await this.context.secrets.store(BOT_TOKEN_SECRET_KEY, normalizedToken);
    this.pushEvent("system", "Token saved", "Telegram bot token stored in VS Code secrets.");
    this.setNotice("success", "Telegram bot token saved in VS Code secrets.");
    await this.refreshStateFromStorage();
    await this.probeBot(false);
    this.emitState();
  }

  public async clearToken(): Promise<void> {
    await this.context.secrets.delete(BOT_TOKEN_SECRET_KEY);
    await this.stopPolling();
    this.state.bot = null;
    this.state.lastError = null;
    this.pushEvent("system", "Token removed", "Telegram bot token removed from VS Code secrets.");
    this.setNotice("info", "Telegram bot token removed.");
    await this.refreshStateFromStorage();
    this.emitState();
  }

  public async saveConfiguration(payload: {
    allowedChatIds: string[];
    openChatOnMessage: boolean;
    autoReplyEnabled: boolean;
    pollingEnabled: boolean;
    pollIntervalMs: number;
    longPollTimeoutSeconds: number;
  }): Promise<void> {
    const config = vscode.workspace.getConfiguration("telegramCopilot");
    await Promise.all([
      config.update("allowedChatIds", payload.allowedChatIds, vscode.ConfigurationTarget.Workspace),
      config.update(
        "openChatOnMessage",
        payload.openChatOnMessage,
        vscode.ConfigurationTarget.Workspace,
      ),
      config.update(
        "autoReplyEnabled",
        payload.autoReplyEnabled,
        vscode.ConfigurationTarget.Workspace,
      ),
      config.update("pollingEnabled", payload.pollingEnabled, vscode.ConfigurationTarget.Workspace),
      config.update("pollIntervalMs", payload.pollIntervalMs, vscode.ConfigurationTarget.Workspace),
      config.update(
        "longPollTimeoutSeconds",
        payload.longPollTimeoutSeconds,
        vscode.ConfigurationTarget.Workspace,
      ),
    ]);
    await this.refreshStateFromStorage();
    this.pushEvent("system", "Config updated", "Telegram bridge configuration saved to workspace settings.");
    this.setNotice("success", "Telegram configuration saved to workspace settings.");
    this.emitState();
  }

  public async startPolling(): Promise<void> {
    if (this.state.running) {
      this.setNotice("info", "Telegram polling is already running.");
      this.emitState();
      return;
    }
    const token = await this.getRequiredToken();
    this.state.running = true;
    this.state.lastStartAt = Date.now();
    this.state.lastError = null;
    this.pollAbortController = new AbortController();
    this.pushEvent("system", "Polling started", "Listening for Telegram messages with getUpdates.");
    this.setNotice("success", "Telegram polling started.");
    this.emitState();

    this.pollLoopPromise = this.runPollLoop(token, this.pollAbortController.signal).finally(() => {
      this.state.running = false;
      this.pollAbortController = null;
      this.pollLoopPromise = null;
      this.emitState();
    });
  }

  public async stopPolling(): Promise<void> {
    if (!this.state.running) {
      this.setNotice("info", "Telegram polling is already stopped.");
      this.emitState();
      return;
    }
    this.pollAbortController?.abort();
    try {
      await this.pollLoopPromise;
    } catch {
      // The loop already records the error state when needed.
    }
    this.pushEvent("system", "Polling stopped", "Telegram polling loop stopped.");
    this.setNotice("info", "Telegram polling stopped.");
    this.emitState();
  }

  public async probeBot(showNotification = true): Promise<void> {
    const token = await this.getToken();
    if (!token) {
      this.state.bot = null;
      this.state.lastProbeAt = Date.now();
      this.state.lastError = "Telegram token not configured.";
      this.setNotice("warning", "Telegram bot token is not configured.");
      this.emitState();
      if (showNotification) {
        void vscode.window.showWarningMessage("Telegram bot token is not configured.");
      }
      return;
    }

    try {
      const result = await this.callTelegram<TelegramGetMeResult>(token, "getMe", undefined, undefined);
      this.state.bot = {
        id: result.id,
        username: result.username,
        firstName: result.first_name,
      };
      this.state.lastProbeAt = Date.now();
      this.state.lastError = null;
      this.setNotice(
        "success",
        result.username ? `Connected as @${result.username}.` : "Telegram bot probe succeeded.",
      );
      this.pushEvent(
        "system",
        "Probe OK",
        result.username ? `Connected as @${result.username}.` : "Telegram bot probe succeeded.",
      );
      this.emitState();
      if (showNotification) {
        void vscode.window.showInformationMessage(
          result.username ? `Telegram bot connected: @${result.username}` : "Telegram bot probe succeeded.",
        );
      }
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.state.lastProbeAt = Date.now();
      this.state.lastError = message;
      this.setNotice("error", message);
      this.pushEvent("error", "Probe failed", message);
      this.emitState();
      if (showNotification) {
        void vscode.window.showErrorMessage(message);
      }
    }
  }

  public clearStream(): void {
    this.state.stream = [];
    this.setNotice("info", "Activity stream cleared.");
    this.emitState();
  }

  public async openLastPrompt(): Promise<void> {
    if (!this.state.lastPrompt) {
      this.setNotice("warning", "No prompt has been generated yet.");
      this.emitState();
      void vscode.window.showInformationMessage("No prompt has been generated yet.");
      return;
    }
    await this.openCopilotChat(this.state.lastPrompt);
  }

  public async onConfigurationChanged(): Promise<void> {
    const wasPolling = this.state.running;
    await this.refreshStateFromStorage();
    if (wasPolling && !this.state.pollingEnabled) {
      await this.stopPolling();
    }
    if (!wasPolling && this.state.pollingEnabled && this.state.tokenStored) {
      void this.startPolling();
    }
  }

  public updateModelAccess(): void {
    void this.refreshModelAccess();
  }

  private async refreshModelAccess(): Promise<void> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      const model = models[0];
      if (!model) {
        this.state.modelAccess = "unavailable";
        this.emitState();
        return;
      }
      const canSend = this.context.languageModelAccessInformation.canSendRequest(model);
      if (canSend === true) {
        this.state.modelAccess = "granted";
      } else if (canSend === false) {
        this.state.modelAccess = "not-granted";
      } else {
        this.state.modelAccess = "unknown";
      }
    } catch {
      this.state.modelAccess = "unavailable";
    }
    this.emitState();
  }

  private async runPollLoop(token: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const updates = await this.callTelegram<TelegramUpdate[]>(
          token,
          "getUpdates",
          {
            offset: String((this.state.lastUpdateId ?? 0) + 1),
            timeout: String(this.state.longPollTimeoutSeconds),
            allowed_updates: JSON.stringify(["message", "edited_message", "channel_post"]),
          },
          signal,
        );

        for (const update of updates) {
          if (signal.aborted) {
            break;
          }
          await this.handleUpdate(update);
        }

        if (signal.aborted) {
          break;
        }
        await this.delay(this.state.pollIntervalMs, signal);
      } catch (error) {
        if (signal.aborted) {
          break;
        }
        const message = this.getErrorMessage(error);
        this.state.lastError = message;
        this.setNotice("error", message);
        this.pushEvent("error", "Polling error", message);
        this.emitState();
        await this.delay(Math.max(this.state.pollIntervalMs, 1500), signal);
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    this.state.lastUpdateId = update.update_id;
    await this.context.globalState.update(LAST_UPDATE_ID_KEY, update.update_id);

    const message = update.message ?? update.edited_message ?? update.channel_post;
    if (!message?.chat) {
      return;
    }

    const chatId = String(message.chat.id);
    const text = (message.text ?? message.caption ?? "[non-text message]").trim();
    const username = message.from?.username ?? message.chat.username ?? message.chat.title;
    const event: TelegramMessageEvent = { chatId, username, text };

    this.state.lastInboundAt = Date.now();
    this.pushEvent(
      "inbound",
      username ? `Message from ${username}` : `Message from ${chatId}`,
      text,
      chatId,
      username,
    );

    if (!this.isAllowedChat(chatId)) {
      this.setNotice("warning", `Ignored message from chat ${chatId} because it is not in the allowlist.`);
      this.pushEvent(
        "system",
        "Ignored message",
        `Chat ${chatId} is not in the allowlist, so the message was not forwarded.`,
        chatId,
        username,
      );
      this.emitState();
      return;
    }

    const prompt = this.buildPrompt(event);
    this.state.lastPrompt = prompt;
    this.setNotice("success", `Telegram message received from ${username ?? chatId}.`);
    this.emitState();

    if (this.state.openChatOnMessage) {
      await this.openCopilotChat(prompt);
    }

    if (this.state.autoReplyEnabled) {
      await this.generateAndSendReply(chatId, prompt, username);
    }
  }

  private buildPrompt(event: TelegramMessageEvent): string {
    const prefix = this.readConfig().promptPrefix.trim();
    const pieces = [
      prefix,
      "",
      "Nuevo mensaje entrante desde Telegram.",
      `Chat ID: ${event.chatId}`,
      `Usuario: ${event.username ?? "desconocido"}`,
      "",
      "Mensaje:",
      event.text,
      "",
      "Responde pensando en el workspace abierto en VS Code.",
    ];
    return pieces.join("\n").trim();
  }

  private async openCopilotChat(prompt: string): Promise<void> {
    await vscode.env.clipboard.writeText(prompt);

    try {
      await vscode.commands.executeCommand("workbench.action.chat.open", { query: prompt });
      this.pushEvent("system", "Copilot chat opened", "Prompt forwarded to the GitHub Copilot Chat panel.");
      this.setNotice("success", "GitHub Copilot Chat opened with the Telegram prompt.");
      this.emitState();
      return;
    } catch {
      // Fall back to opening chat without a prefilled query.
    }

    try {
      await vscode.commands.executeCommand("workbench.action.chat.open");
      this.pushEvent(
        "system",
        "Copilot chat opened",
        "Chat opened. The prompt was copied to the clipboard because prefilling is not supported by this build.",
      );
      this.setNotice(
        "info",
        "GitHub Copilot Chat opened. The prompt was copied to the clipboard because prefilling is not supported by this build.",
      );
      this.emitState();
    } catch (error) {
      this.setNotice("error", `Could not open GitHub Copilot Chat: ${this.getErrorMessage(error)}`);
      this.pushEvent(
        "error",
        "Chat open failed",
        `Could not open GitHub Copilot Chat: ${this.getErrorMessage(error)}`,
      );
      this.emitState();
    }
  }

  private async generateAndSendReply(
    chatId: string,
    prompt: string,
    username?: string,
  ): Promise<void> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      const model = models[0];
      if (!model) {
        throw new Error("No Copilot-compatible chat model is available in this VS Code session.");
      }

      const canSend = this.context.languageModelAccessInformation.canSendRequest(model);
      if (canSend !== true) {
        throw new Error(
          "The extension does not have permission to call the language model yet. Run a manual action first.",
        );
      }

      const cts = new vscode.CancellationTokenSource();
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(prompt)],
        {
          justification: "Generate a Telegram reply from the local Telegram Copilot Bridge sidebar.",
        },
        cts.token,
      );

      let text = "";
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          text += part.value;
        }
      }

      const normalized = text.trim();
      if (!normalized) {
        throw new Error("The language model returned an empty reply.");
      }

      await this.sendTelegramMessage(chatId, normalized);
      this.state.lastOutboundAt = Date.now();
      this.setNotice("success", `Reply sent to ${username ?? chatId}.`);
      this.pushEvent(
        "outbound",
        username ? `Reply sent to ${username}` : `Reply sent to ${chatId}`,
        normalized,
        chatId,
        username,
      );
      this.emitState();
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.state.lastError = message;
      this.setNotice("error", message);
      this.pushEvent("error", "Auto-reply failed", message, chatId, username);
      this.emitState();
    }
  }

  public showLogs(): void {
    this.output.show(true);
    this.setNotice("info", "Opened Telegram Copilot Bridge output logs.");
    this.emitState();
  }

  private async sendTelegramMessage(chatId: string, text: string): Promise<void> {
    const token = await this.getRequiredToken();
    await this.callTelegram(
      token,
      "sendMessage",
      undefined,
      undefined,
      JSON.stringify({
        chat_id: chatId,
        text,
      }),
    );
  }

  private async callTelegram<T>(
    token: string,
    method: string,
    query?: Record<string, string>,
    signal?: AbortSignal,
    body?: string,
  ): Promise<T> {
    const url = new URL(`https://api.telegram.org/bot${token}/${method}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body,
      signal,
    });

    if (!response.ok) {
      throw new Error(`Telegram API returned ${response.status} ${response.statusText}.`);
    }

    const payload = (await response.json()) as TelegramApiResponse<T>;
    if (!payload.ok) {
      throw new Error(payload.description ?? "Telegram API request failed.");
    }

    return payload.result;
  }

  private async getRequiredToken(): Promise<string> {
    const token = await this.getToken();
    if (!token) {
      throw new Error("Telegram bot token is not configured.");
    }
    return token;
  }

  private async getToken(): Promise<string | undefined> {
    const token = await this.context.secrets.get(BOT_TOKEN_SECRET_KEY);
    return token?.trim() || undefined;
  }

  private isAllowedChat(chatId: string): boolean {
    return this.state.allowedChatIds.length === 0 || this.state.allowedChatIds.includes(chatId);
  }

  private readConfig(): TelegramConfig {
    const config = vscode.workspace.getConfiguration("telegramCopilot");
    const allowedChatIds = config
      .get<string[]>("allowedChatIds", [])
      .map((value) => value.trim())
      .filter(Boolean);

    return {
      pollingEnabled: config.get<boolean>("pollingEnabled", true),
      pollIntervalMs: Math.max(250, config.get<number>("pollIntervalMs", 2000)),
      longPollTimeoutSeconds: Math.max(1, config.get<number>("longPollTimeoutSeconds", 25)),
      allowedChatIds,
      openChatOnMessage: config.get<boolean>("openChatOnMessage", true),
      autoReplyEnabled: config.get<boolean>("autoReplyEnabled", false),
      promptPrefix: config.get<string>("promptPrefix", "@workspace"),
      maxStreamItems: Math.max(10, config.get<number>("maxStreamItems", 100)),
    };
  }

  private pushEvent(
    direction: StreamEvent["direction"],
    title: string,
    detail: string,
    chatId?: string,
    username?: string,
  ): void {
    const event: StreamEvent = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: Date.now(),
      direction,
      title,
      detail,
      chatId,
      username,
    };

    const maxItems = this.readConfig().maxStreamItems;
    this.state.stream = [event, ...this.state.stream].slice(0, maxItems);
    this.output.appendLine(`[${direction}] ${title}: ${detail}`);
  }

  private setNotice(kind: UiNotice["kind"], message: string): void {
    this.state.lastNotice = {
      kind,
      message,
      timestamp: Date.now(),
    };
  }

  private emitState(): void {
    this.emitter.fire(this.getState());
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private async delay(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(new Error("Aborted"));
      };

      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}