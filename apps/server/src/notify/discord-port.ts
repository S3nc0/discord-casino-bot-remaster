import { isScreenId, type ScreenId } from '@casino/shared';
import { t, type Locale } from '@casino/shared/i18n';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  Routes,
  type APIActionRowComponent,
  type APIButtonComponent,
  type Client,
} from 'discord.js';
import type {
  ChannelMessage,
  ChannelPostResult,
  DiscordNotifyPort,
  DmSendResult,
  WebhookCreateResult,
  WebhookCredentials,
  WebhookIdentity,
  WebhookPostResult,
} from './ports.ts';

/** Custom ID prefix for buttons that create a launch intent and respond with LAUNCH_ACTIVITY (type 12). */
export const LAUNCH_BUTTON_PREFIX = 'launch:';
/** Legacy open-activity button custom ID, mapped to the `'home'` screen. */
export const LEGACY_LAUNCH_BUTTON_ID = 'bot:open-activity';

/** Build the custom ID for an Activity launch button targeting `screen`. */
export function buildLaunchButtonId(screen: ScreenId = 'home'): string {
  return `${LAUNCH_BUTTON_PREFIX}${screen}`;
}

/** Parse a button custom ID into its target `ScreenId`, or `null` if it is not a launch button. */
export function parseLaunchButtonId(customId: string): ScreenId | null {
  if (customId === LEGACY_LAUNCH_BUTTON_ID) return 'home';
  if (!customId.startsWith(LAUNCH_BUTTON_PREFIX)) return null;
  const candidate = customId.slice(LAUNCH_BUTTON_PREFIX.length);
  return isScreenId(candidate) ? candidate : null;
}

/** Build an ActionRow containing the localized "Open in Activity" launch button. */
export function buildLaunchActivityRow(
  locale: Locale,
  screen: ScreenId = 'home',
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildLaunchButtonId(screen))
      .setLabel(t(locale, 'launch.openInActivity'))
      .setStyle(ButtonStyle.Primary),
  );
}

interface SendableChannelLike {
  send(options: Record<string, unknown>): Promise<{ id?: string }>;
  createWebhook?: (options: {
    name: string;
    avatar?: string;
  }) => Promise<{ id?: string; token?: string | null }>;
  permissionsFor?: (target: string) => { has(bit: bigint): boolean } | null;
}

interface DmUserLike {
  send(options: Record<string, unknown>): Promise<{ id?: string }>;
}

interface GuildLike {
  preferredLocale?: string | null;
}

/**
 * Narrow structural subset of discord.js `Client` required by `createDiscordNotifyPort`.
 * Satisfied directly by `discord.js` `Client` and trivially mockable in unit tests.
 */
export interface DiscordPortClient {
  readonly user: { readonly id: string } | null;
  readonly channels: {
    fetch(id: string): Promise<unknown>;
  };
  readonly users: {
    fetch(id: string): Promise<unknown>;
  };
  readonly guilds: {
    readonly cache: {
      get(id: string): GuildLike | undefined;
    };
    fetch(id: string): Promise<GuildLike | null>;
  };
  readonly rest: {
    post(
      fullRoute: `/${string}`,
      options?: { body?: unknown; query?: URLSearchParams; auth?: boolean },
    ): Promise<unknown>;
  };
}

interface DiscordErrorShape {
  code?: number | string;
  status?: number;
  message?: string;
  retryAfter?: number;
  rawError?: {
    code?: number;
    retry_after?: number;
    message?: string;
  };
}

function inspectError(error: unknown): {
  code: number | string | undefined;
  status: number | undefined;
  retryAfterMs: number | undefined;
  message: string;
} {
  const err = (typeof error === 'object' && error !== null ? error : {}) as DiscordErrorShape;
  const code = err.code ?? err.rawError?.code;
  const status = typeof err.status === 'number' ? err.status : undefined;
  let retryAfterMs: number | undefined;
  if (typeof err.retryAfter === 'number' && Number.isFinite(err.retryAfter)) {
    retryAfterMs = Math.ceil(err.retryAfter * 1000);
  } else if (
    typeof err.rawError?.retry_after === 'number' &&
    Number.isFinite(err.rawError.retry_after)
  ) {
    retryAfterMs = Math.ceil(err.rawError.retry_after * 1000);
  }
  const message =
    err.rawError?.message ??
    err.message ??
    (error instanceof Error ? error.message : String(error));
  return { code, status, retryAfterMs, message };
}

