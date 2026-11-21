import { NOTIFICATION_KINDS, type Clock, type NotificationKind } from '@casino/shared';
import { normalizeLocale, resolveLocale, type Locale } from '@casino/shared/i18n';
import type { Store } from '../db/store.ts';
import { EVENT_META, SUBSCRIBED_EVENT_TYPES, type SubscribedEventType } from './messages.ts';

export const DEFAULT_BIG_WIN_THRESHOLD = 100_000;
export const DEFAULT_ANNOUNCE_PER_MINUTE = 6;

export interface EventTypeConfig {
  enabled: boolean;
  channelId: string | null;
}

export interface GuildNotifyConfig {
  guildId: string;
  /** Stored per-guild channel override (null means fall back to `ANNOUNCE_CHANNEL_ID`). */
  announceChannelId: string | null;
  /** Resolved channel ID: `announceChannelId ?? defaultAnnounceChannelId`. */
  effectiveChannelId: string;
  /** Stored per-guild locale override (null means auto-detect from Discord's guild locale). */
  locale: Locale | null;
  announceEnabled: boolean;
  bigWinThreshold: number;
  announcePerMinute: number;
  personasEnabled: boolean;
  eventTypes: Record<SubscribedEventType, EventTypeConfig>;
}

export interface UserKindPref {
  dm: boolean;
  inbox: boolean;
}

export interface UserNotifyPrefs {
  dmDigest: boolean;
  kinds: Record<NotificationKind, UserKindPref>;
}

interface GuildConfigRow {
  locale: Locale | null;
  announce_channel_id: string | null;
  announce_enabled: number;
  big_win_threshold: number;
  announce_per_minute: number;
  personas_enabled: number;
}

interface AnnounceTypeRow {
  event_type: string;
  enabled: number;
  channel_id: string | null;
}

interface NotificationPrefRow {
  kind: string;
  dm: number;
  inbox: number;
}

export interface NotifyConfigServiceOptions {
  store: Store;
  clock: Clock;
  /** Fallback announcement channel from `ANNOUNCE_CHANNEL_ID`. */
  defaultAnnounceChannelId: string;
  /** How long to cache `fetchGuildLocale` results in memory (ms). Default 10 min. */
  guildLocaleCacheTtlMs?: number;
}

/**
 * Config surface for per-guild announcement settings (used by the future `/admin notifications` /
 * `/運営 通知設定` command) and per-user DM/inbox preferences.
 */
export class NotifyConfigService {
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly defaultAnnounceChannelId: string;
  private readonly guildLocaleCacheTtlMs: number;
  private readonly guildLocaleCache = new Map<
    string,
    { locale: Locale | null; expiresAt: number }
  >();

  constructor(options: NotifyConfigServiceOptions) {
    this.store = options.store;
    this.clock = options.clock;
    this.defaultAnnounceChannelId = options.defaultAnnounceChannelId;
    this.guildLocaleCacheTtlMs = options.guildLocaleCacheTtlMs ?? 600_000;
  }

  /** Read a guild's full announcement configuration, applying defaults for missing rows. */
  getGuildConfig(guildId: string): GuildNotifyConfig {
    const row = this.store
      .stmt(
        `SELECT locale, announce_channel_id, announce_enabled, big_win_threshold,
                announce_per_minute, personas_enabled
         FROM guild_config WHERE guild_id = ?`,
      )
      .get(guildId) as GuildConfigRow | undefined;

    const overrides = new Map<string, EventTypeConfig>();
    const typeRows = this.store
      .stmt('SELECT event_type, enabled, channel_id FROM guild_announce_types WHERE guild_id = ?')
      .all(guildId) as AnnounceTypeRow[];
    for (const r of typeRows) {
      overrides.set(r.event_type, { enabled: r.enabled === 1, channelId: r.channel_id });
    }

    const eventTypes = {} as Record<SubscribedEventType, EventTypeConfig>;
    for (const type of SUBSCRIBED_EVENT_TYPES) {
      eventTypes[type] = overrides.get(type) ?? {
        enabled: EVENT_META[type].defaultAnnounce,
        channelId: null,
      };
    }

    const announceChannelId = row?.announce_channel_id ?? null;
    return {
      guildId,
      announceChannelId,
      effectiveChannelId: announceChannelId ?? this.defaultAnnounceChannelId,
      locale: row?.locale ?? null,
      announceEnabled: row ? row.announce_enabled === 1 : true,
      bigWinThreshold: row?.big_win_threshold ?? DEFAULT_BIG_WIN_THRESHOLD,
      announcePerMinute: row?.announce_per_minute ?? DEFAULT_ANNOUNCE_PER_MINUTE,
      personasEnabled: row ? row.personas_enabled === 1 : false,
      eventTypes,
    };
  }

