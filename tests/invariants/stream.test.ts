import { afterEach, describe, expect, it } from 'vitest';
import { step, type Cmd } from './commands.ts';
import { checkStreams } from './stream-check.ts';
import { GUILDS, USERS, checkInvariants, createWorld, warmUp, type World } from './world.ts';

let live: World | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});

/** Run a fixed command list, checking the invariants after every step. */
function run(w: World, list: Cmd[]): void {
  let last: ReturnType<typeof step>['keyed'];
  for (const [index, cmd] of list.entries()) {
    try {
      const r = step(w, cmd, last);
      if (r.keyed) last = r.keyed;
      checkInvariants(w);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`step ${index} ${JSON.stringify(cmd)}: ${message}`, { cause: error });
    }
  }
}

const settledRounds = (w: World): { id: number; status: string }[] =>
  w.server.store
    .stmt(
      `SELECT id, status FROM stream_rounds WHERE status IN ('win', 'lose', 'void') ORDER BY id`,
    )
    .all() as { id: number; status: string }[];

const script: Cmd[] = [
  { t: 'grant', g: 0, u: 1, amount: 30_000 },
  { t: 'grant', g: 0, u: 2, amount: 30_000 },
  { t: 'streamStart', g: 0, u: 0, k: 0 },
  { t: 'streamTip', g: 0, u: 1, amount: 1200, k: 0 },
  { t: 'replay' },
  { t: 'streamTip', g: 0, u: 0, amount: 500, k: 1 }, // self tip
  { t: 'streamOpen', g: 0, u: 0, k: 0 },
  { t: 'streamBet', g: 0, u: 1, side: 'win', amount: 1000, k: 0 },
  { t: 'streamBet', g: 0, u: 2, side: 'lose', amount: 2000, k: 0 },
  { t: 'replay' },
  { t: 'streamBet', g: 0, u: 0, side: 'win', amount: 100, k: 0 }, // streamer
  { t: 'streamSettle', g: 0, u: 0, winner: 'win', k: 0 }, // still open: refused
  { t: 'streamLock', g: 0, u: 0, k: 0 },
  { t: 'streamSettle', g: 0, u: 1, winner: 'lose', k: 0 }, // not the streamer
  { t: 'streamSettle', g: 0, u: 0, winner: 'win', k: 1 },
  { t: 'replay' },
  { t: 'streamOpen', g: 0, u: 0, k: 1 },
  { t: 'streamBet', g: 0, u: 2, side: 'lose', amount: 900, k: 1 },
  { t: 'streamCloseDue', advance: 10 * 60_000 }, // auto-lock
  { t: 'streamSettle', g: 0, u: 0, winner: 'lose', k: 2 }, // one-sided: refunded
  { t: 'streamOpen', g: 0, u: 0, k: 2 },
  { t: 'streamBet', g: 0, u: 1, side: 'win', amount: 700, k: 2 },
  { t: 'streamVoid', g: 0, u: 0, owner: true, k: 0 },
  { t: 'streamOpen', g: 0, u: 0, k: 0 }, // same key as round 1: a replay of that response
  { t: 'streamStart', g: 1, u: 1, k: 0 },
  { t: 'streamOpen', g: 1, u: 1, k: 0 },
  { t: 'streamBet', g: 1, u: 2, side: 'win', amount: 300, k: 0 },
  { t: 'streamEnd', g: 1, u: 1, k: 0 },
  { t: 'streamOpen', g: 0, u: 0, k: 1 }, // a replay too: no new round
  { t: 'streamCloseDue', advance: 25 * 3_600_000 }, // the 24 h close ends the panel
];

describe('stream panel invariants', () => {
  it('a scripted run keeps every round paid exactly once and by the formula', () => {
    const w = createWorld(21);
    live = w;
    warmUp(w, [0, 3, 3, 0, 3, 3]);
    run(w, script);
    const rounds = settledRounds(w);
    expect(rounds.map((r) => r.status)).toEqual(['win', 'lose', 'void', 'void']);
    // A 1,000 on win, B 2,000 on lose: rake 100, A gets 1,000 + 1,900.
    const payout = w.server.store
      .stmt(`SELECT delta FROM ledger WHERE reason = 'stream_payout' AND user_id = ?`)
      .all(USERS[1]) as { delta: number }[];
    expect(payout).toEqual([{ delta: 2900 }]);
    const live2 = w.server.store
      .stmt(`SELECT COUNT(*) AS n FROM streams WHERE status = 'live'`)
      .get() as { n: number };
    expect(live2.n).toBe(0);
  });

  it('catches a payout one Pelica too high (mutation)', () => {
    const w = createWorld(22);
    live = w;
    warmUp(w, [0, 3, 3, 0, 3, 3]);
    run(w, script.slice(0, 15));
    const [paid] = settledRounds(w);
    expect(paid?.status).toBe('win');
    // The mutation: the winner is credited one more Pelica on the same round.
    w.server.economy.credit({
      guildId: GUILDS[0],
      userId: USERS[1],
      amount: 1,
      reason: 'stream_payout',
      refType: 'stream_round',
      refId: String(paid?.id),
      idempotencyKey: 'mutation-plus-one',
    });
    expect(() => checkStreams(w)).toThrow(/paid .* 2 times/);
  });

  it('catches a refunded round that kept a rake (mutation)', () => {
    const w = createWorld(23);
    live = w;
    warmUp(w, [0, 3, 3, 0, 3, 3]);
    run(w, script.slice(0, 20));
    const refunded = settledRounds(w).find((r) => r.status === 'lose');
    expect(refunded).toBeDefined();
    w.server.store
      .stmt(`UPDATE stream_round_audit SET rake = rake + 1 WHERE round_id = ?`)
      .run(refunded?.id);
    expect(() => checkStreams(w)).toThrow(/refund kept/);
  });
});
