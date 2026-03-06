import * as vscode from "vscode";
import { SidebarConfigPayload, TelegramBridgeState } from "./types";
import { TelegramBridgeService } from "./telegramBridgeService";

type ViewSection = "overview" | "config" | "activity";

type SidebarInboundMessage =
  | { type: "ready" }
  | { type: "saveToken"; value: string }
  | { type: "clearToken" }
  | { type: "saveConfig"; value: SidebarConfigPayload }
  | { type: "openConfigView" }
  | { type: "startPolling" }
  | { type: "stopPolling" }
  | { type: "probeBot" }
  | { type: "clearStream" }
  | { type: "openLastPrompt" }
  | { type: "showLogs" };

export class TelegramSectionViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: TelegramBridgeService,
    private readonly section: ViewSection,
  ) {
    this.disposables.push(this.service.onDidChangeState((state) => void this.postState(state)));
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  public show(preserveFocus = false): void {
    this.webviewView?.show?.(preserveFocus);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message: SidebarInboundMessage) => {
        void this.handleMessage(message);
      }),
    );

    void this.postState(this.service.getState());
  }

  private async handleMessage(message: SidebarInboundMessage): Promise<void> {
    try {
      switch (message.type) {
        case "ready":
          await this.postState(this.service.getState());
          return;
        case "saveToken":
          await this.service.saveToken(message.value);
          void vscode.window.showInformationMessage("Telegram bot token saved.");
          return;
        case "clearToken":
          await this.service.clearToken();
          void vscode.window.showInformationMessage("Telegram bot token removed.");
          return;
        case "saveConfig":
          await this.service.saveConfiguration(message.value);
          void vscode.window.showInformationMessage("Telegram configuration saved.");
          return;
        case "openConfigView":
          await vscode.commands.executeCommand("telegramCopilot.focusConfig");
          return;
        case "startPolling":
          await this.service.startPolling();
          void vscode.window.showInformationMessage("Telegram polling started.");
          return;
        case "stopPolling":
          await this.service.stopPolling();
          void vscode.window.showInformationMessage("Telegram polling stopped.");
          return;
        case "probeBot":
          await this.service.probeBot(true);
          return;
        case "clearStream":
          this.service.clearStream();
          void vscode.window.showInformationMessage("Telegram activity stream cleared.");
          return;
        case "openLastPrompt":
          await this.service.openLastPrompt();
          return;
        case "showLogs":
          this.service.showLogs();
          return;
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async postState(state: TelegramBridgeState): Promise<void> {
    if (!this.webviewView) {
      return;
    }
    await this.webviewView.webview.postMessage({ type: "state", value: state });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "icon.svg"));

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Telegram Copilot Bridge</title>
    <style>
      :root {
        color-scheme: dark light;
        --bg: var(--vscode-sideBar-background);
        --card: color-mix(in srgb, var(--vscode-sideBar-background) 76%, var(--vscode-editorWidget-background) 24%);
        --border: var(--vscode-panel-border);
        --muted: var(--vscode-descriptionForeground);
        --text: var(--vscode-foreground);
        --accent: #5ab2d6;
        --success: #6dd3a0;
        --danger: #f06c7a;
        --warning: #f4c168;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: radial-gradient(circle at top, rgba(90,178,214,0.14), transparent 30%), var(--bg);
        color: var(--text);
        font-family: var(--vscode-font-family);
      }

      .shell {
        padding: 12px;
        display: grid;
        gap: 12px;
      }

      .hero {
        display: grid;
        grid-template-columns: 40px 1fr;
        gap: 10px;
        align-items: center;
        padding: 12px;
        border: 1px solid rgba(90,178,214,0.22);
        background: linear-gradient(160deg, rgba(24,58,74,0.95), rgba(17,31,38,0.9));
        border-radius: 16px;
      }

      .hero img {
        width: 40px;
        height: 40px;
      }

      .hero-title {
        font-size: 14px;
        font-weight: 600;
      }

      .hero-sub {
        margin-top: 2px;
        font-size: 12px;
        color: rgba(231,244,250,0.8);
      }

      .card {
        padding: 12px;
        border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
        background: var(--card);
        border-radius: 16px;
      }

      .card-title {
        font-size: 13px;
        font-weight: 600;
      }

      .card-sub {
        margin-top: 4px;
        font-size: 12px;
        color: var(--muted);
      }

      .status-list {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-top: 12px;
      }

      .status-list > div,
      .stream-item,
      .account-card,
      .mini-card {
        border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
        background: color-mix(in srgb, var(--card) 88%, black 12%);
        border-radius: 14px;
      }

      .status-list > div,
      .mini-card {
        padding: 10px 11px;
      }

      .label {
        display: block;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }

      .value {
        display: block;
        margin-top: 6px;
        font-size: 13px;
        font-weight: 600;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 5px 10px;
        font-size: 11px;
        font-weight: 600;
        margin-top: 10px;
      }

      .badge.success {
        color: #042e1d;
        background: var(--success);
      }

      .badge.warning {
        color: #3b2804;
        background: var(--warning);
      }

      .badge.danger {
        color: #3d0810;
        background: var(--danger);
      }

      .callout {
        margin-top: 12px;
        padding: 11px 12px;
        border-left: 4px solid var(--accent);
        border-radius: 12px;
        background: rgba(90,178,214,0.08);
        font-size: 12px;
        line-height: 1.45;
      }

      .callout.error {
        border-left-color: var(--danger);
        background: rgba(240,108,122,0.08);
      }

      .callout.success {
        border-left-color: var(--success);
        background: rgba(109,211,160,0.08);
      }

      .callout.warning {
        border-left-color: var(--warning);
        background: rgba(244,193,104,0.08);
      }

      .account-card {
        padding: 12px;
      }

      .account-top {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: baseline;
      }

      .account-name {
        font-size: 14px;
        font-weight: 600;
      }

      .account-id {
        font-size: 11px;
        color: var(--muted);
      }

      .fields {
        display: grid;
        gap: 12px;
        margin-top: 12px;
      }

      .field label {
        display: block;
        margin-bottom: 6px;
        font-size: 12px;
        color: var(--muted);
      }

      .field input,
      .field textarea {
        width: 100%;
        border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
        background: color-mix(in srgb, var(--vscode-input-background) 92%, black 8%);
        color: var(--text);
        border-radius: 12px;
        padding: 10px 12px;
        font: inherit;
      }

      .field textarea {
        min-height: 88px;
        resize: vertical;
      }

      .check-row {
        display: grid;
        gap: 10px;
      }

      .check {
        display: flex;
        gap: 10px;
        align-items: center;
        font-size: 12px;
      }

      .check input {
        margin: 0;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 8px 12px;
        font: inherit;
        cursor: pointer;
        color: #f5fbfe;
        background: linear-gradient(180deg, #2b5970, #183a4a);
      }

      button.secondary {
        background: color-mix(in srgb, var(--vscode-button-secondaryBackground) 92%, black 8%);
        color: var(--vscode-button-secondaryForeground);
      }

      button.ghost {
        background: transparent;
        color: var(--text);
        border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
      }

      .stack {
        display: grid;
        gap: 12px;
      }

      .stream {
        display: grid;
        gap: 10px;
        margin-top: 12px;
      }

      .stream-item {
        padding: 12px;
      }

      .stream-meta {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
      }

      .stream-title {
        font-size: 12px;
        font-weight: 600;
      }

      .stream-time {
        font-size: 11px;
        color: var(--muted);
        white-space: nowrap;
      }

      .stream-detail {
        margin-top: 8px;
        font-size: 12px;
        line-height: 1.45;
        white-space: pre-wrap;
      }

      .stream-tags {
        margin-top: 8px;
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .tag {
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(90,178,214,0.12);
        color: var(--accent);
        font-size: 11px;
      }

      .empty {
        padding: 16px;
        border: 1px dashed color-mix(in srgb, var(--border) 72%, transparent);
        border-radius: 14px;
        font-size: 12px;
        color: var(--muted);
      }

      .guide {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }

      .guide-step {
        padding: 11px 12px;
        border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
        background: color-mix(in srgb, var(--card) 88%, black 12%);
        border-radius: 14px;
      }

      .guide-step strong {
        display: block;
        font-size: 12px;
        margin-bottom: 4px;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      ${this.section === "overview"
        ? `<section class="hero">
        <img src="${iconUri}" alt="Telegram Copilot" />
        <div>
          <div class="hero-title">Telegram Copilot Bridge</div>
          <div class="hero-sub">Control GitHub Copilot from a Telegram bot.</div>
        </div>
      </section>`
        : ""}
      <div id="content"></div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const section = ${JSON.stringify(this.section)};
      const content = document.getElementById('content');

      function relativeTime(value) {
        if (!value) {
          return 'n/a';
        }

        const seconds = Math.max(1, Math.round((Date.now() - value) / 1000));
        if (seconds < 60) {
          return seconds + 's ago';
        }
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) {
          return minutes + 'm ago';
        }
        const hours = Math.round(minutes / 60);
        if (hours < 48) {
          return hours + 'h ago';
        }
        const days = Math.round(hours / 24);
        return days + 'd ago';
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function badgeClass(kind) {
        if (kind === 'granted' || kind === true) {
          return 'success';
        }
        if (kind === 'not-granted' || kind === false) {
          return 'warning';
        }
        if (kind === 'danger' || kind === 'error') {
          return 'danger';
        }
        return 'warning';
      }

      function noticeHtml(state) {
        if (!state.lastNotice) {
          return '';
        }
        return '<div class="callout ' + escapeHtml(state.lastNotice.kind) + '">' + escapeHtml(state.lastNotice.message) + ' · ' + escapeHtml(relativeTime(state.lastNotice.timestamp)) + '</div>';
      }

      function renderOverview(state) {
        if (!state.configured) {
          content.innerHTML = [
            noticeHtml(state),
            '<section class="card">',
            '  <div class="card-title">No Telegram Configuration Yet</div>',
            '  <div class="card-sub">This bridge needs a Telegram bot token before it can receive messages and forward prompts to GitHub Copilot.</div>',
            '  <div class="callout warning">Create a bot with @BotFather in Telegram, copy the token, then save it in Telegram Config.</div>',
            '  <div class="guide">',
            '    <div class="guide-step"><strong>1. Create the bot</strong>Open Telegram and talk to @BotFather. Run /newbot and finish the setup.</div>',
            '    <div class="guide-step"><strong>2. Copy the token</strong>BotFather will return a token like 123456:ABCDEF. Keep it private.</div>',
            '    <div class="guide-step"><strong>3. Open Telegram Config</strong>Save the token, optional chat allowlist, and polling settings there.</div>',
            '  </div>',
            '  <div class="actions">',
            '    <button data-action="openConfigView">Open Telegram Config</button>',
            '  </div>',
            '</section>',
            '<section class="card">',
            '  <div class="card-title">What happens after setup</div>',
            '  <div class="card-sub">Once configured, the extension can poll Telegram, open Copilot Chat, and keep an activity stream of incoming messages.</div>',
            '</section>'
          ].join('');
          return;
        }

        const botName = state.bot && state.bot.username ? '@' + state.bot.username : (state.bot && state.bot.firstName ? state.bot.firstName : 'default');
        const modelAccess = state.modelAccess === 'granted'
          ? 'Granted'
          : state.modelAccess === 'not-granted'
            ? 'Not granted'
            : state.modelAccess === 'unavailable'
              ? 'Unavailable'
              : 'Unknown';

        content.innerHTML = [
          noticeHtml(state),
          '<section class="card">',
          '  <div class="card-title">Status</div>',
          '  <div class="card-sub">Bot and runtime state.</div>',
          '  <div class="account-card">',
          '    <div class="account-top">',
          '      <div class="account-name">' + escapeHtml(botName) + '</div>',
          '      <div class="account-id">telegram/default</div>',
          '    </div>',
          '    <div class="status-list">',
          '      <div><span class="label">Configured</span><span class="value">' + (state.configured ? 'Yes' : 'No') + '</span></div>',
          '      <div><span class="label">Running</span><span class="value">' + (state.running ? 'Yes' : 'No') + '</span></div>',
          '      <div><span class="label">Last start</span><span class="value">' + escapeHtml(relativeTime(state.lastStartAt)) + '</span></div>',
          '      <div><span class="label">Last inbound</span><span class="value">' + escapeHtml(relativeTime(state.lastInboundAt)) + '</span></div>',
          '      <div><span class="label">Last probe</span><span class="value">' + escapeHtml(relativeTime(state.lastProbeAt)) + '</span></div>',
          '      <div><span class="label">Last update id</span><span class="value">' + escapeHtml(String(state.lastUpdateId == null ? 'n/a' : state.lastUpdateId)) + '</span></div>',
          '    </div>',
          '    <div class="badge ' + badgeClass(state.running) + '">' + (state.running ? 'Polling active' : 'Polling stopped') + '</div>',
          '    <div class="badge ' + badgeClass(state.modelAccess) + '">LM access: ' + escapeHtml(modelAccess) + '</div>',
          state.lastError ? '    <div class="callout error">' + escapeHtml(state.lastError) + '</div>' : '',
          state.lastPrompt ? '    <div class="callout">Last prompt ready. Use Open Last Prompt to resend it to Copilot.</div>' : '',
          '  </div>',
          '  <div class="actions">',
          '    <button data-action="probeBot">Probe</button>',
          '    <button data-action="startPolling">Start</button>',
          '    <button data-action="stopPolling" class="secondary">Stop</button>',
          '    <button data-action="openLastPrompt" class="ghost">Open Last Prompt</button>',
          '  </div>',
          '</section>',
          '<section class="card">',
          '  <div class="card-title">Quick Summary</div>',
          '  <div class="card-sub">Current bridge settings.</div>',
          '  <div class="status-list">',
          '    <div><span class="label">Mode</span><span class="value">' + escapeHtml(state.mode) + '</span></div>',
          '    <div><span class="label">Allowed chats</span><span class="value">' + escapeHtml(state.allowedChatIds.length === 0 ? 'All' : String(state.allowedChatIds.length)) + '</span></div>',
          '    <div><span class="label">Open chat</span><span class="value">' + (state.openChatOnMessage ? 'Enabled' : 'Disabled') + '</span></div>',
          '    <div><span class="label">Auto-reply</span><span class="value">' + (state.autoReplyEnabled ? 'Enabled' : 'Disabled') + '</span></div>',
          '    <div><span class="label">Status updates</span><span class="value">' + (state.statusUpdatesEnabled ? 'Enabled' : 'Disabled') + '</span></div>',
          '  </div>',
          '</section>'
        ].join('');
      }

      function renderConfig(state) {
        content.innerHTML = [
          noticeHtml(state),
          '<section class="card">',
          '  <div class="card-title">Telegram Config</div>',
          '  <div class="card-sub">Secret token, allowlist and polling controls.</div>',
          '  <div class="fields">',
          '    <div class="field">',
          '      <label for="botToken">Bot Token</label>',
          '      <input id="botToken" type="password" placeholder="123456:ABCDEF..." />',
          '    </div>',
          '    <div class="field">',
          '      <label for="allowedChatIds">Allowed Chat IDs</label>',
          '      <textarea id="allowedChatIds" placeholder="One chat id per line">' + escapeHtml(state.allowedChatIds.join('\\n')) + '</textarea>',
          '    </div>',
          '    <div class="field">',
          '      <label for="pollIntervalMs">Poll Interval (ms)</label>',
          '      <input id="pollIntervalMs" type="number" min="250" step="250" value="' + escapeHtml(String(state.pollIntervalMs)) + '" />',
          '    </div>',
          '    <div class="field">',
          '      <label for="longPollTimeoutSeconds">Long Poll Timeout (s)</label>',
          '      <input id="longPollTimeoutSeconds" type="number" min="1" max="50" step="1" value="' + escapeHtml(String(state.longPollTimeoutSeconds)) + '" />',
          '    </div>',
          '    <div class="check-row">',
          '      <label class="check"><input id="pollingEnabled" type="checkbox" ' + (state.pollingEnabled ? 'checked' : '') + ' /> Start polling on activate</label>',
          '      <label class="check"><input id="openChatOnMessage" type="checkbox" ' + (state.openChatOnMessage ? 'checked' : '') + ' /> Open Copilot Chat on message</label>',
          '      <label class="check"><input id="autoReplyEnabled" type="checkbox" ' + (state.autoReplyEnabled ? 'checked' : '') + ' /> Auto-reply through language model API</label>',
          '      <label class="check"><input id="statusUpdatesEnabled" type="checkbox" ' + (state.statusUpdatesEnabled ? 'checked' : '') + ' /> Send progress updates back to Telegram</label>',
          '    </div>',
          '  </div>',
          '  <div class="actions">',
          '    <button data-action="saveToken">Save Token</button>',
          '    <button data-action="clearToken" class="secondary">Clear Token</button>',
          '    <button data-action="saveConfig" class="ghost">Save Config</button>',
          '  </div>',
          '</section>',
          '<section class="card">',
          '  <div class="card-title">Current State</div>',
          '  <div class="card-sub">Settings currently applied to the bridge.</div>',
          '  <div class="status-list">',
          '    <div><span class="label">Token stored</span><span class="value">' + (state.tokenStored ? 'Yes' : 'No') + '</span></div>',
          '    <div><span class="label">Configured</span><span class="value">' + (state.configured ? 'Yes' : 'No') + '</span></div>',
          '    <div><span class="label">Allowed chats</span><span class="value">' + escapeHtml(state.allowedChatIds.length === 0 ? 'All' : String(state.allowedChatIds.length)) + '</span></div>',
          '    <div><span class="label">Auto-reply</span><span class="value">' + (state.autoReplyEnabled ? 'Enabled' : 'Disabled') + '</span></div>',
          '    <div><span class="label">Status updates</span><span class="value">' + (state.statusUpdatesEnabled ? 'Enabled' : 'Disabled') + '</span></div>',
          '  </div>',
          '</section>'
        ].join('');
      }

      function renderActivity(state) {
        let streamHtml = '<div class="empty">No events yet. Start polling to see incoming Telegram messages here.</div>';
        if (state.stream.length) {
          streamHtml = '<div class="stream">' + state.stream.map((event) => {
            const tags = [];
            if (event.chatId) {
              tags.push('<span class="tag">chat ' + escapeHtml(event.chatId) + '</span>');
            }
            if (event.username) {
              tags.push('<span class="tag">' + escapeHtml(event.username) + '</span>');
            }
            tags.push('<span class="tag">' + escapeHtml(event.direction) + '</span>');
            return [
              '<div class="stream-item">',
              '  <div class="stream-meta">',
              '    <div class="stream-title">' + escapeHtml(event.title) + '</div>',
              '    <div class="stream-time">' + escapeHtml(relativeTime(event.timestamp)) + '</div>',
              '  </div>',
              '  <div class="stream-detail">' + escapeHtml(event.detail) + '</div>',
              '  <div class="stream-tags">' + tags.join('') + '</div>',
              '</div>'
            ].join('');
          }).join('') + '</div>';
        }

        content.innerHTML = [
          noticeHtml(state),
          '<section class="card">',
          '  <div class="card-title">Activity Stream</div>',
          '  <div class="card-sub">Incoming Telegram events and extension actions.</div>',
          '  <div class="actions">',
          '    <button data-action="clearStream" class="ghost">Clear Stream</button>',
          '    <button data-action="showLogs" class="ghost">Open Logs</button>',
          '  </div>',
          streamHtml,
          '</section>',
          '<section class="card">',
          '  <div class="card-title">Quick Help</div>',
          '  <div class="card-sub">Useful actions while testing the bridge.</div>',
          '  <div class="stack">',
          '    <div class="mini-card"><span class="label">Probe</span><span class="value">Verify the token and connected bot.</span></div>',
          '    <div class="mini-card"><span class="label">Start/Stop</span><span class="value">Control Telegram polling without opening settings.</span></div>',
          '    <div class="mini-card"><span class="label">Open Logs</span><span class="value">Open the Telegram Copilot Bridge output channel.</span></div>',
          '  </div>',
          '</section>'
        ].join('');
      }

      function render(state) {
        if (section === 'overview') {
          renderOverview(state);
          return;
        }
        if (section === 'config') {
          renderConfig(state);
          return;
        }
        renderActivity(state);
      }

      function handleAction(target) {
        const actionElement = target.closest('[data-action]');
        if (!actionElement) {
          return;
        }

        const action = actionElement.getAttribute('data-action');
        if (!action) {
          return;
        }

        if (action === 'saveToken') {
          const token = document.getElementById('botToken');
          vscode.postMessage({ type: 'saveToken', value: token ? token.value : '' });
          if (token) {
            token.value = '';
          }
          return;
        }

        if (action === 'saveConfig') {
          const allowedChatIds = document.getElementById('allowedChatIds');
          const pollIntervalMs = document.getElementById('pollIntervalMs');
          const longPollTimeoutSeconds = document.getElementById('longPollTimeoutSeconds');
          const pollingEnabled = document.getElementById('pollingEnabled');
          const openChatOnMessage = document.getElementById('openChatOnMessage');
          const autoReplyEnabled = document.getElementById('autoReplyEnabled');
          const statusUpdatesEnabled = document.getElementById('statusUpdatesEnabled');

          vscode.postMessage({
            type: 'saveConfig',
            value: {
              allowedChatIds: allowedChatIds ? allowedChatIds.value.split('\\n').map((item) => item.trim()).filter(Boolean) : [],
              openChatOnMessage: Boolean(openChatOnMessage && openChatOnMessage.checked),
              autoReplyEnabled: Boolean(autoReplyEnabled && autoReplyEnabled.checked),
              statusUpdatesEnabled: Boolean(statusUpdatesEnabled && statusUpdatesEnabled.checked),
              pollingEnabled: Boolean(pollingEnabled && pollingEnabled.checked),
              pollIntervalMs: Number((pollIntervalMs && pollIntervalMs.value) || '2000'),
              longPollTimeoutSeconds: Number((longPollTimeoutSeconds && longPollTimeoutSeconds.value) || '25')
            }
          });
          return;
        }

        vscode.postMessage({ type: action });
      }

      document.addEventListener('click', (event) => {
        handleAction(event.target);
      });

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message && message.type === 'state') {
          render(message.value);
        }
      });

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}

function getNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}