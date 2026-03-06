# Telegram Copilot Bridge

Control GitHub Copilot from a Telegram bot directly inside VS Code.

Telegram Copilot Bridge listens to Telegram messages with long polling, opens GitHub Copilot Chat, and keeps a dedicated activity stream inside its own sidebar container.

## Features

- Dedicated sidebar container in the VS Code activity bar
- Overview, Telegram Config, and Activity views
- Telegram bot probe, runtime status, and error reporting
- Secure token storage with `ExtensionContext.secrets`
- Activity stream for inbound messages and bridge actions
- Optional auto-reply mode powered by `vscode.lm`

## How It Works

1. Create a Telegram bot with `@BotFather`
2. Save the bot token in `Telegram Config`
3. Start polling from the extension
4. Send a message to the bot and forward prompts to GitHub Copilot

## Development

```bash
cd telegram-copilot-vscode-mvp
npm install
npm run compile
```

Open the folder in VS Code and press `F5` to launch an Extension Development Host.

## Package For Marketplace

```bash
npm run package:vsix
```

This generates a `.vsix` package that can be uploaded to the VS Code Marketplace.

## Notes

- The UI is inspired by OpenClaw, but it does not copy OpenClaw code or layout.
- Direct Copilot chat prefilling depends on the VS Code build and available APIs. When direct prefilling is not available, the extension opens the chat and copies the prompt to the clipboard.
- `autoReplyEnabled` only works when the extension already has permission to access a language model through `vscode.lm`.