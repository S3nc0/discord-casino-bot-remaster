import type { Clock } from '@casino/shared';
import { t, type Locale } from '@casino/shared/i18n';
import type { Logger } from 'pino';
import type { Store } from '../db/store.ts';
import type { PersonaId } from './messages.ts';
import type {
  ChannelMessage,
  ChannelPostResult,
  DiscordNotifyPort,
  WebhookCredentials,
  WebhookIdentity,
} from './ports.ts';

export const PERSONA_IDS = ['race_caller', 'market_news', 'teiai_bank'] as const;

export interface PersonaDefinition {
  readonly id: PersonaId;
  readonly nameKey:
    'notify.persona.race_caller' | 'notify.persona.market_news' | 'notify.persona.teiai_bank';
  readonly defaultAvatarPath: string;
}

export const PERSONA_DEFINITIONS: Readonly<Record<PersonaId, PersonaDefinition>> = {
  race_caller: {
    id: 'race_caller',
    nameKey: 'notify.persona.race_caller',
    defaultAvatarPath: '/assets/personas/race-caller.png',
  },
  market_news: {
    id: 'market_news',
    nameKey: 'notify.persona.market_news',
    defaultAvatarPath: '/assets/personas/market-news.png',
  },
  teiai_bank: {
    id: 'teiai_bank',
    nameKey: 'notify.persona.teiai_bank',
    defaultAvatarPath: '/assets/personas/teiai-bank.png',
  },
};

export interface WebhookPersonaManagerOptions {
  store: Store;
  port: DiscordNotifyPort;
  clock: Clock;
  logger: Logger;
  /** Base origin for default persona avatar URLs (e.g. `PUBLIC_API_ORIGIN`). */
  avatarBaseUrl?: string;
  /** Optional explicit avatar URL overrides per persona. */
  avatarUrls?: Partial<Record<PersonaId, string>>;
  /** Cooldown after `missing_permissions` before retrying `createWebhook` (ms). Default 5 min. */
  permissionCooldownMs?: number;
}

export type PersonaSendResult =
  | { ok: true; via: 'webhook' | 'channel'; messageId?: string }
  | {
      ok: false;
      reason: 'rate_limited' | 'error';
      retryAfterMs?: number;
      message?: string;
    };

interface WebhookRow {
  webhook_id: string;
  token: string;
}

/**
 * Manages optional per-guild webhook personas (`競馬実況`, `証券ニュース`, `帝愛銀行`).
 * Webhooks are created lazily via `Manage Webhooks` only when enabled for a guild, persisted in
 * `guild_webhooks`, and transparently fall back to bot channel posts on permission or delivery errors.
 */
export class WebhookPersonaManager {
  private readonly store: Store;
  private readonly port: DiscordNotifyPort;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly avatarBaseUrl: string;
  private readonly avatarUrls: Partial<Record<PersonaId, string>>;
  private readonly permissionCooldownMs: number;
  private readonly permissionDeniedUntil = new Map<string, number>();

  constructor(options: WebhookPersonaManagerOptions) {
    this.store = options.store;
    this.port = options.port;
    this.clock = options.clock;
    this.logger = options.logger;
    this.avatarBaseUrl = (options.avatarBaseUrl ?? 'https://casino.invalid').replace(/\/+$/, '');
    this.avatarUrls = options.avatarUrls ?? {};
    this.permissionCooldownMs = options.permissionCooldownMs ?? 300_000;
  }

  /** Build the localized name + avatar identity for a persona. */
  identity(persona: PersonaId, locale: Locale): WebhookIdentity {
    const def = PERSONA_DEFINITIONS[persona];
    return {
      name: t(locale, def.nameKey),
      avatarUrl: this.avatarUrls[persona] ?? `${this.avatarBaseUrl}${def.defaultAvatarPath}`,
    };
  }

  /** Look up a cached webhook for `(guildId, persona, channelId)`. */
  getCached(guildId: string, persona: PersonaId, channelId: string): WebhookCredentials | null {
    const row = this.store
      .stmt(
        `SELECT webhook_id, token FROM guild_webhooks
         WHERE guild_id = ? AND persona = ? AND channel_id = ?`,
      )
      .get(guildId, persona, channelId) as WebhookRow | undefined;
    return row ? { webhookId: row.webhook_id, token: row.token } : null;
  }

  /** Delete all stored webhooks for a guild (e.g. if an admin resets personas). */
  clearGuild(guildId: string): void {
    this.store.stmt('DELETE FROM guild_webhooks WHERE guild_id = ?').run(guildId);
    for (const key of this.permissionDeniedUntil.keys()) {
      if (key.startsWith(`${guildId}:`)) this.permissionDeniedUntil.delete(key);
    }
  }

