import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SOCKET_PATH,
  type BalanceUpdate,
  type ClientToServerEvents,
  type DomainEvent,
  type ServerToClientEvents,
  type TokenResponse,
} from '@casino/shared';
import { suddenEventOn } from '@casino/domain/casino';
import { dayStartMs, localDayNumber } from '@casino/domain/progression';
import { FINANCE_JOBS } from '../finance/jobs.ts';
import { startRuntime, type RuntimeHandle } from './lifecycle.ts';
import type { CronDriver } from './scheduler.ts';
import { createServer } from './server.ts';
import {
  GUILD,
  INSTANCE,
  OTHER_USER,
  USER,
  createTestServer,
  makeProxyKeys,
  testConfig,
  type TestServer,
} from './test-kit.ts';

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

/** Records every schedule so a test fires them by hand. */
function handDriver() {
  const schedules: { cron: string; fire: () => void; live: boolean }[] = [];
  const driver: CronDriver = {
    schedule(cron, _options, fire) {
      const entry = { cron, fire, live: true };
      schedules.push(entry);
      return { stop: () => void (entry.live = false) };
    },
  };
  return { driver, schedules };
}

const open: { server?: TestServer; runtime?: RuntimeHandle; client?: Client } = {};
afterEach(async () => {
  open.client?.close();
  if (open.runtime) await open.runtime.stop();
  else await open.server?.close();
  open.client = undefined;
  open.runtime = undefined;
  open.server = undefined;
});

const bootServer = (options: Parameters<typeof createTestServer>[0] = {}) => {
  const server = createTestServer({ casinoHandlers: true, ...options });
  open.server = server;
  const events: DomainEvent[] = [];
  const balances: BalanceUpdate[] = [];
  server.bus.onAnyDomain((e) => events.push(e));
  server.bus.onBalance((b) => balances.push(b));
  return { server, events, balances };
};

const fund = (server: TestServer, userId: string, amount: number): void => {
  server.economy.credit({
    guildId: GUILD,
    userId,
    amount,
    reason: 'admin_grant',
    idempotencyKey: `fund-${userId}-${amount}`,
  });
};

const reasons = (server: TestServer, userId: string): string[] =>
  server.economy.history(GUILD, userId, 100).map((row) => row.reason);

describe('boot', () => {
  it('registers every job: finance, games and housekeeping', () => {
    const { server } = bootServer();
    const ids = server.scheduler.jobIds;
    for (const job of FINANCE_JOBS) expect(ids).toContain(job.id);
    expect(server.games.jobs.length).toBeGreaterThanOrEqual(10);
    for (const job of server.games.jobs) expect(ids).toContain(`games:${job.name}`);
    expect(ids).toContain('casino:idempotency-purge');
    expect(ids).toContain('auth:launch-intents-purge');
    expect(ids).toContain('notify:pin-sweep');
    expect(new Set(ids).size).toBe(ids.length);
    // Races four times a day (ensureDay at midnight, tick every 5 s), the arena, the weekly
    // ranking and the lottery are all in the manifest.
    expect(ids).toEqual(
      expect.arrayContaining([
        'games:race.ensureDay',
        'games:race.tick',
        'games:arena.advance',
        'games:weekly.settle',
        'games:lottery.drawDue',
      ]),
    );
  });

  it('starts with BOT_DISABLED=1 (no login), schedules every job, and every job runs clean', async () => {
    const { driver, schedules } = handDriver();
    const { server } = bootServer({ cronDriver: driver, env: { BOT_DISABLED: '1' } });
    const clientFactory = vi.fn();
    const runtime = await startRuntime(server, server.config, {
      env: { BOT_DISABLED: '1' },
      bot: { clientFactory },
    });
    open.runtime = runtime;
    expect(runtime.bot.client).toBeNull();
    expect(clientFactory).not.toHaveBeenCalled();
    expect(runtime.address).toMatch(/^http:\/\//);
    expect(schedules).toHaveLength(server.scheduler.jobIds.length);
    expect(schedules.every((s) => s.live)).toBe(true);
    const health = await server.app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);

    // A guild exists, so the per-guild jobs have something to walk.
    server.identity.ensureGuild(GUILD, 'approved', 'Test Guild');
    for (const id of server.scheduler.jobIds) await server.scheduler.runNow(id);
    const failed = server.scheduler.status().filter((s) => s.failures > 0);
    expect(failed).toEqual([]);
    expect(server.scheduler.status().every((s) => s.runs === 1)).toBe(true);

    await runtime.stop();
    expect(schedules.every((s) => !s.live)).toBe(true);
  });

  it('shuts down in order: scheduler, bot, then sockets and the database', async () => {
    const config = testConfig(makeProxyKeys().publicKeyHex, { DATABASE_PATH: ':memory:' });
    const server = createServer({ config, cronDriver: handDriver().driver });
    const order: string[] = [];
    const stopJobs = server.stopJobs;
    const close = server.close;
    server.stopJobs = async () => {
      order.push('scheduler');
      await stopJobs();
    };
    server.close = async () => {
      order.push('server');
      await close();
    };
    const runtime = await startRuntime(server, config, { env: { BOT_DISABLED: '1' } });
    const stopNotify = runtime.notify.stop;
    runtime.notify.stop = () => {
      order.push('notify');
      stopNotify();
    };
    await runtime.stop();
    await runtime.stop();
    expect(order).toEqual(['scheduler', 'notify', 'server']);
    expect(() => server.store.stmt('SELECT 1').get()).toThrow();
  });

  it('starts notify runtime with no-op port when BOT_DISABLED=1 and records inbox notifications', async () => {
    const { driver } = handDriver();
    const { server } = bootServer({ cronDriver: driver, env: { BOT_DISABLED: '1' } });
    const runtime = await startRuntime(server, server.config, {
      env: { BOT_DISABLED: '1' },
    });
    open.runtime = runtime;
    expect(runtime.bot.client).toBeNull();

    server.bus.publishDomain({
      type: 'DailyReady',
      guildId: GUILD,
      at: server.clock.now(),
      userId: USER,
    });
    const flushed = await runtime.notify.flush();
    expect(flushed.announcements.failed).toBe(0);
    expect(server.inbox.unread(USER, GUILD)).toBe(1);

    await runtime.stop();
    open.runtime = undefined;
    // After shutdown, notify is unsubscribed.
    server.bus.publishDomain({
      type: 'DailyReady',
      guildId: GUILD,
      at: server.clock.now() + 1,
      userId: USER,
    });
  });
});

