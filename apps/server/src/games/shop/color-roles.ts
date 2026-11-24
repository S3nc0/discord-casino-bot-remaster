import type { Clock } from '@casino/shared';
import {
  botStanding,
  colorRoleName,
  COLOR_ROLES,
  isColorRoleItem,
  isSafeColorRole,
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

/** Retry delay after a missing permission or a role too low (at least; see `retryDelay`). */
export const COLOR_ROLE_RETRY_MS = 600_000;
export const COLOR_ROLE_LOG_THROTTLE_MS = 600_000;
/** Back-off of a failed sync, by attempt: 30 s, 2 min, 10 min, 1 h, then hourly. */
export const COLOR_ROLE_BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000] as const;
/** Unexpected errors before an addition is given up (a removal never is). */
export const COLOR_ROLE_MAX_ERRORS = 3;
/** How long a blocked addition is retried before it is given up (a removal never is). */
export const COLOR_ROLE_GIVE_UP_MS = 86_400_000;
/** Rows one sweep looks at. */
const SWEEP_BATCH = 50;
const AUDIT_REASON = 'Pelica shop: name colour / ペリカショップ: 名前の色';

/** Delay before the next attempt after `tries` failed ones. */
export function retryDelay(tries: number, blocked: boolean): number {
  const step =
    COLOR_ROLE_BACKOFF_MS[Math.min(tries, COLOR_ROLE_BACKOFF_MS.length) - 1] ?? 3_600_000;
  return blocked ? Math.max(COLOR_ROLE_RETRY_MS, step) : step;
}

interface SyncRow {
  guild_id: string;
  user_id: string;
  queued_at: number;
  tries: number;
  seq: number;
}

interface WarnLogger {
  warn(obj: object, msg: string): void;
}

const QUIET: WarnLogger = { warn: () => {} };

class Retry extends Error {}

