export type StreamDirection = "system" | "inbound" | "outbound" | "error";

export interface TelegramBotSummary {
  id: number;
  username?: string;
  firstName?: string;
}

export interface UiNotice {
  kind: "info" | "success" | "warning" | "error";
  message: string;
  timestamp: number;
}

export interface StreamEvent {
  id: string;
  timestamp: number;
  direction: StreamDirection;
  title: string;
  detail: string;
  chatId?: string;
  username?: string;
}

export interface TelegramBridgeState {
  configured: boolean;
  running: boolean;
  mode: "polling";
  tokenStored: boolean;
  lastStartAt: number | null;
  lastProbeAt: number | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
  lastError: string | null;
  lastPrompt: string | null;
  lastUpdateId: number | null;
  bot: TelegramBotSummary | null;
  allowedChatIds: string[];
  openChatOnMessage: boolean;
  autoReplyEnabled: boolean;
  pollingEnabled: boolean;
  pollIntervalMs: number;
  longPollTimeoutSeconds: number;
  modelAccess: "unknown" | "granted" | "not-granted" | "unavailable";
  lastNotice: UiNotice | null;
  stream: StreamEvent[];
}

export interface SidebarConfigPayload {
  allowedChatIds: string[];
  openChatOnMessage: boolean;
  autoReplyEnabled: boolean;
  pollingEnabled: boolean;
  pollIntervalMs: number;
  longPollTimeoutSeconds: number;
}

export interface TelegramMessageEvent {
  chatId: string;
  username?: string;
  text: string;
}