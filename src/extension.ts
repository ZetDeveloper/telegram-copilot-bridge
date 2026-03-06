import * as vscode from "vscode";
import { TelegramSectionViewProvider } from "./sidebarProvider";
import { TelegramBridgeService } from "./telegramBridgeService";

let service: TelegramBridgeService | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  service = new TelegramBridgeService(context);
  const overviewProvider = new TelegramSectionViewProvider(context.extensionUri, service, "overview");
  const configProvider = new TelegramSectionViewProvider(context.extensionUri, service, "config");
  const activityProvider = new TelegramSectionViewProvider(context.extensionUri, service, "activity");

  context.subscriptions.push(service, overviewProvider, configProvider, activityProvider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("telegramCopilot.overview", overviewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider("telegramCopilot.config", configProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider("telegramCopilot.activity", activityProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("telegramCopilot.startPolling", async () => {
      await service?.startPolling();
    }),
    vscode.commands.registerCommand("telegramCopilot.stopPolling", async () => {
      await service?.stopPolling();
    }),
    vscode.commands.registerCommand("telegramCopilot.probeBot", async () => {
      await service?.probeBot(true);
    }),
    vscode.commands.registerCommand("telegramCopilot.setBotToken", async () => {
      const token = await vscode.window.showInputBox({
        title: "Telegram Bot Token",
        password: true,
        prompt: "Paste the Telegram bot token to store it in VS Code secrets.",
        ignoreFocusOut: true,
      });
      if (token) {
        await service?.saveToken(token);
      }
    }),
    vscode.commands.registerCommand("telegramCopilot.clearBotToken", async () => {
      const answer = await vscode.window.showWarningMessage(
        "Remove the Telegram bot token from VS Code secrets?",
        { modal: true },
        "Remove",
      );
      if (answer === "Remove") {
        await service?.clearToken();
      }
    }),
    vscode.commands.registerCommand("telegramCopilot.clearStream", () => {
      service?.clearStream();
    }),
    vscode.commands.registerCommand("telegramCopilot.openLastPrompt", async () => {
      await service?.openLastPrompt();
    }),
    vscode.commands.registerCommand("telegramCopilot.showLogs", () => {
      service?.showLogs();
    }),
    vscode.commands.registerCommand("telegramCopilot.focusConfig", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.telegramCopilot");
      configProvider.show(false);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("telegramCopilot")) {
        void service?.onConfigurationChanged();
      }
    }),
  );

  context.subscriptions.push(
    context.languageModelAccessInformation.onDidChange(() => {
      service?.updateModelAccess();
    }),
  );

  await service.initialize();
}

export function deactivate(): void {
  service?.dispose();
  service = null;
}