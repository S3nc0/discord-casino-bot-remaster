import type { Clock } from '@casino/shared';
import {
  botStanding,
  COLOR_ROLES,
  isColorRoleItem,
  needsMove,
  pickColorRole,
  wantedPosition,
  type RoleSnapshot,
} from '@casino/domain/shop';
import { Routes } from 'discord.js';
import type { Store } from '../../db/store.ts';

/**
 * Name-colour roles (docs/spec/shop.md §2). The database decides who wears which colour
 * (`profiles.color_role`); this module brings Discord in line, always after the transaction that
 * changed it has committed, and never inside a money or inventory transaction. Every change
 * leaves a `color_role_sync` row; the 30 s sweep (and the equip that wrote it) applies it, so a
 * restart or a Discord hiccup only delays the role. The bot only ever touches the roles it created
 * (`color_roles`); a foreign role with a colour's name is refused, never adopted.
 */

/** The Discord REST calls this feature makes. Implemented over the bot's client, faked in tests. */
export interface ColorRoleRest {
  /** The guild's roles and the role ids of the bot's own member. */
  guildRoles(guildId: string): Promise<{ roles: RoleSnapshot[]; botRoleIds: string[] }>;
  /** A role with no permission, not hoisted, not mentionable. */
  createRole(guildId: string, input: { name: string; color: number }): Promise<RoleSnapshot>;
  setRoleColor(guildId: string, roleId: string, color: number): Promise<void>;
  setRolePosition(guildId: string, roleId: string, position: number): Promise<void>;
  addMemberRole(guildId: string, userId: string, roleId: string): Promise<void>;
  removeMemberRole(guildId: string, userId: string, roleId: string): Promise<void>;
}

/** What one sync did. */
export type ColorRoleSyncResult =
  /** The member wears the equipped colour's role. */
  | 'applied'
  /** No colour equipped, and the bot's colour role is off the member (or was never on). */
  | 'removed'
  /** No Discord client (`BOT_DISABLED=1`, tests): the request waits for the sweep. */
  | 'skipped'
  /** The bot lacks Manage Roles. The choice stays recorded. */
  | 'missing_permissions'
  /** The bot's role is not above the colour role (or the bot has no role of its own). */
  | 'hierarchy'
  /** A role with the colour's name exists that the bot may not use: the choice is undone. */
  | 'name_taken'
  /** The guild or the member is gone: nothing to do. */
  | 'gone'
  /** An unexpected Discord error: retried a few times. */
  | 'error';

/** What the member is told after equipping (null when there is nothing to say). */
export type ColorRoleNotice = 'missing_permissions' | 'hierarchy' | 'name_taken' | 'pending';

export function noticeOf(result: ColorRoleSyncResult | 'pending'): ColorRoleNotice | null {
  switch (result) {
    case 'missing_permissions':
    case 'hierarchy':
    case 'name_taken':
    case 'pending':
      return result;
    default:
      return null;
  }
}

type Failure = 'forbidden' | 'unknown_role' | 'unknown_member' | 'unknown_guild' | 'error';

/** Discord REST error codes told apart here. */
const MISSING_ACCESS = 50001;
const MISSING_PERMISSIONS = 50013;
const UNKNOWN_GUILD = 10004;
const UNKNOWN_MEMBER = 10007;
const UNKNOWN_ROLE = 10011;

export function classifyDiscordError(error: unknown): Failure {
  const code = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown };
  switch (code.code) {
    case MISSING_PERMISSIONS:
      return 'forbidden';
    case MISSING_ACCESS:
    case UNKNOWN_GUILD:
      return 'unknown_guild';
    case UNKNOWN_MEMBER:
      return 'unknown_member';
    case UNKNOWN_ROLE:
      return 'unknown_role';
    default:
      return 'error';
  }
}

/** Sweep cadence for blocked rows, and the log throttle per guild. */
export const COLOR_ROLE_RETRY_MS = 600_000;
export const COLOR_ROLE_LOG_THROTTLE_MS = 600_000;
/** Unexpected errors before a row is dropped. */
export const COLOR_ROLE_MAX_ERRORS = 3;
/** 10-minute retries of a blocked row (one day) before it is dropped. */
export const COLOR_ROLE_MAX_BLOCKED = 144;
/** Rows one sweep looks at. */
const SWEEP_BATCH = 50;
const AUDIT_REASON = 'Pelica shop: name colour / ペリカショップ: 名前の色';

