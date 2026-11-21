import type { Store } from './store.ts';

export type GuildStatus = 'pending' | 'approved' | 'denied';

export interface UserProfile {
  userId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

/** Rows that identify people and guilds. Money is not touched here. */
export class IdentityRepo {
  private readonly store: Store;
  private readonly now: () => number;

  constructor(store: Store, now: () => number) {
    this.store = store;
    this.now = now;
  }

  /** Insert the user if unknown; keep any profile already stored. */
  ensureUser(userId: string): void {
    const at = this.now();
    this.store
      .stmt('INSERT OR IGNORE INTO users (user_id, created_at, updated_at) VALUES (?, ?, ?)')
      .run(userId, at, at);
  }

  upsertUser(profile: UserProfile): void {
    const at = this.now();
    this.store
      .stmt(
        `INSERT INTO users (user_id, username, global_name, avatar, created_at, updated_at)
         VALUES (@userId, @username, @globalName, @avatar, @at, @at)
         ON CONFLICT (user_id) DO UPDATE SET
           username = excluded.username, global_name = excluded.global_name,
           avatar = excluded.avatar, updated_at = excluded.updated_at`,
      )
      .run({ ...profile, at });
  }

  getUser(userId: string): UserProfile | null {
    const row = this.store
      .stmt('SELECT user_id, username, global_name, avatar FROM users WHERE user_id = ?')
      .get(userId) as
      | { user_id: string; username: string; global_name: string | null; avatar: string | null }
      | undefined;
    return row
      ? {
          userId: row.user_id,
          username: row.username,
          globalName: row.global_name,
          avatar: row.avatar,
        }
      : null;
  }

  /**
   * Insert the guild (and its config row) if unknown. The status only applies to a new row;
   * an existing guild keeps the decision already made.
   */
  ensureGuild(guildId: string, status: GuildStatus, name: string | null = null): void {
    const at = this.now();
    this.store.transaction(() => {
      this.store
        .stmt(
          `INSERT OR IGNORE INTO guilds (guild_id, name, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(guildId, name, status, at, at);
      this.store
        .stmt('INSERT OR IGNORE INTO guild_config (guild_id, updated_at) VALUES (?, ?)')
        .run(guildId, at);
    });
  }

  setGuildName(guildId: string, name: string): void {
    this.store
      .stmt('UPDATE guilds SET name = ?, updated_at = ? WHERE guild_id = ? AND name IS NOT ?')
      .run(name, this.now(), guildId, name);
  }

  getGuildStatus(guildId: string): GuildStatus | null {
    const row = this.store.stmt('SELECT status FROM guilds WHERE guild_id = ?').get(guildId) as
      { status: GuildStatus } | undefined;
    return row?.status ?? null;
  }

  setGuildStatus(guildId: string, status: GuildStatus, decidedBy: string | null = null): void {
    const at = this.now();
    this.store
      .stmt(
        'UPDATE guilds SET status = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE guild_id = ?',
      )
      .run(status, decidedBy, at, at, guildId);
  }

  getUserLocale(userId: string): string | null {
    const row = this.store
      .stmt('SELECT locale FROM user_settings WHERE user_id = ?')
      .get(userId) as { locale: string | null } | undefined;
    return row?.locale ?? null;
  }

  getGuildLocale(guildId: string): string | null {
    const row = this.store
      .stmt('SELECT locale FROM guild_config WHERE guild_id = ?')
      .get(guildId) as { locale: string | null } | undefined;
    return row?.locale ?? null;
  }
}
