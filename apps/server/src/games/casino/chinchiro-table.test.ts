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

const THIRD = '200000000000000303';
// host shigoro (4-5-6), guest hifumi (1-2-3), third point 6 (1-1-6)
const SCRIPT = { ints: [4, 5, 6, 1, 2, 3, 1, 1, 6] };

const code = (fn: () => unknown) => {
  const error = fail(fn);
  return { code: error.code, rule: (error as { rule?: string }).rule };
};

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

  it('lets only the host start, then each seat rolls and the strongest hand takes the pot', () => {
    const s = setup({ rng: scriptedRng(SCRIPT) });
    const host = s.caller(USER, INSTANCE);
    const guest = s.caller(OTHER_USER, INSTANCE);
    const { tableRound } = s.games.chinchiroTable.sit(host, { stake: 100 }).response;
    s.games.chinchiroTable.sit(guest, { stake: 100 });
    expect(code(() => s.games.chinchiroTable.roll(host, { roundId: tableRound }))).toEqual({
      code: 'conflict',
      rule: 'chinchiro_table_not_started',
    });
    expect(fail(() => s.games.chinchiroTable.begin(guest, { roundId: tableRound })).code).toBe(
      'forbidden',
    );

    s.games.chinchiroTable.begin(host, { roundId: tableRound });
    const rolling = s.games.chinchiroTable.snapshot(GUILD, INSTANCE);
    expect(rolling.phase).toBe('rolling');
    expect(rolling.data).toMatchObject({
      deadline: s.clock.now() + 45_000,
      minSeats: 2,
      rakeBps: 1000,
      hands: [
        { userId: USER, rolled: false, rolls: [] },
        { userId: OTHER_USER, rolled: false, rolls: [] },
      ],
    });
    expect(s.economy.getBalance(GUILD, USER)).toBe(2900); // still escrowed
    const stranger = s.caller('200000000000000398', INSTANCE);
    expect(fail(() => s.games.chinchiroTable.sit(stranger, { stake: 100 })).code).toBe('conflict');
    expect(code(() => s.games.chinchiroTable.roll(stranger, { roundId: tableRound }))).toEqual({
      code: 'forbidden',
      rule: 'chinchiro_table_not_at_table',
    });

    const mine = s.games.chinchiroTable.roll(host, { roundId: tableRound }).response;
    expect(mine).toMatchObject({ finished: false, rolls: [{ dice: [4, 5, 6] }] });
    expect(code(() => s.games.chinchiroTable.roll(host, { roundId: tableRound }))).toEqual({
      code: 'conflict',
      rule: 'chinchiro_table_already_rolled',
    });
    expect(s.games.chinchiroTable.snapshot(GUILD, INSTANCE).data).toMatchObject({
      hands: [{ rolled: true }, { rolled: false, rolls: [] }],
    });

    // the last roll settles at once
    expect(s.games.chinchiroTable.roll(guest, { roundId: tableRound }).response.finished).toBe(
      true,
    );
    const result = s.games.chinchiroTable.snapshot(GUILD, INSTANCE);
    expect(result.phase).toBe('result');
    expect(result.data).toMatchObject({
      rake: 10,
      refunded: false,
      results: [
        { userId: USER, isWinner: true, payout: 190, net: 90, settled: true },
        { userId: OTHER_USER, isWinner: false, payout: 0, net: -100, settled: true },
      ],
    });
    // no double payment for hifumi at the table, no RTP correction
    expect(s.economy.getBalance(GUILD, USER)).toBe(3090);
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(2900);
    expect(eventsOf(s.events, 'GameSettled').map((e) => [e.userId, e.net, e.game])).toEqual([
      [USER, 90, 'chinchiro'],
      [OTHER_USER, -100, 'chinchiro'],
    ]);
    expect(s.games.core.sessions.isBusy(GUILD, USER)).toBe(false);
    expect(code(() => s.games.chinchiroTable.roll(guest, { roundId: tableRound }))).toEqual({
      code: 'conflict',
      rule: 'chinchiro_table_finished',
    });
    expect(s.timers.pending()).toBe(1); // only the result timer: the roll timer was cancelled

    s.timers.advance(10_000);
    expect(phaseOf(s.games.chinchiroTable)).toBe('idle');
    expect(s.timers.pending()).toBe(0);
  });

  it('lists the result strongest first and splits a tie, the rest of the division going to the fee', () => {
    // host point 3, guest shigoro, third shigoro: the guest and the third split
    const s = setup({ rng: scriptedRng({ ints: [2, 2, 3, 4, 5, 6, 6, 5, 4] }) });
    s.economy.ensureMember(GUILD, THIRD);
    const host = s.caller(USER, INSTANCE);
    const { tableRound } = s.games.chinchiroTable.sit(host, { stake: 333 }).response;
    s.games.chinchiroTable.sit(s.caller(OTHER_USER, INSTANCE), { stake: 333 });
    s.games.chinchiroTable.sit(s.caller(THIRD, INSTANCE), { stake: 333 });
    s.games.chinchiroTable.begin(host, { roundId: tableRound });
    for (const id of [USER, OTHER_USER, THIRD]) {
      s.games.chinchiroTable.roll(s.caller(id, INSTANCE), { roundId: tableRound });
    }
    expect(s.games.chinchiroTable.snapshot(GUILD, INSTANCE).data).toMatchObject({
      rake: 35,
      results: [
        { userId: OTHER_USER, isWinner: true, payout: 482 },
        { userId: THIRD, isWinner: true, payout: 482 },
        { userId: USER, isWinner: false, payout: 0 },
      ],
    });
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(3149);
    expect(s.economy.getBalance(GUILD, THIRD)).toBe(3149);
    expect(s.economy.getBalance(GUILD, USER)).toBe(2667);
  });

  it('rolls everyone left automatically when the 45 seconds run out', () => {
    const s = setup({ rng: scriptedRng(SCRIPT) });
    s.economy.ensureMember(GUILD, THIRD);
    const host = s.caller(USER, INSTANCE);
    const { tableRound } = s.games.chinchiroTable.sit(host, { stake: 100 }).response;
    s.games.chinchiroTable.sit(s.caller(OTHER_USER, INSTANCE), { stake: 100 });
    s.games.chinchiroTable.sit(s.caller(THIRD, INSTANCE), { stake: 100 });
    s.timers.advance(60_000); // the lobby starts by itself
    expect(phaseOf(s.games.chinchiroTable)).toBe('rolling');
    s.games.chinchiroTable.roll(host, { roundId: tableRound });
    s.timers.advance(44_999);
    expect(phaseOf(s.games.chinchiroTable)).toBe('rolling');
    s.timers.advance(1);
    const snap = s.games.chinchiroTable.snapshot(GUILD, INSTANCE);
    expect(snap.phase).toBe('result');
    expect(snap.data).toMatchObject({
      hands: [{ rolled: true }, { rolled: true }, { rolled: true }],
      rake: 20,
      results: [
        { userId: USER, isWinner: true, payout: 280 },
        { userId: THIRD },
        { userId: OTHER_USER },
      ],
    });
    expect(s.economy.getBalance(GUILD, USER)).toBe(3180);
  });

  it('folds a table of one at the start and refunds the stake', () => {
    const s = setup();
    const host = s.caller(USER, INSTANCE);
    const { tableRound } = s.games.chinchiroTable.sit(host, { stake: 100 }).response;
    expect(s.economy.getBalance(GUILD, USER)).toBe(2900);
    s.games.chinchiroTable.begin(host, { roundId: tableRound });
    const snap = s.games.chinchiroTable.snapshot(GUILD, INSTANCE);
    expect(snap.phase).toBe('idle');
    expect(snap.data).toMatchObject({ folded: true });
    expect(s.economy.getBalance(GUILD, USER)).toBe(3000);
    expect(s.games.core.sessions.isBusy(GUILD, USER)).toBe(false);
    expect(eventsOf(s.events, 'GameSettled')).toHaveLength(0);
    expect(s.timers.pending()).toBe(0);
  });

  it('settles the whole table in one transaction: one failing seat pays nobody and refunds all', () => {
    const s = setup({ rng: scriptedRng(SCRIPT) });
    s.economy.ensureMember(GUILD, THIRD);
    const host = s.caller(USER, INSTANCE);
    const { tableRound } = s.games.chinchiroTable.sit(host, { stake: 100 }).response;
    s.games.chinchiroTable.sit(s.caller(OTHER_USER, INSTANCE), { stake: 100 });
    s.games.chinchiroTable.sit(s.caller(THIRD, INSTANCE), { stake: 100 });
    s.games.chinchiroTable.begin(host, { roundId: tableRound });
    const core = s.games.core;
    const real = core.settle.bind(core);
    let calls = 0;
    core.settle = (...args: Parameters<typeof real>) => {
      calls += 1;
      if (calls === 3) throw new Error('disk full');
      return real(...args);
    };
    s.timers.advance(45_000);
    expect(calls).toBe(3);
    const snap = s.games.chinchiroTable.snapshot(GUILD, INSTANCE);
    expect(snap.phase).toBe('result');
    expect(snap.data).toMatchObject({ refunded: true, rake: 0 });
    for (const id of [USER, OTHER_USER, THIRD]) {
      expect(s.economy.getBalance(GUILD, id)).toBe(3000);
      expect(core.sessions.isBusy(GUILD, id)).toBe(false);
    }
    const reasons = s.store
      .stmt("SELECT reason FROM ledger WHERE reason LIKE 'game_%' ORDER BY id")
      .all()
      .map((r) => (r as { reason: string }).reason);
    expect(reasons).toEqual([
      'game_stake',
      'game_stake',
      'game_stake',
      'game_refund',
      'game_refund',
      'game_refund',
    ]);
    expect(eventsOf(s.events, 'GameSettled')).toHaveLength(0);
    expect(s.games.recover()).toBe(0);
  });

  it('replays a repeated roll without rolling again', () => {
    const s = setup({ rng: scriptedRng(SCRIPT) });
    const host = s.caller(USER, INSTANCE);
    const { tableRound } = s.games.chinchiroTable.sit(host, { stake: 100 }).response;
    s.games.chinchiroTable.sit(s.caller(OTHER_USER, INSTANCE), { stake: 100 });
    s.games.chinchiroTable.begin(host, { roundId: tableRound });
    const key = 'key-00000000000000r1';
    const first = s.games.chinchiroTable.roll(host, { roundId: tableRound, idempotencyKey: key });
    const again = s.games.chinchiroTable.roll(host, { roundId: tableRound, idempotencyKey: key });
    expect(again.replayed).toBe(true);
    expect(again.response).toEqual(first.response);
    expect(phaseOf(s.games.chinchiroTable)).toBe('rolling');
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

  it('is driven by intents: bet with args.table, then begin and table_roll as actions', async () => {
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
    expect(phaseOf(s.games.chinchiroTable)).toBe('rolling');
    for (const [userId, idempotencyKey] of [
      [USER, 'key-00000000000000a5'],
      [OTHER_USER, 'key-00000000000000a6'],
    ] as const) {
      ok(
        await s.games.handlers.action!(scope(userId), {
          idempotencyKey,
          game: 'chinchiro',
          roundId: tableRound,
          action: 'table_roll',
        }),
      );
    }
    expect(phaseOf(s.games.chinchiroTable)).toBe('result');
  });
});
