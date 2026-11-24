import { afterEach, describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import type { StreamError } from '@casino/shared';
import {
  STREAM_ROUTES,
  StreamBetResponse,
  StreamEndResponse,
  StreamList,
  StreamSettleResponse,
  StreamStartResponse,
  StreamTipResponse,
  StreamView,
  StreamWriteResponse,
  type TokenResponse,
} from '@casino/shared';
import {
  GUILD,
  INSTANCE,
  OTHER_USER,
  USER,
  createTestServer,
  type TestServer,
} from '../../runtime/test-kit.ts';
import { STREAM_MONEY_WRITES_PER_MINUTE } from './stream.ts';

let server: TestServer;
afterEach(async () => {
  await server.close();
});

const key = (() => {
  let n = 0;
  return () => `key-${String(++n).padStart(8, '0')}-abcdefgh`;
})();

const VOICE = '777777777777777777';

async function login(who: string, channelId: string | null = null) {
  server.discord.state.user = {
    id: who,
    username: `u${who.slice(-3)}`,
    global_name: `Player ${who.slice(-3)}`,
    avatar: null,
  };
  server.discord.state.instance = {
    instance_id: INSTANCE,
    location: { guild_id: GUILD, channel_id: channelId },
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

const games = (userId: string, n: number) =>
  server.store
    .stmt(
      `INSERT INTO play_state (guild_id, user_id, games_played) VALUES (?, ?, ?)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET games_played = excluded.games_played`,
    )
    .run(GUILD, userId, n);

describe('stream routes', () => {
  it('every stream route needs a session token', async () => {
    server = createTestServer();
    for (const url of Object.values(STREAM_ROUTES)) {
      const get = await server.app.inject({ url, headers: server.signed() });
      const post = await server.app.inject({
        method: 'POST',
        url,
        headers: server.signed(),
        payload: {},
      });
      expect([get.statusCode, post.statusCode], url).toContain(401);
      expect([get.statusCode, post.statusCode].filter((s) => s !== 401 && s !== 404)).toEqual([]);
    }
  });

  it('runs a whole round with the contract shapes, the session user as the actor', async () => {
    server = createTestServer();
    const streamer = await login(USER);
    const viewer = await login(OTHER_USER);

    const started = await streamer.post(STREAM_ROUTES.start, {
      idempotencyKey: key(),
      title: 'Boss fight',
      url: 'https://example.com/live',
    });
    expect(started.statusCode).toBe(200);
    const start = started.json<StreamStartResponse>();
    expect(Value.Check(StreamStartResponse, start)).toBe(true);
    const streamId = start.stream.id;
    expect(start.stream).toMatchObject({ streamerId: USER, location: null, channelId: null });

    const list = (await viewer.get(STREAM_ROUTES.streams)).json<StreamList>();
    expect(Value.Check(StreamList, list)).toBe(true);
    expect(list.streams.map((s) => s.id)).toEqual([streamId]);

    // A body cannot name the streamer or anyone else.
    const smuggled = await viewer.post(STREAM_ROUTES.open, {
      idempotencyKey: key(),
      streamId,
      streamerId: USER,
    });
    expect(smuggled.statusCode).toBe(400);
    const notMine = await viewer.post(STREAM_ROUTES.open, { idempotencyKey: key(), streamId });
    expect(notMine.statusCode).toBe(403);
    expect(notMine.json<StreamError>()).toMatchObject({
      error: 'forbidden',
      rule: 'stream_not_streamer',
    });

    const opened = (
      await streamer.post(STREAM_ROUTES.open, { idempotencyKey: key(), streamId, label: 'Round 1' })
    ).json<StreamWriteResponse>();
    expect(Value.Check(StreamWriteResponse, opened)).toBe(true);
    const roundId = opened.stream.round!.id;

    const bet = await viewer.post(STREAM_ROUTES.bet, {
      idempotencyKey: key(),
      streamId,
      roundId,
      side: 'lose',
      amount: 500,
    });
    expect(bet.statusCode).toBe(200);
    expect(Value.Check(StreamBetResponse, bet.json())).toBe(true);
    expect(bet.json<StreamBetResponse>()).toMatchObject({ total: 500, balance: 2500 });

    const selfBet = await streamer.post(STREAM_ROUTES.bet, {
      idempotencyKey: key(),
      streamId,
      roundId,
      side: 'win',
      amount: 500,
    });
    expect(selfBet.json<StreamError>()).toMatchObject({
      error: 'forbidden',
      rule: 'stream_self_bet',
    });

    const early = await streamer.post(STREAM_ROUTES.settle, {
      idempotencyKey: key(),
      streamId,
      roundId,
      winner: 'lose',
    });
    expect(early.statusCode).toBe(409);
    expect(early.json<StreamError>()).toMatchObject({ rule: 'stream_not_locked' });

    await streamer.post(STREAM_ROUTES.lock, { idempotencyKey: key(), streamId, roundId });
    const settled = await streamer.post(STREAM_ROUTES.settle, {
      idempotencyKey: key(),
      streamId,
      roundId,
      winner: 'lose',
    });
    expect(settled.statusCode).toBe(200);
    const s = settled.json<StreamSettleResponse>();
    expect(Value.Check(StreamSettleResponse, s)).toBe(true);
    expect(s.result).toMatchObject({ refunded: true, outcome: 'lose' });

    const view = await viewer.get(`${STREAM_ROUTES.view}?streamId=${streamId}`);
    expect(Value.Check(StreamView, view.json())).toBe(true);
    expect(view.json<StreamView>().me).toMatchObject({ isStreamer: false, balance: 3000 });
    expect((await viewer.get(`${STREAM_ROUTES.view}?streamId=abc`)).statusCode).toBe(400);
    expect((await viewer.get(`${STREAM_ROUTES.view}?streamId=999`)).statusCode).toBe(404);

    const ended = await streamer.post(STREAM_ROUTES.end, { idempotencyKey: key(), streamId });
    expect(Value.Check(StreamEndResponse, ended.json())).toBe(true);
    expect(ended.json<StreamEndResponse>()).toMatchObject({
      voided: null,
      stream: { status: 'ended' },
    });
  });

  it('tips go through the transfer rules and replay by key', async () => {
    server = createTestServer();
    const streamer = await login(USER);
    const viewer = await login(OTHER_USER);
    const streamId = (
      await streamer.post(STREAM_ROUTES.start, { idempotencyKey: key(), title: 'x' })
    ).json<StreamStartResponse>().stream.id;
    const tip = { idempotencyKey: key(), streamId, amount: 1000, message: 'hi' };
    const refused = await viewer.post(STREAM_ROUTES.tip, tip);
    expect(refused.json<StreamError>()).toMatchObject({
      rule: 'transfer_min_games',
      params: { min_games: 3 },
    });
    games(OTHER_USER, 3);
    const first = await viewer.post(STREAM_ROUTES.tip, tip);
    const again = await viewer.post(STREAM_ROUTES.tip, tip);
    expect(Value.Check(StreamTipResponse, first.json())).toBe(true);
    expect(first.json<StreamTipResponse>()).toMatchObject({
      replayed: false,
      fee: 100,
      balance: 1900,
    });
    expect(again.json<StreamTipResponse>()).toMatchObject({ replayed: true, balance: 1900 });
    expect(server.economy.getBalance(GUILD, USER)).toBe(4000);
  });

  it('stores the Activity voice channel as the location, verified with Discord', async () => {
    server = createTestServer();
    server.discord.state.channels = { [VOICE]: { id: VOICE, type: 2, guild_id: GUILD } };
    const streamer = await login(USER, VOICE);
    const r = (
      await streamer.post(STREAM_ROUTES.start, { idempotencyKey: key(), title: 'x' })
    ).json<StreamStartResponse>();
    expect(r.stream.location).toEqual({ channelId: VOICE, source: 'activity' });
  });

  it('ignores a text channel and a missing channel as the location', async () => {
    server = createTestServer();
    server.discord.state.channels = { [VOICE]: { id: VOICE, type: 0, guild_id: GUILD } };
    const a = await login(USER, VOICE);
    const r = (
      await a.post(STREAM_ROUTES.start, { idempotencyKey: key(), title: 'x' })
    ).json<StreamStartResponse>();
    expect(r.stream.location).toBeNull();
    const b = await login(OTHER_USER, '888888888888888888');
    const r2 = (
      await b.post(STREAM_ROUTES.start, { idempotencyKey: key(), title: 'y' })
    ).json<StreamStartResponse>();
    expect(r2.stream.location).toBeNull();
  });

  it('limits tips and bets per user', async () => {
    server = createTestServer();
    const viewer = await login(OTHER_USER);
    let last = 0;
    for (let i = 0; i <= STREAM_MONEY_WRITES_PER_MINUTE; i++) {
      last = (
        await viewer.post(STREAM_ROUTES.bet, {
          idempotencyKey: key(),
          streamId: 1,
          roundId: 1,
          side: 'win',
          amount: 100,
        })
      ).statusCode;
    }
    expect(last).toBe(429);
  });
});