  /** Resolve the effective announcement channel for a specific event type in a guild. */
  resolveEventChannel(guildId: string, eventType: SubscribedEventType): string {
    const cfg = this.getGuildConfig(guildId);
    return cfg.eventTypes[eventType].channelId ?? cfg.effectiveChannelId;
  }

  setAnnounceChannel(guildId: string, channelId: string | null): GuildNotifyConfig {
    const at = this.clock.now();
    this.store.transaction(() => {
      this.ensureGuildConfig(guildId, at);
      this.store
        .stmt('UPDATE guild_config SET announce_channel_id = ?, updated_at = ? WHERE guild_id = ?')
        .run(channelId, at, guildId);
    });
    return this.getGuildConfig(guildId);
  }

  setGuildLocale(guildId: string, locale: Locale | null): GuildNotifyConfig {
    const at = this.clock.now();
    this.store.transaction(() => {
      this.ensureGuildConfig(guildId, at);
      this.store
        .stmt('UPDATE guild_config SET locale = ?, updated_at = ? WHERE guild_id = ?')
        .run(locale, at, guildId);
    });
    this.guildLocaleCache.delete(guildId);
    return this.getGuildConfig(guildId);
  }

  setAnnounceEnabled(guildId: string, enabled: boolean): GuildNotifyConfig {
    const at = this.clock.now();
    this.store.transaction(() => {
      this.ensureGuildConfig(guildId, at);
      this.store
        .stmt('UPDATE guild_config SET announce_enabled = ?, updated_at = ? WHERE guild_id = ?')
        .run(enabled ? 1 : 0, at, guildId);
    });
    return this.getGuildConfig(guildId);
  }

  setBigWinThreshold(guildId: string, threshold: number): GuildNotifyConfig {
    if (!Number.isInteger(threshold) || threshold < 0) {
      throw new RangeError('bigWinThreshold must be a non-negative integer');
    }
    const at = this.clock.now();
    this.store.transaction(() => {
      this.ensureGuildConfig(guildId, at);
      this.store
        .stmt('UPDATE guild_config SET big_win_threshold = ?, updated_at = ? WHERE guild_id = ?')
        .run(threshold, at, guildId);
    });
    return this.getGuildConfig(guildId);
  }

  setAnnounceRateLimit(guildId: string, perMinute: number): GuildNotifyConfig {
    if (!Number.isInteger(perMinute) || perMinute < 1 || perMinute > 60) {
      throw new RangeError('announcePerMinute must be an integer between 1 and 60');
    }
    const at = this.clock.now();
    this.store.transaction(() => {
      this.ensureGuildConfig(guildId, at);
      this.store
        .stmt('UPDATE guild_config SET announce_per_minute = ?, updated_at = ? WHERE guild_id = ?')
        .run(perMinute, at, guildId);
    });
    return this.getGuildConfig(guildId);
  }

