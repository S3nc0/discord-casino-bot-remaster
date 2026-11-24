/**
 * Name-colour roles (docs/spec/shop.md §2). A `color_role` item colours its owner's name in the
 * server through a Discord role named `COLOR_ROLE_PREFIX` + the colour's name. Pure rules only:
 * which role to use, whether a role is safe to touch, where it belongs. The server keeps the ids
 * of the roles it created and never touches any other role.
 */

/** `role_prefix` of catalogs/shop.yaml. */
export const COLOR_ROLE_PREFIX = 'ペリカ・';

export interface ColorRoleSpec {
  /** The colour's name in the role name (the item's Japanese name in catalogs/shop.yaml). */
  name: string;
  /** RGB colour of the role (`value` in catalogs/shop.yaml). */
  color: number;
}

/** The 12 colours of catalogs/shop.yaml (`kind: color_role`), by item id. */
export const COLOR_ROLES: Readonly<Record<string, ColorRoleSpec>> = {
  role_red: { name: '赤', color: 0xe74c3c },
  role_orange: { name: '橙', color: 0xe67e22 },
  role_yellow: { name: '黄', color: 0xf1c40f },
  role_green: { name: '緑', color: 0x2ecc71 },
  role_cyan: { name: '水色', color: 0x1abc9c },
  role_blue: { name: '青', color: 0x3498db },
  role_purple: { name: '紫', color: 0x9b59b6 },
  role_pink: { name: '桃', color: 0xff69b4 },
  role_gold: { name: '金', color: 0xd4af37 },
  role_silver: { name: '銀', color: 0xbdc3c7 },
  role_black: { name: '黒', color: 0x010101 },
  role_white: { name: '白', color: 0xfefefe },
};

export function isColorRoleItem(itemId: string): boolean {
  return Object.hasOwn(COLOR_ROLES, itemId);
}

/** The Discord role name of a colour item (`ペリカ・赤`), or null for any other item. */
export function colorRoleName(itemId: string): string | null {
  const spec = isColorRoleItem(itemId) ? COLOR_ROLES[itemId] : undefined;
  return spec ? COLOR_ROLE_PREFIX + spec.name : null;
}

/** What the bot sees of a guild role (Discord's role object, trimmed). */
export interface RoleSnapshot {
  id: string;
  name: string;
  color: number;
  position: number;
  /** Discord's permission bit field as a decimal string. */
  permissions: string;
  /** Owned by an integration (a bot's own role, a booster role): never ours to touch. */
  managed: boolean;
}

/** Discord permission bits used here. */
export const PERMISSION_ADMINISTRATOR = 1n << 3n;
export const PERMISSION_MANAGE_ROLES = 1n << 28n;

/** The permission bits, or null when Discord sent something that is not a number. */
function parseBits(permissions: string): bigint | null {
  if (!/^\d+$/.test(permissions)) return null;
  return BigInt(permissions);
}

function bits(permissions: string): bigint {
  return parseBits(permissions) ?? 0n;
}

/** A role the bot may use as a colour role: no permission at all and not managed. */
export function isSafeColorRole(role: Pick<RoleSnapshot, 'permissions' | 'managed'>): boolean {
  return parseBits(role.permissions) === 0n && !role.managed;
}

export interface BotStanding {
  /** Position of the bot's highest role (0 = only @everyone). */
  top: number;
  canManageRoles: boolean;
}

/**
 * The bot's place in the role list: its highest role and whether its roles (with @everyone,
 * whose id is the guild id) grant Manage Roles. Administrator implies every permission.
 */
export function botStanding(
  guildId: string,
  roles: readonly RoleSnapshot[],
  botRoleIds: readonly string[],
): BotStanding {
  const mine = new Set(botRoleIds);
  let top = 0;
  let perms = 0n;
  for (const role of roles) {
    if (role.id !== guildId && !mine.has(role.id)) continue;
    perms |= bits(role.permissions);
    if (role.id !== guildId && role.position > top) top = role.position;
  }
  const canManageRoles =
    (perms & PERMISSION_ADMINISTRATOR) !== 0n || (perms & PERMISSION_MANAGE_ROLES) !== 0n;
  return { top, canManageRoles };
}

export type ColorRolePick =
  /** Use the role the bot created earlier. */
  | { kind: 'use'; role: RoleSnapshot | null; roleId: string }
  /** No usable role yet: create one. */
  | { kind: 'create'; name: string; color: number }
  /**
   * A role with the colour's name exists but the bot did not create it, or it has gained a
   * permission or is managed: refuse, never adopt it (an admin must rename it).
   */
  | { kind: 'refuse'; reason: 'name_taken'; name: string };

/**
 * Which role carries `itemId`'s colour. `knownRoleId` is the id the bot stored when it created
 * the role (null if none). A known role missing from `roles` is still used: the snapshot may be a
 * moment old, and Discord answers "unknown role" if it really is gone (the caller then forgets
 * it and creates a new one).
 */
export function pickColorRole(input: {
  itemId: string;
  roles: readonly RoleSnapshot[];
  knownRoleId: string | null;
}): ColorRolePick {
  const name = colorRoleName(input.itemId);
  const spec = COLOR_ROLES[input.itemId];
  if (name === null || !spec) throw new Error(`not a colour item: ${input.itemId}`);
  if (input.knownRoleId !== null) {
    const role = input.roles.find((r) => r.id === input.knownRoleId) ?? null;
    if (role && !isSafeColorRole(role)) return { kind: 'refuse', reason: 'name_taken', name };
    if (!role || role.name === name) return { kind: 'use', role, roleId: input.knownRoleId };
    // Renamed by an admin: it is no longer the colour role. Leave it alone and look again.
  }
  const sameName = input.roles.filter((r) => r.name === name && r.id !== input.knownRoleId);
  if (sameName.length > 0) return { kind: 'refuse', reason: 'name_taken', name };
  return { kind: 'create', name, color: spec.color };
}

/** Where a colour role belongs: directly below the bot's highest role. */
export function wantedPosition(botTop: number): number {
  return Math.max(1, botTop - 1);
}

/**
 * Whether `target` must move up. It may stay where it is when every role between it and the
 * bot's highest role is one of our colour roles (they sit together right below the bot), so
 * switching colours does not reshuffle the list each time.
 */
export function needsMove(
  target: Pick<RoleSnapshot, 'id' | 'position'>,
  botTop: number,
  roles: readonly Pick<RoleSnapshot, 'id' | 'position'>[],
  ourRoleIds: ReadonlySet<string>,
): boolean {
  if (target.position >= botTop) return false; // cannot be fixed by the bot; reported as hierarchy
  return roles.some(
    (r) => r.position > target.position && r.position < botTop && !ourRoleIds.has(r.id),
  );
}