function isTransientNetworkCode(code: number | string | undefined): boolean {
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'EAI_AGAIN' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  );
}

function serializeMessagePayload(
  message: ChannelMessage,
  options: { allowLaunchButton: boolean },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (message.content !== undefined) payload.content = message.content;
  if (message.embeds !== undefined) payload.embeds = [...message.embeds];
  if (options.allowLaunchButton && message.openInActivity) {
    const row = buildLaunchActivityRow(message.locale ?? 'en', message.activityScreen ?? 'home');
    payload.components = [row.toJSON() as APIActionRowComponent<APIButtonComponent>];
  }
  return payload;
}

function isSendableChannel(value: unknown): value is SendableChannelLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'send' in value &&
    typeof (value as { send?: unknown }).send === 'function'
  );
}

function isDmUser(value: unknown): value is DmUserLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'send' in value &&
    typeof (value as { send?: unknown }).send === 'function'
  );
}

/**
 * Production `DiscordNotifyPort` backed by a discord.js `Client`.
 * Maps Discord API error codes cleanly into notify's fallback semantics:
 * - Missing `Manage Webhooks` (50013/50001 or permission check) → `missing_permissions` (falls back to channel post)
 * - Closed DMs (50007) → `dm_closed` (disables user DMs + writes `dm_disabled` inbox notice)
 * - Deleted/stale webhook (10015/50027/404) → `unknown_webhook` (evicts + recreates once, then falls back)
 */