  setPersonasEnabled(guildId: string, enabled: boolean): GuildNotifyConfig {
    const at = this.clock.now();
    this.store.transaction(() => {
      this.ensureGuildConfig(guildId, at);
      this.store
        .stmt('UPDATE guild_config SET personas_enabled = ?, updated_at = ? WHERE guild_id = ?')
        .run(enabled ? 1 : 0, at, guildId);
    });
    return this.getGuildConfig(guildId);
  }

  setEventTypeConfig(
    guildId: string,
    eventType: SubscribedEventType,
    config: { enabled: boolean; channelId?: string | null },
  ): GuildNotifyConfig {
    const at = this.clock.now();
    this.store.transaction(() => {
      this.ensureGuildConfig(guildId, at);
      if (config.channelId === undefined) {
        this.store
          .stmt(
            `INSERT INTO guild_announce_types (guild_id, event_type, enabled, channel_id)
             VALUES (?, ?, ?, NULL)
             ON CONFLICT (guild_id, event_type) DO UPDATE SET enabled = excluded.enabled`,
          )
          .run(guildId, eventType, config.enabled ? 1 : 0);
      } else {
        this.store
          .stmt(
            `INSERT INTO guild_announce_types (guild_id, event_type, enabled, channel_id)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (guild_id, event_type) DO UPDATE SET
               enabled = excluded.enabled,
               channel_id = excluded.channel_id`,
          )
          .run(guildId, eventType, config.enabled ? 1 : 0, config.channelId);
      }
    });
    return this.getGuildConfig(guildId);
  }

  setEnabledEventTypes(
    guildId: string,
    types: Partial<Record<SubscribedEventType, boolean>>,
  ): GuildNotifyConfig {
    const at = this.clock.now();
    this.store.transaction(() => {
      this.ensureGuildConfig(guildId, at);
      const stmt = this.store.stmt(
        `INSERT INTO guild_announce_types (guild_id, event_type, enabled, channel_id)
         VALUES (?, ?, ?, NULL)
         ON CONFLICT (guild_id, event_type) DO UPDATE SET enabled = excluded.enabled`,
      );
      for (const [eventType, enabled] of Object.entries(types)) {
        if (enabled === undefined) continue;
        stmt.run(guildId, eventType, enabled ? 1 : 0);
      }
    });
    return this.getGuildConfig(guildId);
  }

  /**
   * Resolve a guild's display locale: explicit `guild_config.locale` → Discord guild's preferred
   * locale (cached) → `en`.
   */
  async resolveGuildLocale(
    guildId: string,
    fetchGuildLocale: (guildId: string) => Promise<string | null>,
  ): Promise<Locale> {
    const stored = this.getGuildConfig(guildId).locale;
    if (stored) return stored;

    const now = this.clock.now();
    const cached = this.guildLocaleCache.get(guildId);
    if (cached && cached.expiresAt > now) {
      return resolveLocale({ guild: cached.locale });
    }

    let fetched: string | null;
    try {
      fetched = await fetchGuildLocale(guildId);
    } catch {
      fetched = null;
    }
    const normalized = normalizeLocale(fetched);
    this.guildLocaleCache.set(guildId, {
      locale: normalized,
      expiresAt: now + this.guildLocaleCacheTtlMs,
    });
    return resolveLocale({ guild: normalized });
  }

  clearGuildLocaleCache(guildId?: string): void {
    if (guildId === undefined) this.guildLocaleCache.clear();
    else this.guildLocaleCache.delete(guildId);
  }

  // ---- Per-user notification preferences ----

  getUserKindPref(userId: string, kind: NotificationKind): UserKindPref {
    const row = this.store
      .stmt('SELECT dm, inbox FROM notification_prefs WHERE user_id = ? AND kind = ?')
      .get(userId, kind) as { dm: number; inbox: number } | undefined;
    if (!row) return { dm: false, inbox: true };
    return { dm: row.dm === 1, inbox: row.inbox === 1 };
  }

