import { afterEach, describe, expect, it, vi } from 'vitest';
import { Value } from 'typebox/value';
import { LIFE_ROUTES, ShopColorRoleResponse, ShopView, type TokenResponse } from '@casino/shared';
import type { RoleSnapshot } from '@casino/domain/shop';
import type { ColorRoleRest } from '../../games/shop/color-roles.ts';
import {
  GUILD,
  INSTANCE,
  USER,
  createTestServer,
  type TestServer,
} from '../../runtime/test-kit.ts';

let server: TestServer;
afterEach(async () => {
  await server.close();
});

const key = (() => {
  let n = 0;
  return () => `color-${String(++n).padStart(8, '0')}-abcdefgh`;
})();

async function login(who: string) {
  server.discord.state.user = { id: who, username: 'u', global_name: 'Player', avatar: null };
  server.discord.state.instance = {
    instance_id: INSTANCE,
    location: { guild_id: GUILD },
    users: [who],
  };
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/token',
    headers: server.signed(),
    payload: { code: 'c', guildId: GUILD, instanceId: INSTANCE },
  });
  const { sessionToken } = res.json<TokenResponse>();
  const headers = () => ({ ...server.signed(), authorization: `Bearer ${sessionToken}` });
  return {
    get: (url: string) => server.app.inject({ url, headers: headers() }),
    post: (url: string, payload: object) =>
      server.app.inject({ method: 'POST', url, headers: headers(), payload }),
  };
}

function port(manage: boolean): ColorRoleRest & { worn: Set<string> } {
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
  ];
  const worn = new Set<string>();
  return {
    worn,
    guildRoles: vi.fn(async () => ({ roles: roles.map((r) => ({ ...r })), botRoleIds: ['bot'] })),
    createRole: vi.fn(async (_g, input) => {
      const role: RoleSnapshot = {
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
    addMemberRole: vi.fn(async (_g, _u, id) => void worn.add(id)),
    removeMemberRole: vi.fn(async (_g, _u, id) => void worn.delete(id)),
  };
}

describe('POST /api/life/shop/color-role', () => {
  it('wears an owned colour, shows it in the shop view, and takes it off', async () => {
    server = createTestServer();
    const fake = port(true);
    server.games.shop.colorRoles.attach(fake);
    const me = await login(USER);
    server.games.shop.inventory.add(GUILD, USER, 'role_red', 1);

    const res = await me.post(LIFE_ROUTES.shopColorRole, {
      idempotencyKey: key(),
      itemId: 'role_red',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Value.Check(ShopColorRoleResponse, body)).toBe(true);
    expect(body).toMatchObject({ colorRole: 'role_red', replayed: false });
    expect(body.notice).toBeUndefined();
    expect(fake.worn.size).toBe(1);

    const view = (await me.get(LIFE_ROUTES.shop)).json();
    expect(Value.Check(ShopView, view)).toBe(true);
    expect(view.colorRole).toBe('role_red');

    const off = (
      await me.post(LIFE_ROUTES.shopColorRole, { idempotencyKey: key(), itemId: null })
    ).json();
    expect(off).toMatchObject({ colorRole: null });
    expect(fake.worn.size).toBe(0);
  });

  it('answers a notice without Manage Roles and replays without touching Discord again', async () => {
    server = createTestServer();
    const fake = port(false);
    server.games.shop.colorRoles.attach(fake);
    const me = await login(USER);
    server.games.shop.inventory.add(GUILD, USER, 'role_blue', 1);
    const k = key();
    const first = (
      await me.post(LIFE_ROUTES.shopColorRole, { idempotencyKey: k, itemId: 'role_blue' })
    ).json();
    expect(first).toMatchObject({ colorRole: 'role_blue', notice: 'missing_permissions' });
    const calls = vi.mocked(fake.guildRoles).mock.calls.length;
    const again = (
      await me.post(LIFE_ROUTES.shopColorRole, { idempotencyKey: k, itemId: 'role_blue' })
    ).json();
    expect(again).toMatchObject({ replayed: true, colorRole: 'role_blue' });
    expect(vi.mocked(fake.guildRoles).mock.calls.length).toBe(calls);
  });

  it('refuses a colour the player does not own, and anything that is not a colour', async () => {
    server = createTestServer();
    const me = await login(USER);
    const res = await me.post(LIFE_ROUTES.shopColorRole, {
      idempotencyKey: key(),
      itemId: 'role_gold',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ rule: 'not_owned' });
    const bad = await me.post(LIFE_ROUTES.shopColorRole, {
      idempotencyKey: key(),
      itemId: 'title_rookie',
    });
    expect(bad.statusCode).toBe(400);
  });
});