const SUCCESS: ReadonlySet<ColorRoleSyncResult> = new Set([
  'applied',
  'removed',
  'name_taken',
  'gone',
]);

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
   * True when Discord already matches the database for the member: nothing is queued and the
   * role the bot put on them is the one of the worn colour (or none when nothing is worn).
   */
  upToDate(guildId: string, userId: string): boolean {
    const queued = this.store
      .stmt('SELECT 1 FROM color_role_sync WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId);
    if (queued !== undefined) return false;
    const worn = this.equipped(guildId, userId);
    const holder = this.holder(guildId, userId);
    return worn === null
      ? holder === null
      : holder !== null && holder === this.roleIdOf(guildId, worn);
  }

  /**
   * Apply the member's pending change now (after the equip committed), waiting at most
   * `timeoutMs`; past that the sync carries on in the background and `pending` is returned.
   * With nothing queued it answers from the database without calling Discord.
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

  /**
   * Job: apply every due `color_role_sync` row, except in guilds the owner denied (their rows
   * wait untouched until the guild is approved again). Returns how many were settled. Never throws.
   */
  async sweep(): Promise<number> {
    if (!this.port || this.sweeping) return 0;
    this.sweeping = true;
    let settled = 0;
    try {
      const rows = this.store
        .stmt(
          `SELECT s.guild_id, s.user_id FROM color_role_sync s
           WHERE s.next_at <= ?
             AND NOT EXISTS (SELECT 1 FROM guilds g WHERE g.guild_id = s.guild_id AND g.status = 'denied')
           ORDER BY s.next_at, s.queued_at LIMIT ?`,
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
          'SELECT guild_id, user_id, queued_at, tries, seq FROM color_role_sync WHERE guild_id = ? AND user_id = ?',
        )
        .get(guildId, userId) as SyncRow | undefined;
      const desired = this.equipped(guildId, userId);
      // Nothing queued: Discord already matches (an equip of the colour already worn).
      if (!row) return desired === null ? 'removed' : 'applied';
      let result: ColorRoleSyncResult;
      try {
        try {
          result = await this.sync(port, guildId, userId, desired);
        } catch (error) {
          if (!(error instanceof Retry)) throw error;
          // The stored role was deleted in Discord: it was forgotten, so this round creates a new one.
          result = await this.sync(port, guildId, userId, desired);
        }
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

  /**
   * Keep or drop the member's row. The state left to reach is read again from the database: while
   * the bot still has a colour role on the member that is not the worn colour's, the removal stays
   * queued (with back-off) however often it fails. Only an addition may be given up.
   */
  private settle(
    row: SyncRow,
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
      const worn = this.equipped(guildId, userId);
      const holder = this.holder(guildId, userId);
      const removalPending =
        holder !== null && (worn === null || holder !== this.roleIdOf(guildId, worn));
      const blocked = result === 'missing_permissions' || result === 'hierarchy';
      const tries = row.tries + 1;
      const giveUp =
        !removalPending &&
        (SUCCESS.has(result) ||
          (result === 'error' && tries >= COLOR_ROLE_MAX_ERRORS) ||
          (blocked && now - row.queued_at >= COLOR_ROLE_GIVE_UP_MS));
      if (giveUp) {
        this.store
          .stmt('DELETE FROM color_role_sync WHERE guild_id = ? AND user_id = ? AND seq = ?')
          .run(guildId, userId, row.seq);
        return;
      }
      this.store
        .stmt(
          'UPDATE color_role_sync SET tries = ?, next_at = ? WHERE guild_id = ? AND user_id = ? AND seq = ?',
        )
        .run(
          tries,
          now + retryDelay(tries, blocked || result === 'name_taken'),
          guildId,
          userId,
          row.seq,
        );
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

  /**
   * Bring the member's Discord roles in line with `desired`. Every role is checked against a fresh
   * snapshot before it is touched (`dropUnsafe`): the bot only adds or removes a role it created
   * that still has its colour's name, no permission and is not managed.
   */
  private async sync(
    port: ColorRoleRest,
    guildId: string,
    userId: string,
    desired: string | null,
  ): Promise<ColorRoleSyncResult> {
    let snapshot: { roles: RoleSnapshot[]; botRoleIds: string[] };
    try {
      snapshot = await port.guildRoles(guildId);
    } catch (error) {
      const failure = classifyDiscordError(error);
      return failure === 'unknown_guild' || failure === 'unknown_member' ? 'gone' : 'error';
    }
    this.dropUnsafe(guildId, snapshot.roles);
    const standing = botStanding(guildId, snapshot.roles, snapshot.botRoleIds);
    const holder = this.holder(guildId, userId);
    const pick =
      desired === null
        ? null
        : pickColorRole({
            itemId: desired,
            roles: snapshot.roles,
            knownRoleId: this.roleIdOf(guildId, desired),
          });
    const targetId = pick?.kind === 'use' ? pick.roleId : null;

    // 1. Take off the colour role the member wears that is not the target (checked safe above).
    if (holder !== null && holder !== targetId) {
      if (!standing.canManageRoles) return 'missing_permissions';
      const worn = snapshot.roles.find((r) => r.id === holder);
      if (worn && worn.position >= standing.top) return 'hierarchy';
      const failure = await attempt(() => port.removeMemberRole(guildId, userId, holder));
      switch (failure) {
        case null:
        case 'unknown_role':
          this.setHolder(guildId, userId, null);
          break;
        case 'unknown_member':
          this.setHolder(guildId, userId, null);
          return 'gone';
        case 'unknown_guild':
          return 'gone';
        case 'forbidden':
          return 'hierarchy';
        default:
          return 'error';
      }
    }
    if (desired === null || pick === null) return 'removed';
    if (pick.kind === 'refuse') return 'name_taken';
    if (!standing.canManageRoles) return 'missing_permissions';
    return this.apply(port, guildId, userId, desired, pick, standing, snapshot.roles, holder);
  }

  /** Put the colour's role on the member, creating or fixing the role first. */
  private async apply(
    port: ColorRoleRest,
    guildId: string,
    userId: string,
    itemId: string,
    pick: Exclude<ReturnType<typeof pickColorRole>, { kind: 'refuse' }>,
    standing: { top: number; canManageRoles: boolean },
    roles: readonly RoleSnapshot[],
    holder: string | null,
  ): Promise<ColorRoleSyncResult> {
    const spec = COLOR_ROLES[itemId];
    if (!spec) return 'removed';
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
        if (failure === 'unknown_role') {
          this.forget(guildId, itemId);
          throw new Retry();
        }
        if (failure === 'error') return 'error';
      }
      const ours = new Set(this.ourRoleIds(guildId));
      if (needsMove(role, standing.top, roles, ours)) {
        const failure = await attempt(() =>
          port.setRolePosition(guildId, roleId, wantedPosition(standing.top)),
        );
        if (failure === 'unknown_role') {
          this.forget(guildId, itemId);
          throw new Retry();
        }
        // A refused move is fine as long as the role stays below the bot (checked next).
      }
      if (role.position >= standing.top) return 'hierarchy';
    }

    if (holder === roleId) return 'applied';
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

  /**
   * Stop touching any stored colour role that is gone from Discord, was renamed, gained a
   * permission or became managed: it is forgotten (with every member said to wear it) and never
   * added to or removed from anyone again. A changed role is logged once per guild per 10 minutes.
   */
  private dropUnsafe(guildId: string, roles: readonly RoleSnapshot[]): void {
    const stored = this.store
      .stmt('SELECT item_id, role_id FROM color_roles WHERE guild_id = ?')
      .all(guildId) as { item_id: string; role_id: string }[];
    for (const row of stored) {
      const role = roles.find((r) => r.id === row.role_id);
      if (role && role.name === colorRoleName(row.item_id) && isSafeColorRole(role)) continue;
      this.forget(guildId, row.item_id);
      if (role)
        this.logOnce(
          guildId,
          { roleId: row.role_id, itemId: row.item_id },
          'a colour role was renamed or given a permission; the bot no longer touches it',
        );
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

  /** Forget a stored role (and any member said to wear it): the bot no longer touches it. */
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
