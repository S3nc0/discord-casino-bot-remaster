import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GUILD, USER, createTestServer, type TestServer } from '../runtime/test-kit.ts';
import {
  PIN_LOG_THROTTLE_MS,
  PostPinService,
  createDiscordPinPort,
  type PinOutcome,
  type PostPinPort,
} from './post-pins.ts';

let server: TestServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

function fakePort(overrides: Partial<PostPinPort> = {}) {
  const calls: string[] = [];
  const port: PostPinPort = {
    pin: vi.fn(async (c: string, m: string): Promise<PinOutcome> => {
      calls.push(`pin ${c}/${m}`);
      return { ok: true };
    }),
    unpin: vi.fn(async (c: string, m: string): Promise<PinOutcome> => {
      calls.push(`unpin ${c}/${m}`);
      return { ok: true };
    }),
    ...overrides,
  };
  return { port, calls };
}

function setup(port: PostPinPort | null = fakePort().port) {
  server = createTestServer({ casinoHandlers: true });
  server.economy.ensureMember(GUILD, USER);
  const warn = vi.fn();
  const logger = { warn, info: vi.fn(), error: vi.fn() } as unknown as Logger;
  const pins = new PostPinService({ store: server.store, clock: server.clock, logger });
  pins.attach(port);
  return { s: server, pins, warn };
}

const post = (kind: 'poll' | 'motion' | 'raffle', refId: number, messageId = `m${refId}`) => ({
  kind,
  refId,
  guildId: GUILD,
  channelId: 'c1',
  messageId,
});

const rows = (s: TestServer) =>
  s.store.stmt('SELECT kind, ref_id, message_id FROM pinned_posts ORDER BY kind, ref_id').all();

function openPoll(s: TestServer) {
  return s.games.poll.create({ guildId: GUILD, creatorId: USER, title: 'Lunch?', minutes: 5 });
}

