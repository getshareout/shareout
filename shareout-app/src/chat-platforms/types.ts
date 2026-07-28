import type { Env } from '../types';

/** Supported account-level messaging platforms. */
export type PlatformId = 'telegram' | 'slack' | 'web';

/** Workspace scope for artifact list/search in a chat session. */
export const PERSONAL_SCOPE = '__personal';

/** null = all accessible pages; PERSONAL_SCOPE = personal only; else workspace id. */
export type WorkspaceSelection = string | typeof PERSONAL_SCOPE | null;

/** Artifact row shown in platform-specific card UIs. */
export interface ArtifactCardItem {
  id: string;
  name: string;
  slug: string;
  visibility?: string;
  artifact_type?: string;
  updated_at?: string | null;
  created_at?: string;
}

/**
 * A canvas-piloting instruction the agent emits to a UI-capable client (the web
 * home). Non-destructive navigation only — executed immediately, no confirm step.
 * Messaging platforms (Telegram/Slack) simply don't implement `sendUiAction`.
 */
export type ChatUiAction =
  | { kind: 'open_artifact'; artifactId: string; slug: string; name: string }
  | { kind: 'render_search'; query: string }
  /** Surface the setup checklist in the dock (work/033) — client re-derives + renders it. */
  | { kind: 'show_onboarding' };

/**
 * Stable session identity for routing, linking, and the ChatSession DO.
 * key format: "{platform}:{nativeId}" e.g. telegram:12345, slack:T1:U9
 */
export interface ChatSession {
  platform: PlatformId;
  key: string;
  /** Platform-native context the adapter needs to reply (chat id, team+user, etc.). */
  native: unknown;
}

/** Normalized inbound event from any platform webhook. */
export type ChatInboundKind = 'message' | 'command' | 'callback' | 'link_complete';

export interface ChatInboundEvent {
  kind: ChatInboundKind;
  session: ChatSession;
  /** Dedup id (Telegram update_id, Slack event_id, etc.). */
  eventId: string;
  /** Plain user text for message/command kinds. */
  text?: string;
  /** Parsed slash command name (without prefix), args in text. */
  command?: string;
  /** Opaque callback payload for confirmation buttons. */
  callbackData?: string;
  callbackId?: string;
  /** Message ref for editing confirmation UI after tap. */
  messageRef?: unknown;
}

/** One-time or OAuth link offer shown in product settings. */
export interface LinkOffer {
  platform: PlatformId;
  code?: string;
  returnUrl?: string;
  native?: unknown;
}

/**
 * Platform-agnostic outbound channel. Tools and the agent loop talk only through
 * this port — never import telegram/client or slack/send directly.
 */
export interface ChatReplyPort {
  sendText(text: string): Promise<void>;
  /** Optional progressive text streaming (web SSE). Bots omit it and render whole messages via sendText. */
  sendTextDelta?(text: string): Promise<void>;
  sendTyping(): Promise<void>;
  sendImage(bytes: ArrayBuffer, filename: string, caption?: string): Promise<boolean>;
  sendFile(bytes: ArrayBuffer, filename: string, mime: string, caption?: string): Promise<boolean>;
  sendArtifactCards(items: ArtifactCardItem[]): Promise<void>;
  askConfirmation(prompt: string, token: string): Promise<unknown>;
  /** UI-capable clients (web home) execute canvas actions; others omit this. */
  sendUiAction?(action: ChatUiAction): Promise<void>;
  answerCallback?(callbackId: string, text?: string): Promise<void>;
  editConfirmation?(messageRef: unknown, prompt: string): Promise<void>;
}

/** Adapter contract — one implementation per messaging platform. */
export interface ChatPlatform {
  readonly id: PlatformId;
  readonly featureFlag: string;

  verifyWebhook(request: Request, env: Env): Promise<boolean>;
  parseEvents(request: Request, env: Env): Promise<ChatInboundEvent[]>;
  replyPort(env: Env, session: ChatSession): ChatReplyPort;

  mintLinkCode?(env: Env, userId: string): Promise<LinkOffer | null>;
  completeLink?(env: Env, offer: LinkOffer, native: unknown): Promise<string | null>;
  getLinkedUserId(env: Env, session: ChatSession): Promise<string | null>;
  unlink(env: Env, session: ChatSession): Promise<void>;

  getSelectedWorkspace?(env: Env, session: ChatSession): Promise<WorkspaceSelection>;
  setSelectedWorkspace?(env: Env, session: ChatSession, ws: WorkspaceSelection): Promise<void>;
  settingsUrl?(env: Env): string;
}
