import { rooms, type InboxItem, type ScreenId, type Toast } from '@casino/shared';
import type { Locale } from '@casino/shared/i18n';
import type { CasinoServer } from '../socket/server.ts';

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: readonly EmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface ChannelMessage {
  content?: string;
  embeds?: readonly DiscordEmbed[];
  /** When true, attach a LAUNCH_ACTIVITY button pointing to `activityScreen` (default `'home'`). */
  openInActivity?: boolean;
  /** Target Activity screen for the launch button when `openInActivity` is true. */
  activityScreen?: ScreenId;
  /** Display locale used to localize the launch button label. */
  locale?: Locale;
}

export interface WebhookIdentity {
  name: string;
  avatarUrl?: string;
}

export interface WebhookCredentials {
  webhookId: string;
  token: string;
}

export type ChannelPostResult =
  | { ok: true; messageId?: string }
  | {
      ok: false;
      reason: 'missing_permissions' | 'unknown_channel' | 'rate_limited' | 'error';
      retryAfterMs?: number;
      message?: string;
    };

export type WebhookCreateResult =
  | { ok: true; webhook: WebhookCredentials }
  | {
      ok: false;
      reason: 'missing_permissions' | 'unavailable' | 'error';
      message?: string;
    };

export type WebhookPostResult =
  | { ok: true; messageId?: string }
  | {
      ok: false;
      reason: 'unknown_webhook' | 'rate_limited' | 'error';
      retryAfterMs?: number;
      message?: string;
    };

export type DmSendResult =
  | { ok: true; messageId?: string }
  | {
      ok: false;
      /** `dm_closed` maps to Discord API error 50007 (Cannot send messages to this user). */
      reason: 'dm_closed' | 'unknown_user' | 'rate_limited' | 'transient' | 'error';
      retryAfterMs?: number;
      message?: string;
    };

/**
 * Discord I/O port consumed by the notify module.
 * Implemented over discord.js in `discord-port.ts`; tests and `BOT_DISABLED=1` use fake/noop ports.
 */
export interface DiscordNotifyPort {
  postToChannel(channelId: string, message: ChannelMessage): Promise<ChannelPostResult>;
  postViaWebhook(
    webhook: WebhookCredentials,
    message: ChannelMessage,
    identity?: WebhookIdentity,
  ): Promise<WebhookPostResult>;
  createWebhook(channelId: string, identity: WebhookIdentity): Promise<WebhookCreateResult>;
  sendDm(userId: string, message: ChannelMessage): Promise<DmSendResult>;
  fetchGuildLocale(guildId: string): Promise<string | null>;
}

/** Socket.io emission port for per-user live inbox updates and toasts. */
export interface RealtimeNotifyPort {
  emitInboxNew(userId: string, item: InboxItem): void;
  emitToast(userId: string, toast: Toast): void;
}

/** Adapter wiring `RealtimeNotifyPort` to the server's Socket.io instance (`user:{id}` room). */
export function createSocketRealtimePort(io: Pick<CasinoServer, 'to'>): RealtimeNotifyPort {
  return {
    emitInboxNew(userId, item) {
      io.to(rooms.user(userId)).emit('inbox:new', item);
    },
    emitToast(userId, toast) {
      io.to(rooms.user(userId)).emit('toast', toast);
    },
  };
}

/** No-op realtime port for tests or headless setups without Socket.io. */
export function createNoopRealtimePort(): RealtimeNotifyPort {
  return {
    emitInboxNew() {},
    emitToast() {},
  };
}

/** Production-safe no-op Discord port used when the bot is disabled. */
export function createNoopDiscordPort(): DiscordNotifyPort {
  return {
    async postToChannel() {
      return { ok: true };
    },
    async postViaWebhook() {
      return { ok: true };
    },
    async createWebhook() {
      return { ok: false, reason: 'unavailable', message: 'bot disabled' };
    },
    async sendDm() {
      return { ok: true };
    },
    async fetchGuildLocale() {
      return null;
    },
  };
}

export interface RecordedChannelPost {
  channelId: string;
  message: ChannelMessage;
}

export interface RecordedWebhookPost {
  webhook: WebhookCredentials;
  message: ChannelMessage;
  identity?: WebhookIdentity;
}

export interface RecordedWebhookCreate {
  channelId: string;
  identity: WebhookIdentity;
}

export interface RecordedDm {
  userId: string;
  message: ChannelMessage;
}

export interface FakeDiscordPortOptions {
  guildLocales?: Record<string, string | null>;
  onPostToChannel?: (
    channelId: string,
    message: ChannelMessage,
  ) => ChannelPostResult | Promise<ChannelPostResult>;
  onPostViaWebhook?: (
    webhook: WebhookCredentials,
    message: ChannelMessage,
    identity?: WebhookIdentity,
  ) => WebhookPostResult | Promise<WebhookPostResult>;
  onCreateWebhook?: (
    channelId: string,
    identity: WebhookIdentity,
  ) => WebhookCreateResult | Promise<WebhookCreateResult>;
  onSendDm?: (userId: string, message: ChannelMessage) => DmSendResult | Promise<DmSendResult>;
}

export interface FakeDiscordPort extends DiscordNotifyPort {
  readonly channelPosts: RecordedChannelPost[];
  readonly webhookPosts: RecordedWebhookPost[];
  readonly createdWebhooks: RecordedWebhookCreate[];
  readonly dms: RecordedDm[];
  readonly guildLocales: Map<string, string | null>;
  reset(): void;
}

/** In-memory fake Discord port for deterministic tests and bot-disabled development runs. */
export function createFakeDiscordPort(options: FakeDiscordPortOptions = {}): FakeDiscordPort {
  const channelPosts: RecordedChannelPost[] = [];
  const webhookPosts: RecordedWebhookPost[] = [];
  const createdWebhooks: RecordedWebhookCreate[] = [];
  const dms: RecordedDm[] = [];
  const guildLocales = new Map<string, string | null>(Object.entries(options.guildLocales ?? {}));
  let seq = 0;

  return {
    channelPosts,
    webhookPosts,
    createdWebhooks,
    dms,
    guildLocales,
    reset() {
      channelPosts.length = 0;
      webhookPosts.length = 0;
      createdWebhooks.length = 0;
      dms.length = 0;
    },
    async postToChannel(channelId, message) {
      channelPosts.push({ channelId, message });
      if (options.onPostToChannel) return options.onPostToChannel(channelId, message);
      seq += 1;
      return { ok: true, messageId: `msg-${seq}` };
    },
    async postViaWebhook(webhook, message, identity) {
      webhookPosts.push(identity ? { webhook, message, identity } : { webhook, message });
      if (options.onPostViaWebhook) return options.onPostViaWebhook(webhook, message, identity);
      seq += 1;
      return { ok: true, messageId: `wh-msg-${seq}` };
    },
    async createWebhook(channelId, identity) {
      createdWebhooks.push({ channelId, identity });
      if (options.onCreateWebhook) return options.onCreateWebhook(channelId, identity);
      seq += 1;
      return {
        ok: true,
        webhook: { webhookId: `wh-${seq}`, token: `tok-${seq}` },
      };
    },
    async sendDm(userId, message) {
      dms.push({ userId, message });
      if (options.onSendDm) return options.onSendDm(userId, message);
      seq += 1;
      return { ok: true, messageId: `dm-${seq}` };
    },
    async fetchGuildLocale(guildId) {
      return guildLocales.get(guildId) ?? null;
    },
  };
}