  getUserPrefs(userId: string): UserNotifyPrefs {
    const rows = this.store
      .stmt('SELECT kind, dm, inbox FROM notification_prefs WHERE user_id = ?')
      .all(userId) as NotificationPrefRow[];
    const byKind = new Map<string, UserKindPref>();
    for (const row of rows) {
      byKind.set(row.kind, { dm: row.dm === 1, inbox: row.inbox === 1 });
    }
    const kinds = {} as Record<NotificationKind, UserKindPref>;
    for (const kind of NOTIFICATION_KINDS) {
      kinds[kind] = byKind.get(kind) ?? { dm: false, inbox: true };
    }
    return {
      dmDigest: this.isUserDmDigestEnabled(userId),
      kinds,
    };
  }

  setUserKindPref(
    userId: string,
    kind: NotificationKind,
    patch: { dm?: boolean; inbox?: boolean },
  ): UserKindPref {
    const at = this.clock.now();
    this.store.transaction(() => {
      this.ensureUser(userId, at);
      const current = this.getUserKindPref(userId, kind);
      const dm = patch.dm ?? current.dm;
      const inbox = patch.inbox ?? current.inbox;
      this.store
        .stmt(
          `INSERT INTO notification_prefs (user_id, kind, dm, inbox, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (user_id, kind) DO UPDATE SET
             dm = excluded.dm,
             inbox = excluded.inbox,
             updated_at = excluded.updated_at`,
        )
        .run(userId, kind, dm ? 1 : 0, inbox ? 1 : 0, at);
    });
    return this.getUserKindPref(userId, kind);
  }

  isUserDmDigestEnabled(userId: string): boolean {
    const row = this.store
      .stmt('SELECT dm_digest FROM user_settings WHERE user_id = ?')
      .get(userId) as { dm_digest: number } | undefined;
    return row ? row.dm_digest === 1 : true;
  }

  setUserDmDigest(userId: string, enabled: boolean): boolean {
    const at = this.clock.now();
    this.store.transaction(() => {
      this.ensureUser(userId, at);
      this.store
        .stmt(
          `INSERT INTO user_settings (user_id, dm_digest, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET
             dm_digest = excluded.dm_digest,
             updated_at = excluded.updated_at`,
        )
        .run(userId, enabled ? 1 : 0, at);
    });
    return this.isUserDmDigestEnabled(userId);
  }

  /** Disable all opted-in DM notification kinds for `userId` (called after a closed-DM failure). */
  disableAllUserDms(userId: string): number {
    const at = this.clock.now();
    const result = this.store
      .stmt('UPDATE notification_prefs SET dm = 0, updated_at = ? WHERE user_id = ? AND dm = 1')
      .run(at, userId);
    return result.changes;
  }

  /**
   * Resolve a user's DM locale: explicit `user_settings.locale` → guild locale → `en`.
   */
  async resolveUserLocale(
    userId: string,
    guildId: string,
    fetchGuildLocale: (guildId: string) => Promise<string | null>,
  ): Promise<Locale> {
    const row = this.store
      .stmt('SELECT locale FROM user_settings WHERE user_id = ?')
      .get(userId) as { locale: string | null } | undefined;
    const userLocale = normalizeLocale(row?.locale);
    if (userLocale) return userLocale;
    return this.resolveGuildLocale(guildId, fetchGuildLocale);
  }

  private ensureGuildConfig(guildId: string, at: number): void {
    this.store
      .stmt(
        `INSERT OR IGNORE INTO guilds (guild_id, status, created_at, updated_at)
         VALUES (?, 'pending', ?, ?)`,
      )
      .run(guildId, at, at);
    this.store
      .stmt('INSERT OR IGNORE INTO guild_config (guild_id, updated_at) VALUES (?, ?)')
      .run(guildId, at);
  }

  private ensureUser(userId: string, at: number): void {
    this.store
      .stmt('INSERT OR IGNORE INTO users (user_id, created_at, updated_at) VALUES (?, ?, ?)')
      .run(userId, at, at);
  }
}