export function createDiscordNotifyPort(client: Client | DiscordPortClient): DiscordNotifyPort {
  const discord = client as DiscordPortClient;

  return {
    async postToChannel(channelId: string, message: ChannelMessage): Promise<ChannelPostResult> {
      try {
        const channel = await discord.channels.fetch(channelId);
        if (!isSendableChannel(channel)) {
          return {
            ok: false,
            reason: 'unknown_channel',
            message: 'channel not found or not sendable',
          };
        }
        const sent = await channel.send(
          serializeMessagePayload(message, { allowLaunchButton: true }),
        );
        return {
          ok: true,
          ...(typeof sent.id === 'string' ? { messageId: sent.id } : {}),
        };
      } catch (error) {
        const { code, status, retryAfterMs, message: errMsg } = inspectError(error);
        if (status === 429) {
          return {
            ok: false,
            reason: 'rate_limited',
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            message: errMsg,
          };
        }
        if (code === RESTJSONErrorCodes.UnknownChannel || status === 404) {
          return { ok: false, reason: 'unknown_channel', message: errMsg };
        }
        if (
          code === RESTJSONErrorCodes.MissingPermissions ||
          code === RESTJSONErrorCodes.MissingAccess ||
          status === 403
        ) {
          return { ok: false, reason: 'missing_permissions', message: errMsg };
        }
        return { ok: false, reason: 'error', message: errMsg };
      }
    },

    async postViaWebhook(
      webhook: WebhookCredentials,
      message: ChannelMessage,
      identity?: WebhookIdentity,
    ): Promise<WebhookPostResult> {
      try {
        const body = serializeMessagePayload(message, { allowLaunchButton: true });
        if (identity?.name) body.username = identity.name;
        if (identity?.avatarUrl) body.avatar_url = identity.avatarUrl;

        const response = (await discord.rest.post(
          Routes.webhook(webhook.webhookId, webhook.token),
          {
            body,
            query: new URLSearchParams({ wait: 'true' }),
            auth: false,
          },
        )) as { id?: unknown } | null;

        return {
          ok: true,
          ...(typeof response?.id === 'string' ? { messageId: response.id } : {}),
        };
      } catch (error) {
        const { code, status, retryAfterMs, message: errMsg } = inspectError(error);
        if (status === 429) {
          return {
            ok: false,
            reason: 'rate_limited',
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            message: errMsg,
          };
        }
        if (
          code === RESTJSONErrorCodes.UnknownWebhook ||
          code === RESTJSONErrorCodes.InvalidWebhookToken ||
          status === 404
        ) {
          return { ok: false, reason: 'unknown_webhook', message: errMsg };
        }
        return { ok: false, reason: 'error', message: errMsg };
      }
    },

    async createWebhook(
      channelId: string,
      identity: WebhookIdentity,
    ): Promise<WebhookCreateResult> {
      try {
        const channel = await discord.channels.fetch(channelId);
        if (!isSendableChannel(channel) || typeof channel.createWebhook !== 'function') {
          return {
            ok: false,
            reason: 'unavailable',
            message: 'channel does not support webhooks',
          };
        }

        if (discord.user && typeof channel.permissionsFor === 'function') {
          const perms = channel.permissionsFor(discord.user.id);
          if (perms && !perms.has(PermissionFlagsBits.ManageWebhooks)) {
            return {
              ok: false,
              reason: 'missing_permissions',
              message: 'missing Manage Webhooks permission',
            };
          }
        }

        const created = await channel.createWebhook({
          name: identity.name,
          ...(identity.avatarUrl === undefined ? {} : { avatar: identity.avatarUrl }),
        });
        if (typeof created.id !== 'string' || typeof created.token !== 'string' || !created.token) {
          return { ok: false, reason: 'error', message: 'created webhook missing credentials' };
        }
        return {
          ok: true,
          webhook: { webhookId: created.id, token: created.token },
        };
      } catch (error) {
        const { code, status, message: errMsg } = inspectError(error);
        if (
          code === RESTJSONErrorCodes.MissingPermissions ||
          code === RESTJSONErrorCodes.MissingAccess ||
          status === 403
        ) {
          return { ok: false, reason: 'missing_permissions', message: errMsg };
        }
        if (
          code === RESTJSONErrorCodes.UnknownChannel ||
          code === RESTJSONErrorCodes.MaximumNumberOfWebhooksReached ||
          status === 404
        ) {
          return { ok: false, reason: 'unavailable', message: errMsg };
        }
        return { ok: false, reason: 'error', message: errMsg };
      }
    },

    async sendDm(userId: string, message: ChannelMessage): Promise<DmSendResult> {
      try {
        const user = await discord.users.fetch(userId);
        if (!isDmUser(user)) {
          return { ok: false, reason: 'unknown_user', message: 'user not found' };
        }
        const sent = await user.send(
          serializeMessagePayload(message, { allowLaunchButton: false }),
        );
        return {
          ok: true,
          ...(typeof sent.id === 'string' ? { messageId: sent.id } : {}),
        };
      } catch (error) {
        const { code, status, retryAfterMs, message: errMsg } = inspectError(error);
        if (code === RESTJSONErrorCodes.CannotSendMessagesToThisUser) {
          return { ok: false, reason: 'dm_closed', message: errMsg };
        }
        if (code === RESTJSONErrorCodes.UnknownUser || status === 404) {
          return { ok: false, reason: 'unknown_user', message: errMsg };
        }
        if (status === 429) {
          return {
            ok: false,
            reason: 'rate_limited',
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            message: errMsg,
          };
        }
        if ((status !== undefined && status >= 500) || isTransientNetworkCode(code)) {
          return { ok: false, reason: 'transient', message: errMsg };
        }
        return { ok: false, reason: 'error', message: errMsg };
      }
    },

    async fetchGuildLocale(guildId: string): Promise<string | null> {
      try {
        const cached = discord.guilds.cache.get(guildId);
        if (cached?.preferredLocale) return cached.preferredLocale;
        const fetched = await discord.guilds.fetch(guildId);
        return fetched?.preferredLocale ?? null;
      } catch {
        return null;
      }
    },

    async channelBelongsToGuild(channelId: string, guildId: string): Promise<boolean> {
      try {
        const channel = await discord.channels.fetch(channelId);
        return (
          typeof channel === 'object' &&
          channel !== null &&
          (channel as { guildId?: unknown }).guildId === guildId
        );
      } catch {
        return false;
      }
    },
  };
}