interface SyncRow {
  guild_id: string;
  user_id: string;
  tries: number;
  seq: number;
}

interface WarnLogger {
  warn(obj: object, msg: string): void;
}

const QUIET: WarnLogger = { warn: () => {} };

class Retry extends Error {}

export class ColorRoleService {
  private readonly store: Store;
  private readonly clock: Clock;
  private port: ColorRoleRest | null = null;
  private logger: WarnLogger = QUIET;
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly lastLog = new Map<string, number>();
  private sweeping = false;

  constructor(deps: { store: Store; clock: Clock }) {
    this.store = deps.store;
    this.clock = deps.clock;
  }

  /** Attach the Discord side after the bot logs in; `null` on shutdown. */
  attach(port: ColorRoleRest | null, logger?: WarnLogger): void {
    this.port = port;
    if (logger) this.logger = logger;
  }

  get attached(): boolean {
    return this.port !== null;
  }

  /** The colour the member wears in the database (null when none, or no longer owned). */
  equipped(guildId: string, userId: string): string | null {
    const row = this.store
      .stmt(
        `SELECT p.color_role AS item FROM profiles p
         JOIN inventory i ON i.guild_id = p.guild_id AND i.user_id = p.user_id AND i.item_id = p.color_role
         WHERE p.guild_id = ? AND p.user_id = ? AND i.qty > 0`,
      )
      .get(guildId, userId) as { item: string } | undefined;
    return row && isColorRoleItem(row.item) ? row.item : null;
  }

