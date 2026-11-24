import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOG, EQUIP_SLOTS } from './catalog.ts';
import {
  botStanding,
  COLOR_ROLE_PREFIX,
  COLOR_ROLES,
  colorRoleName,
  isColorRoleItem,
  isSafeColorRole,
  needsMove,
  pickColorRole,
  wantedPosition,
  type RoleSnapshot,
} from './color-roles.ts';

const yaml = readFileSync(new URL('../../../../catalogs/shop.yaml', import.meta.url), 'utf8');

/** `{ id, name, value }` of every `kind: color_role` entry in catalogs/shop.yaml. */
function yamlColors(): { id: string; name: string; value: number }[] {
  const out: { id: string; name: string; value: number }[] = [];
  for (const block of yaml.split(/\n\s*- id: /).slice(1)) {
    if (!/\n\s*kind: color_role\b/.test(block)) continue;
    const id = block.split('\n')[0]?.trim() ?? '';
    const name = /\n\s*name: "([^"]+)"/.exec(block)?.[1] ?? '';
    const value = Number(/\n\s*value: (0x[0-9A-Fa-f]+)/.exec(block)?.[1]);
    out.push({ id, name, value });
  }
  return out;
}

const role = (over: Partial<RoleSnapshot> & { id: string; name: string }): RoleSnapshot => ({
  color: 0,
  position: 1,
  permissions: '0',
  managed: false,
  ...over,
});

describe('colour role names and values', () => {
  it('match catalogs/shop.yaml (prefix, names, colours) and the catalog', () => {
    expect(yaml).toContain(`role_prefix: "${COLOR_ROLE_PREFIX}"`);
    const fromYaml = yamlColors();
    expect(fromYaml).toHaveLength(12);
    expect(Object.keys(COLOR_ROLES)).toEqual(fromYaml.map((c) => c.id));
    for (const c of fromYaml) expect(COLOR_ROLES[c.id]).toEqual({ name: c.name, color: c.value });
    expect(CATALOG.filter((i) => i.kind === 'color_role').map((i) => i.id)).toEqual(
      fromYaml.map((c) => c.id),
    );
  });

  it('builds the role name from the prefix and the colour name', () => {
    expect(colorRoleName('role_red')).toBe('ペリカ・赤');
    expect(colorRoleName('role_cyan')).toBe('ペリカ・水色');
    expect(colorRoleName('cardcolor_red')).toBeNull();
    expect(colorRoleName('constructor')).toBeNull();
    expect(isColorRoleItem('role_white')).toBe(true);
    expect(isColorRoleItem('title_rookie')).toBe(false);
  });

  it('makes the name colour an equip slot', () => {
    expect(EQUIP_SLOTS).toContain('color_role');
  });
});

describe('which roles are safe', () => {
  it('only a role with no permission that is not managed', () => {
    expect(isSafeColorRole({ permissions: '0', managed: false })).toBe(true);
    expect(isSafeColorRole({ permissions: '1024', managed: false })).toBe(false);
    expect(isSafeColorRole({ permissions: '0', managed: true })).toBe(false);
    expect(isSafeColorRole({ permissions: 'garbage', managed: false })).toBe(false);
  });

  it('creates a role when none exists', () => {
    expect(pickColorRole({ itemId: 'role_red', roles: [], knownRoleId: null })).toEqual({
      kind: 'create',
      name: 'ペリカ・赤',
      color: 0xe74c3c,
    });
  });

  it('refuses a same-name role it did not create, whatever its permissions', () => {
    const foreign = role({ id: 'f', name: 'ペリカ・赤' });
    expect(pickColorRole({ itemId: 'role_red', roles: [foreign], knownRoleId: null })).toEqual({
      kind: 'refuse',
      reason: 'name_taken',
      name: 'ペリカ・赤',
    });
    // A different name (a VIP role with the prefix) is none of its business.
    const vip = role({ id: 'v', name: 'ペリカ・VIP' });
    expect(pickColorRole({ itemId: 'role_red', roles: [vip], knownRoleId: null }).kind).toBe(
      'create',
    );
  });

  it('uses its own role, and refuses it once it has a permission or is managed', () => {
    const ours = role({ id: 'o', name: 'ペリカ・赤' });
    expect(pickColorRole({ itemId: 'role_red', roles: [ours], knownRoleId: 'o' })).toEqual({
      kind: 'use',
      role: ours,
      roleId: 'o',
    });
    for (const bad of [{ permissions: '8' }, { managed: true }]) {
      expect(
        pickColorRole({ itemId: 'role_red', roles: [{ ...ours, ...bad }], knownRoleId: 'o' }).kind,
      ).toBe('refuse');
    }
  });

  it('keeps using a stored role missing from the snapshot (Discord decides if it is gone)', () => {
    expect(pickColorRole({ itemId: 'role_red', roles: [], knownRoleId: 'o' })).toEqual({
      kind: 'use',
      role: null,
      roleId: 'o',
    });
  });

  it('lets go of its role once an admin renamed it', () => {
    const renamed = role({ id: 'o', name: 'Red team' });
    expect(pickColorRole({ itemId: 'role_red', roles: [renamed], knownRoleId: 'o' }).kind).toBe(
      'create',
    );
  });
});

describe('where the role goes', () => {
  const G = 'g';
  const roles = [
    role({ id: G, name: '@everyone', position: 0, permissions: '0' }),
    role({ id: 'bot', name: 'Bot', position: 6, permissions: String(1n << 28n), managed: true }),
    role({ id: 'other', name: 'Other', position: 3, permissions: String(1n << 3n) }),
    role({ id: 'mod', name: 'Mod', position: 9 }),
  ];

  it('reads the bot top role and Manage Roles (or Administrator) from its roles and @everyone', () => {
    expect(botStanding(G, roles, ['bot'])).toEqual({ top: 6, canManageRoles: true });
    expect(botStanding(G, roles, ['mod'])).toEqual({ top: 9, canManageRoles: false });
    expect(botStanding(G, roles, ['other'])).toEqual({ top: 3, canManageRoles: true });
    expect(botStanding(G, roles, [])).toEqual({ top: 0, canManageRoles: false });
  });

  it('sits directly below the bot', () => {
    expect(wantedPosition(6)).toBe(5);
    expect(wantedPosition(1)).toBe(1);
  });

  it('moves only when a foreign role sits between it and the bot', () => {
    const ours = new Set(['a', 'b']);
    const list = [
      { id: 'a', position: 5 },
      { id: 'b', position: 4 },
      { id: 'x', position: 2 },
    ];
    expect(needsMove({ id: 'b', position: 4 }, 6, list, ours)).toBe(false);
    expect(needsMove({ id: 'n', position: 1 }, 6, list, ours)).toBe(true);
    expect(needsMove({ id: 'up', position: 7 }, 6, list, ours)).toBe(false);
  });
});
