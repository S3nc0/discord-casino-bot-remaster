import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoleSnapshot } from '@casino/domain/shop';
import type { ColorRoleRest } from '../games/shop/color-roles.ts';
import type { TestServer } from '../runtime/test-kit.ts';
import {
  GUILD,
  USER,
  allText,
  button,
  createTestServer,
  customIds,
  embedOf,
  makeHandler,
  select,
} from './chat-test-kit.ts';

let server: TestServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

/** Just enough of a guild: the bot's role at 5 with Manage Roles unless `manage` is false. */
function fakePort(manage = true, extra: RoleSnapshot[] = []) {
  const roles: RoleSnapshot[] = [
    { id: GUILD, name: '@everyone', color: 0, position: 0, permissions: '0', managed: false },
    {
      id: 'bot',
      name: 'Casino',
      color: 0,
      position: 5,
      permissions: manage ? String(1n << 28n) : '0',
      managed: true,
    },
    ...extra,
  ];
  const worn = new Set<string>();
  const port: ColorRoleRest = {
    guildRoles: vi.fn(async () => ({ roles: roles.map((r) => ({ ...r })), botRoleIds: ['bot'] })),
    createRole: vi.fn(async (_g, input) => {
      const role = {
        id: `r${roles.length}`,
        name: input.name,
        color: input.color,
        position: 1,
        permissions: '0',
        managed: false,
      };
      roles.push(role);
      return { ...role };
    }),
    setRoleColor: vi.fn(async () => {}),
    setRolePosition: vi.fn(async () => {}),
    addMemberRole: vi.fn(async (_g, _u, id) => {
      worn.add(roles.find((r) => r.id === id)?.name ?? id);
    }),
    removeMemberRole: vi.fn(async (_g, _u, id) => {
      worn.delete(roles.find((r) => r.id === id)?.name ?? id);
    }),
  };
  return { port, worn };
}

function setup(port: ColorRoleRest | null) {
  server = createTestServer({ casinoHandlers: true });
  server.economy.ensureMember(GUILD, USER);
  server.games.shop.colorRoles.attach(port);
  server.games.shop.inventory.add(GUILD, USER, 'role_red', 1);
  server.games.shop.inventory.add(GUILD, USER, 'role_blue', 1);
  return { s: server, handler: makeHandler(server) };
}

describe('/shop name colours', () => {
  it('offers the owned colours, wears one, then takes it off', async () => {
    const { port, worn } = fakePort();
    const { s, handler } = setup(port);
    const cat = button('b:shop:cat:color_role');
    await handler(cat.interaction as never);
    expect(customIds(cat.out[0]!.options)).toContain('b:shop:wear');
    expect(customIds(cat.out[0]!.options)).not.toContain('b:shop:off');

    const wear = select('b:shop:wear', ['role_red']);
    await handler(wear.interaction as never);
    expect(wear.interaction.deferUpdate).toHaveBeenCalled();
    const done = wear.out.at(-1)!;
    expect(done.kind).toBe('editReply');
    expect(embedOf(done.options).title).toBe('Name color changed');
    expect(allText(done.options)).toContain('Red');
    expect([...worn]).toEqual(['ペリカ・赤']);
    expect(s.games.shop.profile(GUILD, USER).colorRole).toBe('role_red');

    const again = button('b:shop:cat:color_role');
    await handler(again.interaction as never);
    expect(allText(again.out[0]!.options)).toContain('Wearing: 🔴 Red');
    expect(customIds(again.out[0]!.options)).toContain('b:shop:off');

    const off = button('b:shop:off');
    await handler(off.interaction as never);
    expect(embedOf(off.out.at(-1)!.options).title).toBe('Name color removed');
    expect([...worn]).toEqual([]);
    expect(s.games.shop.profile(GUILD, USER).colorRole).toBeNull();
  });

  it('keeps the choice and explains Manage Roles in Japanese when the bot lacks it', async () => {
    const { port, worn } = fakePort(false);
    const { s, handler } = setup(port);
    const wear = select('b:shop:wear', ['role_blue'], { locale: 'ja' });
    await handler(wear.interaction as never);
    const text = allText(wear.out.at(-1)!.options);
    expect(text).toContain('ロールの管理');
    expect(embedOf(wear.out.at(-1)!.options).title).toBe('名前の色を変えました');
    expect([...worn]).toEqual([]);
    expect(s.games.shop.profile(GUILD, USER).colorRole).toBe('role_blue');
  });

  it('refuses a colour whose name a foreign role already has, naming the role', async () => {
    const foreign = {
      id: 'x',
      name: 'ペリカ・赤',
      color: 0,
      position: 2,
      permissions: '8',
      managed: false,
    };
    const { port, worn } = fakePort(true, [foreign]);
    const { s, handler } = setup(port);
    const wear = select('b:shop:wear', ['role_red']);
    await handler(wear.interaction as never);
    const last = wear.out.at(-1)!.options;
    expect(embedOf(last).title).toBe('Cannot use this name color');
    expect(allText(last)).toContain('“ペリカ・赤”');
    expect(allText(last)).toContain('rename');
    expect([...worn]).toEqual([]);
    expect(s.games.shop.profile(GUILD, USER).colorRole).toBeNull();
  });

  it('still records the colour with the bot gateway off (no Discord client)', async () => {
    const { s, handler } = setup(null);
    const wear = select('b:shop:wear', ['role_red']);
    await handler(wear.interaction as never);
    expect(embedOf(wear.out.at(-1)!.options).title).toBe('Name color changed');
    expect(s.games.shop.profile(GUILD, USER).colorRole).toBe('role_red');
  });

  it('refuses a colour the player does not own', async () => {
    const { port } = fakePort();
    const { handler } = setup(port);
    const wear = select('b:shop:wear', ['role_gold']);
    await handler(wear.interaction as never);
    expect(allText(wear.out.at(-1)!.options)).toMatch(/own/i);
  });
});