describe('wave 2 casino additions', () => {
  it('serves the chinchiro table and the daily event boost on the booted casino', () => {
    const { server } = bootServer();
    expect(server.casino.chinchiroTable.snapshot(GUILD, INSTANCE)).toMatchObject({
      game: 'chinchiro',
    });
    const day = localDayNumber(server.clock.now(), server.config.utcOffsetHours);
    const event = suddenEventOn(GUILD, day);
    const inside = dayStartMs(day, server.config.utcOffsetHours) + (event.startMin + 1) * 60_000;
    const { eventBoost } = server.casino.core.ports;
    expect(eventBoost(GUILD, event.game, inside)).toBe(0.5);
    const other = event.game === 'slots' ? 'roulette' : 'slots';
    expect(eventBoost(GUILD, other, inside)).toBe(0);
    expect(eventBoost(GUILD, event.game, inside + 31 * 60_000)).toBe(0);
  });
});

describe('scripted play on the booted server', () => {
  it('a roulette bet over a real socket writes the ledger and the room events', async () => {
    const { server } = bootServer();
    const url = await server.app.listen({ port: 0, host: '127.0.0.1' });
    const login = await server.app.inject({
      method: 'POST',
      url: '/api/token',
      headers: server.signed(),
      payload: { code: 'c', guildId: GUILD, instanceId: INSTANCE },
    });
    const { sessionToken } = login.json<TokenResponse>();
    const client: Client = connect(url, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      auth: { token: sessionToken },
      extraHeaders: server.signed(),
      reconnection: false,
      forceNew: true,
    });
    open.client = client;
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    const updates: BalanceUpdate[] = [];
    client.on('balance:update', (b) => updates.push(b));
    expect(await client.emitWithAck('table:join', { game: 'roulette' })).toMatchObject({
      ok: true,
    });
    const ack = await client.emitWithAck('game:bet', {
      idempotencyKey: 'boot-bet-0000000001',
      game: 'roulette',
      stake: 100,
      bets: [{ kind: 'red', targets: [], stake: 100 }],
    });
    expect(ack).toMatchObject({ ok: true, replayed: false });
    await vi.waitFor(() => expect(updates.some((u) => u.reason === 'game_stake')).toBe(true));
    expect(reasons(server, USER)).toContain('game_stake');
    expect(server.casino.core.sessions.isBusy(GUILD, USER)).toBe(true);
  });

  it('roulette (solo), a finance loan and a daily claim each write the ledger and emit events', () => {
    const { server, events, balances } = bootServer();
    fund(server, USER, 20_000);
    fund(server, OTHER_USER, 5_000);
    const mark = balances.length;

    // Casino: a chat spin settles in one call.
    const spin = server.casino.roulette.playSolo(
      { guildId: GUILD, userId: USER, source: 'chat' },
      { stake: 100, kind: 'red', idempotencyKey: 'solo-roulette-000001' },
    );
    expect(spin.response.settlement.stake).toBe(100);
    expect(reasons(server, USER)).toContain('game_stake');
    expect(events.filter((e) => e.type === 'GameSettled')).toHaveLength(1);

    // Finance: a direct P2P loan moves principal between two players.
    const offer = server.finance.loans.offerLoan({
      guildId: GUILD,
      lenderId: USER,
      borrowerId: OTHER_USER,
      principal: 10_000,
      rateBps: 150,
      termDays: 5,
    });
    expect(offer.ok).toBe(true);
    const accepted = server.finance.loans.acceptOffer(GUILD, offer.ok ? offer.data : 0, OTHER_USER);
    expect(accepted.ok).toBe(true);
    expect(reasons(server, USER)).toContain('p2p_lend');
    expect(reasons(server, OTHER_USER)).toContain('p2p_borrow');

    // Progression: the daily claim, then the reminder job for the next slot.
    const claim = server.games.progression.claimDaily(GUILD, USER);
    expect(claim.ok).toBe(true);
    expect(reasons(server, USER)).toContain('daily_bonus');
    server.clock.advance(7 * 3_600_000);
    return server.scheduler.runNow('games:daily.ready').then(() => {
      expect(events.filter((e) => e.type === 'DailyReady')).toMatchObject([
        { guildId: GUILD, userId: USER },
      ]);
      const seen = balances.slice(mark).map((b) => [b.userId, b.reason]);
      expect(seen).toEqual(
        expect.arrayContaining([
          [USER, 'game_stake'],
          [USER, 'p2p_lend'],
          [OTHER_USER, 'p2p_borrow'],
          [USER, 'daily_bonus'],
        ]),
      );
    });
  });
});
