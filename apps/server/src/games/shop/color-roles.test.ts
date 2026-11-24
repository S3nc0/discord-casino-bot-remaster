import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoleSnapshot } from '@casino/domain/shop';
import {
  GUILD,
  OTHER_USER,
  USER,
  createTestServer,
  type TestServer,
} from '../../runtime/test-kit.ts';
import {
  COLOR_ROLE_LOG_THROTTLE_MS,
  COLOR_ROLE_MAX_ERRORS,
  COLOR_ROLE_RETRY_MS,
  createDiscordColorRolePort,
  type ColorRoleRest,
} from './color-roles.ts';

const BOT_ROLE = 'r-bot';
const ADMIN_ROLE = 'r-admin';

/** A guild in memory, speaking Discord's error codes. */
function fakeGuild(store: TestServer['store']) {
  let next = 100;
  const roles = new Map<string, RoleSnapshot>();
  const add = (role: Partial<RoleSnapshot> & { id: string; name: string }) =>
    roles.set(role.id, {
      color: 0,
      position: 1,
      permissions: '0',
      managed: false,
      ...role,
    });
  add({ id: GUILD, name: '@everyone', position: 0 });
  add({ id: ADMIN_ROLE, name: 'Admin', position: 10, permissions: String(1n << 3n) });
  add({ id: BOT_ROLE, name: 'Casino', position: 5, permissions: String(1n << 28n), managed: true });
  add({ id: 'r-member', name: 'Member', position: 2 });
  const members = new Map<string, Set<string>>();
  const calls: string[] = [];
  const failures: { op: string; code: number }[] = [];
  let inTransaction = false;
  const fail = (op: string) => {
    if (store.inTransaction) inTransaction = true;
    const i = failures.findIndex((f) => f.op === op);
    if (i >= 0) {
      const [f] = failures.splice(i, 1);
      throw Object.assign(new Error(`discord ${f?.code}`), { code: f?.code });
    }
  };
  const need = (id: string) => {
    const role = roles.get(id);
    if (!role) throw Object.assign(new Error('Unknown Role'), { code: 10011 });
    return role;
  };
  const port: ColorRoleRest = {
    guildRoles: vi.fn(async () => {
      fail('guildRoles');
      return { roles: [...roles.values()].map((r) => ({ ...r })), botRoleIds: [BOT_ROLE] };
    }),
    createRole: vi.fn(async (_g, input) => {
      fail('createRole');
      calls.push(`create ${input.name}`);
      const id = `r${next++}`;
      add({ id, name: input.name, color: input.color, position: 1 });
      return { ...need(id) };
    }),
    setRoleColor: vi.fn(async (_g, id, color) => {
      fail('setRoleColor');
      need(id).color = color;
      calls.push(`color ${id}`);
    }),
    setRolePosition: vi.fn(async (_g, id, position) => {
      fail('setRolePosition');
      need(id).position = position;
      calls.push(`move ${id} ${position}`);
    }),
    addMemberRole: vi.fn(async (_g, user, id) => {
      fail('addMemberRole');
      const role = need(id);
      const bot = need(BOT_ROLE);
      if (role.position >= bot.position)
        throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
      if (!members.has(user)) members.set(user, new Set());
      members.get(user)?.add(id);
      calls.push(`add ${user} ${role.name}`);
    }),
    removeMemberRole: vi.fn(async (_g, user, id) => {
      fail('removeMemberRole');
      need(id);
      members.get(user)?.delete(id);
      calls.push(`remove ${user} ${roles.get(id)?.name}`);
    }),
  };
  const worn = (user: string) =>
    [...(members.get(user) ?? [])].map((id) => roles.get(id)?.name).filter(Boolean);
  return {
    port,
    roles,
    add,
    calls,
    failures,
    worn,
    touchedInTransaction: () => inTransaction,
    named: (name: string) => [...roles.values()].filter((r) => r.name === name),
  };
}

let server: TestServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