describe('pinPost', () => {
  it('pins the message and remembers it', async () => {
    const { port, calls } = fakePort();
    const { s, pins } = setup(port);
    const poll = openPoll(s);
    expect(await pins.pinPost(post('poll', poll.id))).toBe('pinned');
    expect(calls).toEqual([`pin c1/m${poll.id}`]);
    expect(rows(s)).toEqual([{ kind: 'poll', ref_id: poll.id, message_id: `m${poll.id}` }]);
  });

  it('is a quiet no-op without a Discord client', async () => {
    const { s, pins, warn } = setup(null);
    expect(await pins.pinPost(post('poll', openPoll(s).id))).toBe('skipped');
    expect(await pins.sweep()).toBe(0);
    expect(rows(s)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('never throws when the pin is refused, and keeps no row', async () => {
    const { port } = fakePort({
      pin: async () => ({
        ok: false,
        reason: 'missing_permissions',
        message: 'Missing Permissions',
      }),
    });
    const { s, pins, warn } = setup(port);
    expect(await pins.pinPost(post('raffle', 1))).toBe('failed');
    expect(rows(s)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![1])).toContain('Pin Messages');
  });

  it('never throws when the port itself throws', async () => {
    const { port } = fakePort({
      pin: async () => {
        throw new Error('boom');
      },
    });
    const { pins } = setup(port);
    await expect(pins.pinPost(post('poll', 1))).resolves.toBe('failed');
  });

  it('logs at most once per guild per throttle window', async () => {
    const { port } = fakePort({ pin: async () => ({ ok: false, reason: 'pin_limit' }) });
    const { s, pins, warn } = setup(port);
    await pins.pinPost(post('poll', 1));
    await pins.pinPost(post('poll', 2));
    expect(warn).toHaveBeenCalledTimes(1);
    s.clock.advance(PIN_LOG_THROTTLE_MS);
    await pins.pinPost(post('poll', 3));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('unpins the older post when the same raffle is pinned again (repost)', async () => {
    const { port, calls } = fakePort();
    const { s, pins } = setup(port);
    await pins.pinPost(post('raffle', 7, 'old'));
    await pins.pinPost(post('raffle', 7, 'new'));
    expect(calls).toEqual(['pin c1/old', 'unpin c1/old', 'pin c1/new']);
    expect(rows(s)).toEqual([{ kind: 'raffle', ref_id: 7, message_id: 'new' }]);
  });
});

describe('sweep', () => {
  it('keeps a pin while the poll is open and unpins it when the poll closes', async () => {
    const { port, calls } = fakePort();
    const { s, pins } = setup(port);
    const poll = openPoll(s);
    await pins.pinPost(post('poll', poll.id));
    expect(await pins.sweep()).toBe(0);
    s.clock.advance(6 * 60_000);
    s.games.poll.closeDue(GUILD);
    expect(await pins.sweep()).toBe(1);
    expect(calls).toEqual([`pin c1/m${poll.id}`, `unpin c1/m${poll.id}`]);
    expect(rows(s)).toEqual([]);
  });

  it('unpins a raffle that was cancelled and one that was drawn', async () => {
    const { port, calls } = fakePort();
    const { s, pins } = setup(port);
    const cancelled = s.games.lottery.host({ guildId: GUILD, hostId: USER, fee: 500, minutes: 30 });
    await pins.pinPost(post('raffle', cancelled.id));
    expect(await pins.sweep()).toBe(0);
    s.games.lottery.cancel(GUILD);
    expect(await pins.sweep()).toBe(1);

    const drawn = s.games.lottery.host({ guildId: GUILD, hostId: USER, fee: 500, minutes: 1 });
    await pins.pinPost(post('raffle', drawn.id));
    s.clock.advance(2 * 60_000);
    s.games.lottery.drawDue(GUILD);
    expect(await pins.sweep()).toBe(1);
    expect(calls.filter((c) => c.startsWith('unpin'))).toHaveLength(2);
    expect(rows(s)).toEqual([]);
  });

  it('unpins a kyosai motion once it is closed', async () => {
    const { port, calls } = fakePort();
    const { s, pins } = setup(port);
    s.finance.kyosai.ensureSupply(GUILD);
    s.store
      .stmt(
        'INSERT INTO kyosai_units (guild_id, holder_key, user_id, is_house, units) VALUES (?, ?, ?, 0, 100)',
      )
      .run(GUILD, USER, USER);
    const proposed = s.finance.kyosai.proposeMotion(GUILD, USER, 2_000_000);
    expect(proposed.ok).toBe(true);
    const id = proposed.ok ? proposed.data.id : 0;
    await pins.pinPost(post('motion', id));
    expect(await pins.sweep()).toBe(0);
    s.clock.advance(25 * 3_600_000);
    expect(s.finance.kyosai.closeExpiredMotions(GUILD)).toHaveLength(1);
    expect(await pins.sweep()).toBe(1);
    expect(calls).toEqual([`pin c1/m${id}`, `unpin c1/m${id}`]);
  });

  it('ignores a message that is already gone, silently', async () => {
    const { port } = fakePort({ unpin: async () => ({ ok: false, reason: 'message_gone' }) });
    const { s, pins, warn } = setup(port);
    await pins.pinPost(post('poll', 999)); // no such poll: counts as ended
    expect(await pins.sweep()).toBe(1);
    expect(rows(s)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops the row at once and logs when the permission is missing', async () => {
    const { port } = fakePort();
    const { s, pins, warn } = setup(port);
    await pins.pinPost(post('poll', 999));
    port.unpin = async () => ({ ok: false, reason: 'missing_permissions' });
    expect(await pins.sweep()).toBe(1);
    expect(rows(s)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('retries an unexpected error twice, then gives up', async () => {
    const { port } = fakePort();
    const { s, pins } = setup(port);
    await pins.pinPost(post('poll', 999));
    port.unpin = async () => {
      throw new Error('network');
    };
    expect(await pins.sweep()).toBe(0);
    expect(await pins.sweep()).toBe(0);
    expect(rows(s)).toHaveLength(1);
    expect(await pins.sweep()).toBe(1);
    expect(rows(s)).toEqual([]);
  });
});

describe('createDiscordPinPort', () => {
  const clientWith = (messages: object | null) =>
    ({ channels: { fetch: async () => messages } }) as never;

  it('pins and unpins through the channel message manager', async () => {
    const pin = vi.fn(async () => undefined);
    const unpin = vi.fn(async () => undefined);
    const port = createDiscordPinPort(clientWith({ messages: { pin, unpin } }));
    expect(await port.pin('c', 'm')).toEqual({ ok: true });
    expect(await port.unpin('c', 'm')).toEqual({ ok: true });
    expect(pin).toHaveBeenCalledWith('m');
    expect(unpin).toHaveBeenCalledWith('m');
  });

  it.each([
    [50013, 'missing_permissions'],
    [50001, 'missing_permissions'],
    [30003, 'pin_limit'],
    [10008, 'message_gone'],
    [10003, 'channel_gone'],
    [500, 'error'],
  ])('maps Discord error %i to %s', async (code, reason) => {
    const fail = async () => {
      throw Object.assign(new Error('x'), { code });
    };
    const port = createDiscordPinPort(clientWith({ messages: { pin: fail, unpin: fail } }));
    expect(await port.pin('c', 'm')).toMatchObject({ ok: false, reason });
  });

  it('reports a missing channel', async () => {
    const port = createDiscordPinPort(clientWith(null));
    expect(await port.pin('c', 'm')).toEqual({ ok: false, reason: 'channel_gone' });
  });
});