  /**
   * Send a message as `persona` in `channelId`, falling back to `postToChannel` whenever
   * webhook creation or webhook delivery fails (except explicit rate limits).
   */
  async send(params: {
    guildId: string;
    channelId: string;
    persona: PersonaId;
    locale: Locale;
    message: ChannelMessage;
  }): Promise<PersonaSendResult> {
    const { guildId, channelId, persona, locale, message } = params;
    const identity = this.identity(persona, locale);

    let webhook = this.getCached(guildId, persona, channelId);
    let freshlyCreated = false;

    if (!webhook) {
      webhook = await this.createAndStore(guildId, persona, channelId, identity);
      freshlyCreated = webhook !== null;
    }

    if (!webhook) {
      return this.fallbackToChannel(channelId, message);
    }

    const posted = await this.tryWebhookPost(webhook, message, identity);
    if (posted.ok) {
      return {
        ok: true,
        via: 'webhook',
        ...(posted.messageId === undefined ? {} : { messageId: posted.messageId }),
      };
    }

    if (posted.reason === 'rate_limited') {
      return {
        ok: false,
        reason: 'rate_limited',
        ...(posted.retryAfterMs === undefined ? {} : { retryAfterMs: posted.retryAfterMs }),
        ...(posted.message === undefined ? {} : { message: posted.message }),
      };
    }

    // Stale webhook deleted in Discord: evict and try creating once before falling back.
    if (posted.reason === 'unknown_webhook') {
      this.evict(guildId, persona, channelId);
      if (!freshlyCreated) {
        const recreated = await this.createAndStore(guildId, persona, channelId, identity);
        if (recreated) {
          const retry = await this.tryWebhookPost(recreated, message, identity);
          if (retry.ok) {
            return {
              ok: true,
              via: 'webhook',
              ...(retry.messageId === undefined ? {} : { messageId: retry.messageId }),
            };
          }
        }
      }
    }

    this.logger.warn(
      { guildId, channelId, persona, reason: posted.reason },
      'webhook persona delivery failed; falling back to bot channel post',
    );
    return this.fallbackToChannel(channelId, message);
  }

  private async tryWebhookPost(
    webhook: WebhookCredentials,
    message: ChannelMessage,
    identity: WebhookIdentity,
  ) {
    try {
      return await this.port.postViaWebhook(webhook, message, identity);
    } catch (error) {
      this.logger.warn({ err: error }, 'postViaWebhook threw');
      return { ok: false as const, reason: 'error' as const, message: String(error) };
    }
  }

  private async createAndStore(
    guildId: string,
    persona: PersonaId,
    channelId: string,
    identity: WebhookIdentity,
  ): Promise<WebhookCredentials | null> {
    const cooldownKey = `${guildId}:${channelId}`;
    const blockedUntil = this.permissionDeniedUntil.get(cooldownKey) ?? 0;
    const now = this.clock.now();
    if (blockedUntil > now) return null;

    let created;
    try {
      created = await this.port.createWebhook(channelId, identity);
    } catch (error) {
      this.logger.warn({ err: error, guildId, channelId, persona }, 'createWebhook threw');
      return null;
    }

    if (!created.ok) {
      if (created.reason === 'missing_permissions' && this.permissionCooldownMs > 0) {
        this.permissionDeniedUntil.set(cooldownKey, now + this.permissionCooldownMs);
      }
      this.logger.warn(
        { guildId, channelId, persona, reason: created.reason },
        'could not create persona webhook; falling back to channel post',
      );
      return null;
    }

    this.store.transaction(() => {
      this.store
        .stmt(
          `INSERT OR IGNORE INTO guilds (guild_id, status, created_at, updated_at)
           VALUES (?, 'pending', ?, ?)`,
        )
        .run(guildId, now, now);
      this.store
        .stmt(
          `INSERT INTO guild_webhooks (guild_id, persona, channel_id, webhook_id, token, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (guild_id, persona, channel_id) DO UPDATE SET
             webhook_id = excluded.webhook_id,
             token = excluded.token,
             updated_at = excluded.updated_at`,
        )
        .run(
          guildId,
          persona,
          channelId,
          created.webhook.webhookId,
          created.webhook.token,
          now,
          now,
        );
    });
    return created.webhook;
  }

  private evict(guildId: string, persona: PersonaId, channelId: string): void {
    this.store
      .stmt('DELETE FROM guild_webhooks WHERE guild_id = ? AND persona = ? AND channel_id = ?')
      .run(guildId, persona, channelId);
  }

  private async fallbackToChannel(
    channelId: string,
    message: ChannelMessage,
  ): Promise<PersonaSendResult> {
    let result: ChannelPostResult;
    try {
      result = await this.port.postToChannel(channelId, message);
    } catch (error) {
      this.logger.warn({ err: error, channelId }, 'channel fallback post threw');
      return { ok: false, reason: 'error', message: String(error) };
    }
    if (result.ok) {
      return {
        ok: true,
        via: 'channel',
        ...(result.messageId === undefined ? {} : { messageId: result.messageId }),
      };
    }
    if (result.reason === 'rate_limited') {
      return {
        ok: false,
        reason: 'rate_limited',
        ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }),
        ...(result.message === undefined ? {} : { message: result.message }),
      };
    }
    return {
      ok: false,
      reason: 'error',
      ...(result.message === undefined ? {} : { message: result.message }),
    };
  }
}