function setup() {
  server = createTestServer();
  const s = server;
  s.identity.ensureGuild(GUILD, 'approved', 'Test Guild');
  for (const userId of [USER, OTHER_USER]) {
    s.economy.credit({
      guildId: GUILD,
      userId,
      amount: 100_000,
      reason: 'admin_grant',
      idempotencyKey: `seed-${userId}`,
    });
  }
  const guild = fakeGuild(s.store);
  const warn = vi.fn();
  s.games.shop.colorRoles.attach(guild.port, { warn });
  const own = (itemId: string, userId = USER) =>
    s.games.shop.inventory.add(GUILD, userId, itemId, 1);
  const pending = () =>
    (s.store.stmt('SELECT COUNT(*) AS n FROM color_role_sync').get() as { n: number }).n;
  const ourRoles = () =>
    s.store.stmt('SELECT item_id, role_id FROM color_roles ORDER BY item_id').all() as {
      item_id: string;
      role_id: string;
    }[];
  return { s, guild, warn, own, pending, ourRoles, shop: s.games.shop };
}

describe('wearing a name colour', () => {
  it('creates the role below the bot, puts it on the member and records the slot', async () => {
    const { s, guild, own, pending, ourRoles, shop } = setup();
    own('role_red');
    expect(await shop.wearColor(GUILD, USER, 'role_red')).toBe('applied');
    expect(guild.worn(USER)).toEqual(['ペリカ・赤']);
    const [role] = guild.named('ペリカ・赤');
    expect(role).toMatchObject({ permissions: '0', managed: false, color: 0xe74c3c, position: 4 });
    expect(guild.port.createRole).toHaveBeenCalledWith(GUILD, {
      name: 'ペリカ・赤',
      color: 0xe74c3c,
    });
    expect(ourRoles()).toEqual([{ item_id: 'role_red', role_id: role?.id }]);
    expect(shop.profile(GUILD, USER).colorRole).toBe('role_red');
    expect(pending()).toBe(0);
    expect(guild.touchedInTransaction()).toBe(false);
    void s;
  });

  it('switches colour: one colour at a time, the old role comes off', async () => {
    const { guild, own, shop } = setup();
    own('role_red');
    own('role_blue');
    await shop.wearColor(GUILD, USER, 'role_red');
    expect(await shop.wearColor(GUILD, USER, 'role_blue')).toBe('applied');
    expect(guild.worn(USER)).toEqual(['ペリカ・青']);
    expect(guild.calls).toContain(`remove ${USER} ペリカ・赤`);
  });

  it('takes the colour off on unequip', async () => {
    const { guild, own, shop, pending } = setup();
    own('role_red');
    await shop.wearColor(GUILD, USER, 'role_red');
    expect(await shop.wearColor(GUILD, USER, null)).toBe('removed');
    expect(guild.worn(USER)).toEqual([]);
    expect(shop.profile(GUILD, USER).colorRole).toBeNull();
    expect(pending()).toBe(0);
    // The role itself stays for the next member: nothing is ever deleted.
    expect(guild.named('ペリカ・赤')).toHaveLength(1);
  });

  it('reuses the role for a second member and creates only one for a double equip', async () => {
    const { guild, own, shop } = setup();
    own('role_red');
    own('role_red', OTHER_USER);
    const results = await Promise.all([
      shop.wearColor(GUILD, USER, 'role_red'),
      shop.wearColor(GUILD, USER, 'role_red'),
      shop.wearColor(GUILD, OTHER_USER, 'role_red'),
    ]);
    expect(results).toEqual(['applied', 'applied', 'applied']);
    expect(guild.named('ペリカ・赤')).toHaveLength(1);
    expect(guild.port.createRole).toHaveBeenCalledTimes(1);
    expect(guild.worn(OTHER_USER)).toEqual(['ペリカ・赤']);
  });

  it('refuses a colour the player does not own', async () => {
    const { shop } = setup();
    await expect(shop.wearColor(GUILD, USER, 'role_red')).rejects.toMatchObject({
      rule: 'not_owned',
    });
  });

  it('never calls Discord inside a transaction', async () => {
    const { s, own, shop } = setup();
    own('role_red');
    await expect(
      (async () => s.store.transaction(() => shop.colorRoles.syncNow(GUILD, USER)))(),
    ).rejects.toThrow(/after the commit/);
  });

  it('moves no Pelica', async () => {
    const { s, own, shop } = setup();
    own('role_red');
    const before = s.economy.getBalance(GUILD, USER);
    const rows = (s.store.stmt('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }).n;
    await shop.wearColor(GUILD, USER, 'role_red');
    await shop.wearColor(GUILD, USER, null);
    expect(s.economy.getBalance(GUILD, USER)).toBe(before);
    expect((s.store.stmt('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }).n).toBe(rows);
  });
});

describe('roles that are not ours', () => {
  it('refuses a same-name role the bot did not create and undoes the choice', async () => {
    const { guild, own, shop, pending, ourRoles } = setup();
    guild.add({ id: 'r-foreign', name: 'ペリカ・赤', position: 2 });
    own('role_red');
    expect(await shop.wearColor(GUILD, USER, 'role_red')).toBe('name_taken');
    expect(guild.port.createRole).not.toHaveBeenCalled();
    expect(guild.port.addMemberRole).not.toHaveBeenCalled();
    expect(ourRoles()).toEqual([]);
    expect(shop.profile(GUILD, USER).colorRole).toBeNull();
    expect(pending()).toBe(0);
  });

  it('refuses one of our roles once it has gained a permission', async () => {
    const { guild, own, shop } = setup();
    own('role_red');
    await shop.wearColor(GUILD, USER, 'role_red');
    const [role] = guild.named('ペリカ・赤');
    if (role) role.permissions = '8';
    await shop.wearColor(GUILD, USER, null);
    expect(await shop.wearColor(GUILD, USER, 'role_red')).toBe('name_taken');
    expect(guild.worn(USER)).toEqual([]);
  });

  it('refuses a managed role with the name', async () => {
    const { guild, own, shop } = setup();
    guild.add({ id: 'r-int', name: 'ペリカ・青', managed: true });
    own('role_blue');
    expect(await shop.wearColor(GUILD, USER, 'role_blue')).toBe('name_taken');
  });

  it('never touches a role outside the table, even one the member wears', async () => {
    const { guild, own, shop } = setup();
    guild.add({ id: 'r-vip', name: 'ペリカ・VIP' });
    own('role_red');
    await shop.wearColor(GUILD, USER, 'role_red');
    await shop.wearColor(GUILD, USER, null);
    const touched = [
      ...vi.mocked(guild.port.removeMemberRole).mock.calls,
      ...vi.mocked(guild.port.setRoleColor).mock.calls,
      ...vi.mocked(guild.port.setRolePosition).mock.calls,
    ].map((c) => c[c.length - 2]);
    expect(touched).not.toContain('r-vip');
    expect(touched).not.toContain(ADMIN_ROLE);
    expect(touched).not.toContain(BOT_ROLE);
  });
});

describe('when Discord says no', () => {
  it('records the choice without Manage Roles, and says so once', async () => {
    const { s, guild, own, shop, pending, warn } = setup();
    const bot = guild.roles.get(BOT_ROLE);
    if (bot) bot.permissions = '0';
    own('role_red');
    expect(await shop.wearColor(GUILD, USER, 'role_red')).toBe('missing_permissions');
    expect(shop.profile(GUILD, USER).colorRole).toBe('role_red');
    expect(guild.port.createRole).not.toHaveBeenCalled();
    expect(pending()).toBe(1);
    // The sweep leaves the row alone for 10 minutes, then retries; the log is throttled.
    expect(await shop.colorRoles.sweep()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatch(/Manage Roles/);
    s.clock.advance(COLOR_ROLE_RETRY_MS);
    expect(await shop.colorRoles.sweep()).toBe(1);
    expect(pending()).toBe(1);
    // Granted later: the next retry applies it.
    if (bot) bot.permissions = String(1n << 28n);
    s.clock.advance(COLOR_ROLE_RETRY_MS);
    expect(await shop.colorRoles.sweep()).toBe(1);
    expect(guild.worn(USER)).toEqual(['ペリカ・赤']);
    expect(pending()).toBe(0);
  });

  it('reports a hierarchy problem when the colour role sits above the bot', async () => {
    const { guild, own, shop, pending, warn } = setup();
    own('role_blue');
    await shop.wearColor(GUILD, USER, 'role_blue');
    await shop.wearColor(GUILD, USER, null);
    // An admin dragged our role above the bot's.
    const [blue] = guild.named('ペリカ・青');
    if (blue) blue.position = 8;
    expect(await shop.wearColor(GUILD, USER, 'role_blue')).toBe('hierarchy');
    expect(guild.port.setRolePosition).toHaveBeenCalledTimes(1); // only when it was created
    expect(shop.profile(GUILD, USER).colorRole).toBe('role_blue');
    expect(pending()).toBe(1);
    expect(warn.mock.calls.at(-1)?.[1]).toMatch(/role above/);
  });

  it('reports a hierarchy problem when the bot has no role above the new one', async () => {
    const { guild, own, shop } = setup();
    const bot = guild.roles.get(BOT_ROLE);
    if (bot) bot.position = 1;
    own('role_red');
    expect(await shop.wearColor(GUILD, USER, 'role_red')).toBe('hierarchy');
  });

  it('recreates a role that was deleted in Discord', async () => {
    const { guild, own, shop, ourRoles } = setup();
    own('role_red');
    await shop.wearColor(GUILD, USER, 'role_red');
    const old = ourRoles()[0]?.role_id ?? '';
    guild.roles.delete(old);
    await shop.wearColor(GUILD, USER, null);
    expect(await shop.wearColor(GUILD, USER, 'role_red')).toBe('applied');
    const now = ourRoles()[0]?.role_id;
    expect(now).not.toBe(old);
    expect(guild.named('ペリカ・赤')).toHaveLength(1);
    expect(guild.worn(USER)).toEqual(['ペリカ・赤']);
  });

  it('retries an unexpected error a few times, then drops the row', async () => {
    const { s, guild, own, shop, pending } = setup();
    own('role_red');
    for (let i = 0; i < COLOR_ROLE_MAX_ERRORS + 1; i += 1)
      guild.failures.push({ op: 'guildRoles', code: 0 });
    expect(await shop.wearColor(GUILD, USER, 'role_red')).toBe('error');
    expect(pending()).toBe(1);
    await shop.colorRoles.sweep();
    expect(pending()).toBe(1);
    await shop.colorRoles.sweep();
    expect(pending()).toBe(0);
    expect(shop.profile(GUILD, USER).colorRole).toBe('role_red');
    void s;
  });

  it('logs once per guild per 10 minutes', async () => {
    const { s, guild, own, shop, warn } = setup();
    const bot = guild.roles.get(BOT_ROLE);
    if (bot) bot.permissions = '0';
    own('role_red');
    own('role_red', OTHER_USER);
    await shop.wearColor(GUILD, USER, 'role_red');
    await shop.wearColor(GUILD, OTHER_USER, 'role_red');
    expect(warn).toHaveBeenCalledTimes(1);
    s.clock.advance(COLOR_ROLE_LOG_THROTTLE_MS);
    await shop.colorRoles.sweep();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('treats a guild the bot left as nothing to do', async () => {
    const { guild, own, shop, pending } = setup();
    own('role_red');
    guild.failures.push({ op: 'guildRoles', code: 10004 });
    expect(await shop.wearColor(GUILD, USER, 'role_red')).toBe('gone');
    expect(pending()).toBe(0);
    expect(guild.port.createRole).not.toHaveBeenCalled();
  });
});

describe('restart and the sweep', () => {
  it('waits without a Discord client, and the sweep applies the row after a restart', async () => {
    const { s, guild, own, shop, pending } = setup();
    shop.colorRoles.attach(null);
    own('role_red');
    expect(await shop.wearColor(GUILD, USER, 'role_red')).toBe('skipped');
    expect(pending()).toBe(1);
    expect(await shop.colorRoles.sweep()).toBe(0);
    // A fresh service on the same database (a restart) picks the row up.
    const { ColorRoleService } = await import('./color-roles.ts');
    const restarted = new ColorRoleService({ store: s.store, clock: s.clock });
    restarted.attach(guild.port);
    expect(await restarted.sweep()).toBe(1);
    expect(guild.worn(USER)).toEqual(['ペリカ・赤']);
    expect(pending()).toBe(0);
  });
});

describe('ownership changes take the colour off', () => {
  async function wearing() {
    const ctx = setup();
    ctx.own('role_red');
    await ctx.shop.wearColor(GUILD, USER, 'role_red');
    expect(ctx.guild.worn(USER)).toEqual(['ペリカ・赤']);
    return ctx;
  }

  it('bankruptcy seizure', async () => {
    const { guild, shop, pending } = await wearing();
    shop.seizeAssets(GUILD, USER);
    expect(shop.profile(GUILD, USER).colorRole).toBeNull();
    expect(pending()).toBe(1);
    expect(guild.port.removeMemberRole).not.toHaveBeenCalled(); // not inside the seizure
    await shop.colorRoles.sweep();
    expect(guild.worn(USER)).toEqual([]);
    expect(pending()).toBe(0);
  });

  it('listing it on the player market (escrow), and buying it back does not re-equip', async () => {
    const { s, guild, shop } = await wearing();
    const listed = s.finance.playerMarket.listAsset({
      guildId: GUILD,
      sellerId: USER,
      kind: 'item',
      ref: 'role_red',
      mode: 'fixed',
      price: 20_000,
    });
    expect(listed).toMatchObject({ ok: true });
    await shop.colorRoles.sweep();
    expect(guild.worn(USER)).toEqual([]);
    if (listed.ok) s.finance.playerMarket.cancelListing(GUILD, USER, listed.data);
    expect(shop.inventory.qty(GUILD, USER, 'role_red')).toBe(1);
    expect(shop.profile(GUILD, USER).colorRole).toBeNull();
    await shop.colorRoles.sweep();
    expect(guild.worn(USER)).toEqual([]);
  });

  it('the Teiai seized-goods auction: the buyer receives it unworn', async () => {
    const { guild, shop } = await wearing();
    shop.seizeAssets(GUILD, USER);
    const lot = shop.seizedLots(GUILD).find((l) => l.itemId === 'role_red');
    expect(lot).toBeDefined();
    shop.buySeized({
      guildId: GUILD,
      userId: OTHER_USER,
      lotId: lot?.id ?? 0,
      idempotencyKey: 'k-seized',
    });
    expect(shop.inventory.qty(GUILD, OTHER_USER, 'role_red')).toBe(1);
    expect(shop.profile(GUILD, OTHER_USER).colorRole).toBeNull();
    await shop.colorRoles.sweep();
    expect(guild.worn(USER)).toEqual([]);
    expect(guild.worn(OTHER_USER)).toEqual([]);
  });

  it('any removal of the last copy (as an admin removal would do)', async () => {
    const { guild, shop } = await wearing();
    expect(shop.inventory.take(GUILD, USER, 'role_red', 1)).toBe(true);
    await shop.colorRoles.sweep();
    expect(guild.worn(USER)).toEqual([]);
  });
});

describe('the discord.js port', () => {
  it('speaks the REST routes with no permission, not hoisted, not mentionable', async () => {
    const seen: { method: string; route: string; body?: unknown }[] = [];
    const rest = {
      get: async (route: string) => {
        seen.push({ method: 'get', route });
        return route.includes('/members/')
          ? { roles: [BOT_ROLE] }
          : [
              {
                id: 'x',
                name: 'n',
                colors: { primary_color: 5 },
                position: 1,
                permissions: '0',
                managed: false,
              },
            ];
      },
      post: async (route: string, o: { body: unknown }) => {
        seen.push({ method: 'post', route, body: o.body });
        return {
          id: 'new',
          name: 'ペリカ・赤',
          color: 1,
          position: 1,
          permissions: '0',
          managed: false,
        };
      },
      patch: async (route: string, o: { body: unknown }) => {
        seen.push({ method: 'patch', route, body: o.body });
      },
      put: async (route: string) => {
        seen.push({ method: 'put', route });
      },
      delete: async (route: string) => {
        seen.push({ method: 'delete', route });
      },
    };
    const port = createDiscordColorRolePort({ rest, user: { id: 'bot' } });
    const snap = await port.guildRoles('g');
    expect(snap).toEqual({
      roles: [{ id: 'x', name: 'n', color: 5, position: 1, permissions: '0', managed: false }],
      botRoleIds: [BOT_ROLE],
    });
    await port.createRole('g', { name: 'ペリカ・赤', color: 0xe74c3c });
    await port.setRolePosition('g', 'new', 4);
    await port.addMemberRole('g', 'u', 'new');
    await port.removeMemberRole('g', 'u', 'new');
    expect(seen.map((c) => `${c.method} ${c.route}`)).toEqual([
      'get /guilds/g/roles',
      'get /guilds/g/members/bot',
      'post /guilds/g/roles',
      'patch /guilds/g/roles',
      'put /guilds/g/members/u/roles/new',
      'delete /guilds/g/members/u/roles/new',
    ]);
    expect(seen[2]?.body).toMatchObject({
      name: 'ペリカ・赤',
      permissions: '0',
      hoist: false,
      mentionable: false,
      colors: { primary_color: 0xe74c3c },
    });
    expect(seen[3]?.body).toEqual([{ id: 'new', position: 4 }]);
  });
});
