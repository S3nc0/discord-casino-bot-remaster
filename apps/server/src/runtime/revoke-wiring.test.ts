// R-7 wiring: `/admin server-revoke` in the bot reaches the session service of the same process.
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { SOCKET_PATH, type ClientToServerEvents, type ServerToClientEvents } from '@casino/shared';
import { startBot } from '../bot/client.ts';
import { createInteractionHandler, type BotRouterDeps } from '../bot/router.ts';
import { button, command, customIds, fakeClient } from '../bot/chat-test-kit.ts';
import {
  GUILD,
  INSTANCE,
  OTHER_GUILD,
  USER,
  createTestServer,
  type TestServer,
} from './test-kit.ts';

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let server: TestServer | null = null;
const clients: Client[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  if (server) await server.close();
  server = null;
});

/** A session in GUILD, which is approved by an owner decision rather than listed in the env. */
async function login(s: TestServer): Promise<string> {
  s.identity.ensureGuild(GUILD, 'approved');
  s.discord.state.user = { id: USER, username: 'user', global_name: null, avatar: null };
  s.discord.state.guilds = [{ id: GUILD, name: 'G' }];
  s.discord.state.instance = {
    instance_id: INSTANCE,
    location: { guild_id: GUILD },
    users: [USER],
  };
  const res = await s.app.inject({
    method: 'POST',
    url: '/api/token',
    headers: s.signed(),
    payload: { code: 'c', guildId: GUILD, instanceId: INSTANCE },
  });
  return res.json<{ sessionToken: string }>().sessionToken;
}

describe('R-7: the bot revoke reaches the sessions', () => {
  it('R-7: /admin server-revoke drops the open socket and the next HTTP call is refused', async () => {
    server = createTestServer({ env: { ALLOWED_GUILD_IDS: OTHER_GUILD } });
    const url = await server.app.listen({ port: 0, host: '127.0.0.1' });
    const token = await login(server);

    const socket: Client = connect(url, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      auth: { token },
      extraHeaders: server.signed(),
      reconnection: false,
      forceNew: true,
    });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const call = () =>
      server!.app.inject({
        url: '/api/settings',
        headers: { ...server!.signed(), authorization: `Bearer ${token}` },
      });
    expect((await call()).statusCode).toBe(200);

    // The bot is started the way the runtime starts it; its router handles the owner command.
    let deps: BotRouterDeps | undefined;
    await startBot(server, server.config, {
      env: {},
      clientFactory: (d) => {
        deps = d;
        return { login: async () => 'x', destroy: async () => {} } as never;
      },
    });
    const handler = createInteractionHandler(deps!);
    const closed = new Promise((r) => socket.once('disconnect', r));

    const leave = { name: 'G', leave: async () => undefined };
    const client = fakeClient([], { [GUILD]: leave });
    const revoke = command({
      name: 'admin',
      sub: 'server-revoke',
      guildId: null,
      channelId: null,
      strings: { guild_id: GUILD },
      client,
    });
    await handler(revoke.interaction as never);
    await handler(
      button(customIds(revoke.out[0]!.options)[0]!, { guildId: null, client }).interaction as never,
    );
    expect(server.identity.getGuildStatus(GUILD)).toBe('denied');

    await closed;
    expect(server.io.sockets.sockets.size).toBe(0);
    const after = await call();
    expect(after.statusCode).toBe(403);
    expect(after.json()).toEqual({ error: 'guild_not_allowed' });
  });
});
