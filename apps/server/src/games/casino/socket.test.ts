import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SOCKET_PATH,
  createSeededRng,
  type BalanceUpdate,
  type ClientToServerEvents,
  type DomainEvent,
  type IntentAck,
  type ServerToClientEvents,
  type TableSnapshot,
  type TokenResponse,
} from '@casino/shared';
import { GUILD, INSTANCE, createTestServer, type TestServer } from '../../runtime/test-kit.ts';
import { createLogger } from '../../runtime/logger.ts';
import type { SocketHandlers } from '../../socket/server.ts';
import { createCasinoGames, type CasinoGames } from '../index.ts';
import { manualScheduler } from './test-kit.ts';

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let server: TestServer;
let client: Client | undefined;
afterEach(async () => {
  client?.close();
  await server.close();
});

/**
 * How B1's server wires the games in: the socket server is built first (with lazy handlers),
 * the games after it, then `attach(io)`.
 */
async function boot() {
  const wired: { games?: CasinoGames } = {};
  const games = (): CasinoGames => wired.games as CasinoGames;
  const lazy: SocketHandlers = {
    tableSnapshot: (scope, game) => games().handlers.tableSnapshot!(scope, game),
    bet: (scope, intent) => games().handlers.bet!(scope, intent),
    action: (scope, intent) => games().handlers.action!(scope, intent),
  };
  server = createTestServer({ socketHandlers: lazy });
  const timers = manualScheduler(server.clock);
  wired.games = createCasinoGames({
    store: server.store,
    economy: server.economy,
    bus: server.bus,
    clock: server.clock,
    rng: createSeededRng(11),
    logger: createLogger({ level: 'silent' }),
    scheduler: timers.scheduler,
  });
  games().attach(server.io);
  const url = await server.app.listen({ port: 0, host: '127.0.0.1' });
  const login = await server.app.inject({
    method: 'POST',
    url: '/api/token',
    headers: server.signed(),
    payload: { code: 'c', guildId: GUILD, instanceId: INSTANCE },
  });
  const { sessionToken } = login.json<TokenResponse>();
  client = connect(url, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    auth: { token: sessionToken },
    extraHeaders: server.signed(),
    reconnection: false,
    forceNew: true,
  });
  await new Promise<void>((resolve, reject) => {
    client!.once('connect', resolve);
    client!.once('connect_error', reject);
  });
  return { games: games(), timers, client };
}

const tick = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('casino over a real socket', () => {
  it('serves a roulette table: join, bet, the room hears the spin, balance and events follow', async () => {
    const { timers, client: c } = await boot();
    const states: TableSnapshot[] = [];
    const balances: BalanceUpdate[] = [];
    const events: DomainEvent[] = [];
    c.on('table:state', (s) => states.push(s));
    c.on('balance:update', (b) => balances.push(b));
    c.on('domain:event', (e) => events.push(e));

    const joined = await c.emitWithAck('table:join', { game: 'roulette' });
    expect(joined).toMatchObject({ ok: true, data: { game: 'roulette', phase: 'idle' } });
    expect(await c.emitWithAck('table:join', { game: 'slots' })).toEqual({
      ok: false,
      error: 'not_found',
    });

    const ack: IntentAck = await c.emitWithAck('game:bet', {
      idempotencyKey: 'bet-key-0000000001',
      game: 'roulette',
      stake: 100,
      bets: [{ kind: 'red', targets: [], stake: 100 }],
    });
    expect(ack).toMatchObject({ ok: true, replayed: false, balance: 2900 });
    await tick();
    expect(states.at(-1)).toMatchObject({ phase: 'betting', game: 'roulette' });

    const repeat: IntentAck = await c.emitWithAck('game:bet', {
      idempotencyKey: 'bet-key-0000000001',
      game: 'roulette',
      stake: 100,
      bets: [{ kind: 'red', targets: [], stake: 100 }],
    });
    expect(repeat).toMatchObject({ ok: true, replayed: true, balance: 2900 });

    timers.advance(20_000);
    await tick();
    expect(states.at(-1)?.phase).toBe('spinning');
    timers.advance(2700);
    await tick();
    expect(states.at(-1)?.phase).toBe('result');
    expect(events.map((e) => e.type)).toContain('GameSettled');
    expect(balances.some((b) => b.reason === 'game_stake' && b.delta === -100)).toBe(true);
    expect(states.map((s) => s.seq)).toEqual([...states.map((s) => s.seq)].sort((a, b) => a - b));
  });

  it('refuses an intent for a game that is not here and bad payloads', async () => {
    const { client: c } = await boot();
    expect(
      await c.emitWithAck('game:bet', {
        idempotencyKey: 'bet-key-0000000002',
        game: 'horse',
        stake: 100,
      }),
    ).toMatchObject({ ok: false, error: 'feature_disabled' });
    expect(
      await c.emitWithAck('game:bet', {
        idempotencyKey: 'bet-key-0000000003',
        game: 'slots',
        stake: 100,
        result: 'win',
      } as never),
    ).toMatchObject({ ok: false, error: 'invalid_payload' });
  });
});
