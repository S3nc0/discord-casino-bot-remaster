import type { IntentAck } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../runtime/errors.ts';
import type { ChinchiroTableService } from './chinchiro-table.ts';
import { GUILD, INSTANCE, OTHER_USER, USER, eventsOf, scriptedRng, setup } from './test-kit.ts';

const fail = (fn: () => unknown): AppError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
};

const phaseOf = (table: ChinchiroTableService) => table.snapshot(GUILD, INSTANCE).phase;

// dealer shigoro (4-5-6), host hifumi (1-2-3), guest arashi (5-5-5)
const SCRIPT = { ints: [4, 5, 6, 1, 2, 3, 5, 5, 5] };

describe('chinchiro table', () => {
  it('opens a lobby, seats a guest at the same bet and gives a stake back on standing', () => {
    const s = setup();
    const host = s.caller(USER, INSTANCE);
    const guest = s.caller(OTHER_USER, INSTANCE);
    const { response: opened } = s.games.chinchiroTable.sit(host, { stake: 100 });
    expect(opened.host).toBe(true);
    expect(s.economy.getBalance(GUILD, USER)).toBe(2900);
    const lobby = s.games.chinchiroTable.snapshot(GUILD, INSTANCE);
    expect(lobby).toMatchObject({ game: 'chinchiro', phase: 'lobby', roundId: opened.tableRound });
    expect(lobby.seats).toHaveLength(6);
    expect(lobby.seats[0]).toEqual({ index: 0, userId: USER });
    expect(lobby.data).toMatchObject({ bet: 100, hostId: USER, deadline: s.clock.now() + 60_000 });

    expect(fail(() => s.games.chinchiroTable.sit(guest, { stake: 50 })).code).toBe(
      'invalid_payload',
    );
    expect(fail(() => s.games.chinchiroTable.sit(host, { stake: 100 })).code).toBe('conflict');
    expect(
      fail(() => s.games.chinchiroTable.sit(guest, { stake: 100, roundId: 'cht_other' })).code,
    ).toBe('conflict');
    s.games.chinchiroTable.sit(guest, { stake: 100, roundId: opened.tableRound });
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(2900);
    expect(s.games.core.sessions.isBusy(GUILD, OTHER_USER)).toBe(true);

    const stood = s.games.chinchiroTable.stand(guest, { roundId: opened.tableRound }).response;
    expect(stood.refunded).toBe(100);
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(3000);
    expect(s.games.core.sessions.isBusy(GUILD, OTHER_USER)).toBe(false);
    expect(
      fail(() => s.games.chinchiroTable.stand(guest, { roundId: opened.tableRound })).code,
    ).toBe('conflict');
    expect(s.games.chinchiroTable.snapshot(GUILD, INSTANCE).seats[1]?.userId).toBeNull();
  });

  it('lets only the host start, reveals, then settles every seat on the solo rules', () => {
    const s = setup({ rng: scriptedRng(SCRIPT) });
    const host = s.caller(USER, INSTANCE);
    const guest = s.caller(OTHER_USER, INSTANCE);
    const { tableRound } = s.games.chinchiroTable.sit(host, { stake: 100 }).response;
    s.games.chinchiroTable.sit(guest, { stake: 100 });
    expect(fail(() => s.games.chinchiroTable.begin(guest, { roundId: tableRound })).code).toBe(
      'forbidden',
    );

    s.games.chinchiroTable.begin(host, { roundId: tableRound });
    const playing = s.games.chinchiroTable.snapshot(GUILD, INSTANCE);
    expect(playing.phase).toBe('playing');
    expect(playing.data).toMatchObject({ stepMs: 900, deadline: s.clock.now() + 3 * 900 });
    expect(s.economy.getBalance(GUILD, USER)).toBe(2900); // still escrowed
    expect(
      fail(() =>
        s.games.chinchiroTable.sit(s.caller('200000000000000398', INSTANCE), { stake: 100 }),
      ).code,
    ).toBe('conflict');

    s.timers.advance(3 * 900);
    const result = s.games.chinchiroTable.snapshot(GUILD, INSTANCE);
    expect(result.phase).toBe('result');
    expect(result.data).toMatchObject({
      won: true,
      verdicts: [
        { userId: USER, result: 'lose', multiplier: 4, payout: 0, settled: true },
        { userId: OTHER_USER, result: 'win', multiplier: 3, payout: 400, settled: true },
      ],
    });
    // host: -100 stake, -300 penalty (shigoro 2x, doubled for hifumi: 100 * (4 - 1))
    expect(s.economy.getBalance(GUILD, USER)).toBe(2600);
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(3300);
    expect(eventsOf(s.events, 'GameSettled').map((e) => [e.userId, e.net, e.game])).toEqual([
      [USER, -400, 'chinchiro'],
      [OTHER_USER, 300, 'chinchiro'],
    ]);
    expect(s.games.core.sessions.isBusy(GUILD, USER)).toBe(false);

    s.timers.advance(10_000);
    expect(phaseOf(s.games.chinchiroTable)).toBe('idle');
    expect(s.timers.pending()).toBe(0);
  });

  it('starts by itself after 60 seconds', () => {
    const s = setup();
    s.games.chinchiroTable.sit(s.caller(USER, INSTANCE), { stake: 100 });
    s.timers.advance(59_999);
    expect(phaseOf(s.games.chinchiroTable)).toBe('lobby');
    s.timers.advance(1);
    expect(phaseOf(s.games.chinchiroTable)).toBe('playing');
    s.timers.advance(10_000);
    expect(phaseOf(s.games.chinchiroTable)).toBe('result');
  });

  it('folds the table when nobody is seated at the start', () => {
    const s = setup();
    const host = s.caller(USER, INSTANCE);
    const { tableRound } = s.games.chinchiroTable.sit(host, { stake: 100 }).response;
    s.games.chinchiroTable.stand(host, { roundId: tableRound });
    expect(s.economy.getBalance(GUILD, USER)).toBe(3000);
    s.timers.advance(60_000);
    const snap = s.games.chinchiroTable.snapshot(GUILD, INSTANCE);
    expect(snap.phase).toBe('idle');
    expect(snap.data).toMatchObject({ closedEmpty: true });
    expect(eventsOf(s.events, 'GameSettled')).toHaveLength(0);
    // a new lobby can open again
    s.clock.advance(2_000);
    s.games.chinchiroTable.sit(host, { stake: 100 });
    expect(phaseOf(s.games.chinchiroTable)).toBe('lobby');
  });

  it('refuses a seventh seat', () => {
    const s = setup();
    const host = s.caller(USER, INSTANCE);
    const { tableRound } = s.games.chinchiroTable.sit(host, { stake: 100 }).response;
    for (let i = 1; i < 6; i++) {
      s.economy.ensureMember(GUILD, `20000000000000030${i}`);
      s.games.chinchiroTable.sit(s.caller(`20000000000000030${i}`, INSTANCE), {
        stake: 100,
        roundId: tableRound,
      });
    }
    s.economy.ensureMember(GUILD, '200000000000000399');
    expect(
      fail(() =>
        s.games.chinchiroTable.sit(s.caller('200000000000000399', INSTANCE), { stake: 100 }),
      ).code,
    ).toBe('conflict');
    expect(s.economy.getBalance(GUILD, '200000000000000399')).toBe(3000);
  });

  it('needs an Activity instance and the minimum bet', () => {
    const s = setup();
    expect(fail(() => s.games.chinchiroTable.sit(s.caller(USER), { stake: 100 })).code).toBe(
      'invalid_payload',
    );
    expect(
      fail(() => s.games.chinchiroTable.sit(s.caller(USER, INSTANCE), { stake: 9 })).code,
    ).toBe('invalid_payload');
    expect(phaseOf(s.games.chinchiroTable)).toBe('idle');
  });

  it('replays a repeated sit without charging twice, and refunds open seats on recovery', () => {
    const s = setup();
    const host = s.caller(USER, INSTANCE);
    const key = 'key-0000000000000001';
    s.games.chinchiroTable.sit(host, { stake: 100, idempotencyKey: key });
    const again = s.games.chinchiroTable.sit(host, { stake: 100, idempotencyKey: key });
    expect(again.replayed).toBe(true);
    expect(s.economy.getBalance(GUILD, USER)).toBe(2900);
    expect(s.games.recover()).toBe(1);
    expect(s.economy.getBalance(GUILD, USER)).toBe(3000);
  });

  it('is driven by intents: bet with args.table, then stand and begin as actions', async () => {
    const s = setup({ rng: scriptedRng(SCRIPT) });
    const scope = (userId: string) => ({ guildId: GUILD, userId, instanceId: INSTANCE }) as never;
    const ok = (ack: IntentAck): Extract<IntentAck, { ok: true }> => {
      if (!ack.ok) throw new Error(`rejected: ${ack.error}`);
      return ack;
    };
    const opened = ok(
      await s.games.handlers.bet!(scope(USER), {
        idempotencyKey: 'key-00000000000000a1',
        game: 'chinchiro',
        stake: 100,
        args: { table: true },
      }),
    );
    expect(s.games.handlers.tableSnapshot?.(scope(USER), 'chinchiro')?.phase).toBe('lobby');
    ok(
      await s.games.handlers.bet!(scope(OTHER_USER), {
        idempotencyKey: 'key-00000000000000a2',
        game: 'chinchiro',
        stake: 100,
        roundId: (opened.result as { tableRound: string }).tableRound,
        args: { table: true },
      }),
    );
    const tableRound = (opened.result as { tableRound: string }).tableRound;
    const denied = await s.games.handlers.action!(scope(OTHER_USER), {
      idempotencyKey: 'key-00000000000000a3',
      game: 'chinchiro',
      roundId: tableRound,
      action: 'begin',
    });
    expect(denied).toMatchObject({ ok: false, error: 'forbidden' });
    ok(
      await s.games.handlers.action!(scope(USER), {
        idempotencyKey: 'key-00000000000000a4',
        game: 'chinchiro',
        roundId: tableRound,
        action: 'begin',
      }),
    );
    s.timers.advance(3 * 900);
    expect(phaseOf(s.games.chinchiroTable)).toBe('result');
  });
});