  /**
   * Apply the member's pending change now (after the equip committed), waiting at most
   * `timeoutMs`; past that the sync carries on in the background and `pending` is returned.
   * Discord failures never throw; calling it inside a transaction is a bug and does.
   */
  async syncNow(
    guildId: string,
    userId: string,
    timeoutMs = 5000,
  ): Promise<ColorRoleSyncResult | 'pending'> {
    if (this.store.inTransaction) throw new Error('colour roles sync after the commit');
    const run = this.process(guildId, userId);
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<'pending'>((resolve) => {
      timer = setTimeout(() => resolve('pending'), timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([run, late]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Job: apply every due `color_role_sync` row. Returns how many were settled. Never throws. */
  async sweep(): Promise<number> {
    if (!this.port || this.sweeping) return 0;
    this.sweeping = true;
    let settled = 0;
    try {
      const rows = this.store
        .stmt(
          'SELECT guild_id, user_id FROM color_role_sync WHERE next_at <= ? ORDER BY next_at, queued_at LIMIT ?',
        )
        .all(this.clock.now(), SWEEP_BATCH) as { guild_id: string; user_id: string }[];
      for (const row of rows) {
        const result = await this.process(row.guild_id, row.user_id);
        if (result !== 'skipped') settled += 1;
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'colour role sweep failed');
    } finally {
      this.sweeping = false;
    }
    return settled;
  }

  // ------------------------------------------------------------------ internals

  /** One sync of one member under the guild's lock, then the row is settled. Never throws. */
  private process(guildId: string, userId: string): Promise<ColorRoleSyncResult> {
    return this.withGuildLock(guildId, async () => {
      const port = this.port;
      if (!port) return 'skipped';
      const row = this.store
        .stmt(
          'SELECT guild_id, user_id, tries, seq FROM color_role_sync WHERE guild_id = ? AND user_id = ?',
        )
        .get(guildId, userId) as SyncRow | undefined;
      const desired = this.equipped(guildId, userId);
      let result: ColorRoleSyncResult;
      try {
        result = await this.sync(port, guildId, userId, desired);
      } catch (error) {
        this.logOnce(guildId, { err: error, userId }, 'colour role sync failed');
        result = 'error';
      }
      this.settle(row, guildId, userId, desired, result);
      return result;
    });
  }

  private withGuildLock<T>(guildId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(guildId) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.locks.set(guildId, tail);
    void tail.then(() => {
      if (this.locks.get(guildId) === tail) this.locks.delete(guildId);
    });
    return next;
  }

  private settle(
    row: SyncRow | undefined,
    guildId: string,
    userId: string,
    desired: string | null,
    result: ColorRoleSyncResult,
  ): void {
    if (result === 'skipped') return;
    const now = this.clock.now();
    this.store.transaction(() => {
      if (result === 'name_taken' && desired !== null) {
        // Refused, not adopted: the member is not wearing that colour after all.
        this.store
          .stmt(
            'UPDATE profiles SET color_role = NULL WHERE guild_id = ? AND user_id = ? AND color_role = ?',
          )
          .run(guildId, userId, desired);
      }
      if (!row) return;
      const blocked = result === 'missing_permissions' || result === 'hierarchy';
      const failed = blocked || result === 'error';
      const tries = row.tries + 1;
      const drop =
        !failed ||
        (result === 'error' && tries >= COLOR_ROLE_MAX_ERRORS) ||
        (blocked && tries >= COLOR_ROLE_MAX_BLOCKED);
      if (drop) {
        this.store
          .stmt('DELETE FROM color_role_sync WHERE guild_id = ? AND user_id = ? AND seq = ?')
          .run(guildId, userId, row.seq);
        return;
      }
      this.store
        .stmt(
          'UPDATE color_role_sync SET tries = ?, next_at = ? WHERE guild_id = ? AND user_id = ? AND seq = ?',
        )
        .run(tries, blocked ? now + COLOR_ROLE_RETRY_MS : now, guildId, userId, row.seq);
    });
    if (result === 'missing_permissions' || result === 'hierarchy' || result === 'name_taken') {
      this.logOnce(
        guildId,
        { reason: result, userId },
        result === 'missing_permissions'
          ? 'cannot set name colour roles: the bot needs the Manage Roles permission'
          : result === 'hierarchy'
            ? "cannot set name colour roles: move the bot's role above the colour roles"
            : 'a role with a colour role name exists that the bot did not create; ask an admin to rename it',
      );
    }
  }

  private async sync(
    port: ColorRoleRest,
    guildId: string,
    userId: string,
    desired: string | null,
  ): Promise<ColorRoleSyncResult> {
    const holder = this.holder(guildId, userId);
    if (desired === null) {
      if (holder === null) return 'removed';
      const failure = await attempt(() => port.removeMemberRole(guildId, userId, holder));
      if (failure === 'forbidden') return this.blockedReason(port, guildId);
      if (failure === 'error') return 'error';
      this.setHolder(guildId, userId, null);
      return failure === 'unknown_guild' ? 'gone' : 'removed';
    }
    try {
      return await this.apply(port, guildId, userId, desired, holder);
    } catch (error) {
      if (!(error instanceof Retry)) throw error;
      // The stored role was deleted in Discord: it was forgotten, so this round creates a new one.
      return this.apply(port, guildId, userId, desired, this.holder(guildId, userId));
    }
  }

  private async apply(
    port: ColorRoleRest,
    guildId: string,
    userId: string,
    itemId: string,
    holder: string | null,
  ): Promise<ColorRoleSyncResult> {
    const spec = COLOR_ROLES[itemId];
    if (!spec) return 'removed';
    let snapshot: { roles: RoleSnapshot[]; botRoleIds: string[] };
    try {
      snapshot = await port.guildRoles(guildId);
    } catch (error) {
      const failure = classifyDiscordError(error);
      return failure === 'unknown_guild' || failure === 'unknown_member' ? 'gone' : 'error';
    }
    const standing = botStanding(guildId, snapshot.roles, snapshot.botRoleIds);
    const pick = pickColorRole({
      itemId,
      roles: snapshot.roles,
      knownRoleId: this.roleIdOf(guildId, itemId),
    });
    if (pick.kind === 'refuse') {
      // The choice is undone (see `settle`): take off the colour the member wore before, if any.
      if (holder !== null && standing.canManageRoles) {
        const failure = await attempt(() => port.removeMemberRole(guildId, userId, holder));
        if (failure === null || failure === 'unknown_role' || failure === 'unknown_member')
          this.setHolder(guildId, userId, null);
      }
      return 'name_taken';
    }
    if (!standing.canManageRoles) return 'missing_permissions';

    let roleId: string;
    let role: RoleSnapshot | null;
    if (pick.kind === 'create') {
      try {
        role = await port.createRole(guildId, { name: pick.name, color: pick.color });
      } catch (error) {
        const failure = classifyDiscordError(error);
        if (failure === 'forbidden') return 'missing_permissions';
        if (failure === 'unknown_guild') return 'gone';
        return 'error';
      }
      roleId = role.id;
      this.store
        .stmt(
          `INSERT INTO color_roles (guild_id, item_id, role_id, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (guild_id, item_id) DO UPDATE SET role_id = excluded.role_id, created_at = excluded.created_at`,
        )
        .run(guildId, itemId, roleId, this.clock.now());
    } else {
      roleId = pick.roleId;
      role = pick.role;
    }

    if (role) {
      if (role.color !== spec.color) {
        const failure = await attempt(() => port.setRoleColor(guildId, roleId, spec.color));
        if (failure === 'unknown_role') this.forget(guildId, itemId);
        if (failure === 'error') return 'error';
      }
      const ours = new Set(this.ourRoleIds(guildId));
      if (needsMove(role, standing.top, snapshot.roles, ours)) {
        const failure = await attempt(() =>
          port.setRolePosition(guildId, roleId, wantedPosition(standing.top)),
        );
        if (failure === 'unknown_role') this.forget(guildId, itemId);
        // A refused move is fine as long as the role stays below the bot (checked next).
      }
      if (role.position >= standing.top) return 'hierarchy';
    }

    if (holder !== null && holder !== roleId) {
      const failure = await attempt(() => port.removeMemberRole(guildId, userId, holder));
      if (failure === 'forbidden') return 'hierarchy';
      if (failure === 'error') return 'error';
      if (failure === 'unknown_member') return 'gone';
      this.setHolder(guildId, userId, null);
    }

    const failure = await attempt(() => port.addMemberRole(guildId, userId, roleId));
    switch (failure) {
      case null:
        this.setHolder(guildId, userId, roleId);
        return 'applied';
      case 'unknown_role':
        this.forget(guildId, itemId);
        throw new Retry();
      case 'forbidden':
        return 'hierarchy';
      case 'unknown_member':
      case 'unknown_guild':
        return 'gone';
      default:
        return 'error';
    }
  }

  /** With Manage Roles granted, a refused call means the role sits above the bot. */
  private async blockedReason(port: ColorRoleRest, guildId: string): Promise<ColorRoleSyncResult> {
    try {
      const snapshot = await port.guildRoles(guildId);
      return botStanding(guildId, snapshot.roles, snapshot.botRoleIds).canManageRoles
        ? 'hierarchy'
        : 'missing_permissions';
    } catch {
      return 'missing_permissions';
    }
  }

  private roleIdOf(guildId: string, itemId: string): string | null {
    const row = this.store
      .stmt('SELECT role_id FROM color_roles WHERE guild_id = ? AND item_id = ?')
      .get(guildId, itemId) as { role_id: string } | undefined;
    return row?.role_id ?? null;
  }

  private ourRoleIds(guildId: string): string[] {
    return (
      this.store.stmt('SELECT role_id FROM color_roles WHERE guild_id = ?').all(guildId) as {
        role_id: string;
      }[]
    ).map((r) => r.role_id);
  }

  /** The role was deleted in Discord: forget it (and any member said to wear it). */
  private forget(guildId: string, itemId: string): void {
    const roleId = this.roleIdOf(guildId, itemId);
    if (roleId === null) return;
    this.store.transaction(() => {
      this.store
        .stmt('DELETE FROM color_roles WHERE guild_id = ? AND item_id = ?')
        .run(guildId, itemId);
      this.store
        .stmt('DELETE FROM color_role_holders WHERE guild_id = ? AND role_id = ?')
        .run(guildId, roleId);
    });
  }

  /** The colour role the bot last put on the member, if it is still one of ours. */
  private holder(guildId: string, userId: string): string | null {
    const row = this.store
      .stmt(
        `SELECT h.role_id FROM color_role_holders h
         JOIN color_roles r ON r.guild_id = h.guild_id AND r.role_id = h.role_id
         WHERE h.guild_id = ? AND h.user_id = ?`,
      )
      .get(guildId, userId) as { role_id: string } | undefined;
    return row?.role_id ?? null;
  }

  private setHolder(guildId: string, userId: string, roleId: string | null): void {
    if (roleId === null) {
      this.store
        .stmt('DELETE FROM color_role_holders WHERE guild_id = ? AND user_id = ?')
        .run(guildId, userId);
      return;
    }
    this.store
      .stmt(
        `INSERT INTO color_role_holders (guild_id, user_id, role_id, applied_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET role_id = excluded.role_id, applied_at = excluded.applied_at`,
      )
      .run(guildId, userId, roleId, this.clock.now());
  }

  private logOnce(guildId: string, fields: object, message: string): void {
    const now = this.clock.now();
    const last = this.lastLog.get(guildId);
    if (last !== undefined && now - last < COLOR_ROLE_LOG_THROTTLE_MS) return;
    this.lastLog.set(guildId, now);
    this.logger.warn({ guildId, ...fields }, message);
  }
}

/** Run one Discord call; null on success, else what went wrong. */
async function attempt(call: () => Promise<unknown>): Promise<Failure | null> {
  try {
    await call();
    return null;
  } catch (error) {
    return classifyDiscordError(error);
  }
}

// ------------------------------------------------------------------ discord.js port

interface RestLike {
  get(route: `/${string}`): Promise<unknown>;
  post(route: `/${string}`, options: { body: unknown; reason?: string }): Promise<unknown>;
  patch(route: `/${string}`, options: { body: unknown; reason?: string }): Promise<unknown>;
  put(route: `/${string}`, options?: { reason?: string }): Promise<unknown>;
  delete(route: `/${string}`, options?: { reason?: string }): Promise<unknown>;
}

interface ApiRole {
  id: string;
  name: string;
  color?: number;
  colors?: { primary_color?: number };
  position: number;
  permissions: string;
  managed: boolean;
}

function toSnapshot(role: ApiRole): RoleSnapshot {
  return {
    id: role.id,
    name: role.name,
    color: role.colors?.primary_color ?? role.color ?? 0,
    position: role.position,
    permissions: role.permissions,
    managed: role.managed,
  };
}

/**
 * The port over the logged-in discord.js client's REST manager. Only the Guilds intent is needed:
 * the role list and the bot's own member are read over REST, no member cache is used.
 */
export function createDiscordColorRolePort(client: {
  rest: unknown;
  user: { id: string } | null;
}): ColorRoleRest {
  const rest = client.rest as RestLike;
  const botId = (): string => {
    if (!client.user) throw new Error('bot not logged in');
    return client.user.id;
  };
  return {
    async guildRoles(guildId) {
      const roles = (await rest.get(Routes.guildRoles(guildId))) as ApiRole[];
      const me = (await rest.get(Routes.guildMember(guildId, botId()))) as { roles: string[] };
      return { roles: roles.map(toSnapshot), botRoleIds: me.roles };
    },
    async createRole(guildId, input) {
      const role = (await rest.post(Routes.guildRoles(guildId), {
        body: {
          name: input.name,
          colors: { primary_color: input.color, secondary_color: null, tertiary_color: null },
          permissions: '0',
          hoist: false,
          mentionable: false,
        },
        reason: AUDIT_REASON,
      })) as ApiRole;
      return toSnapshot(role);
    },
    async setRoleColor(guildId, roleId, color) {
      await rest.patch(Routes.guildRole(guildId, roleId), {
        body: { colors: { primary_color: color, secondary_color: null, tertiary_color: null } },
        reason: AUDIT_REASON,
      });
    },
    async setRolePosition(guildId, roleId, position) {
      await rest.patch(Routes.guildRoles(guildId), {
        body: [{ id: roleId, position }],
        reason: AUDIT_REASON,
      });
    },
    async addMemberRole(guildId, userId, roleId) {
      await rest.put(Routes.guildMemberRole(guildId, userId, roleId), { reason: AUDIT_REASON });
    },
    async removeMemberRole(guildId, userId, roleId) {
      await rest.delete(Routes.guildMemberRole(guildId, userId, roleId), { reason: AUDIT_REASON });
    },
  };
}
