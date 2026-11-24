import { afterEach, describe, expect, it } from 'vitest';
import { step, type Cmd } from './commands.ts';
import { checkInvariants, createWorld, relicCount, type World } from './world.ts';

let live: World | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});

/** Run a fixed command list, checking the invariants after every step. */
function run(w: World, list: Cmd[]): void {
  for (const [index, cmd] of list.entries()) {
    try {
      step(w, cmd, undefined);
      checkInvariants(w);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`step ${index} ${JSON.stringify(cmd)}: ${message}`, { cause: error });
    }
  }
}

const sales = (w: World): number =>
  (
    w.server.store
      .stmt(
        "SELECT COUNT(*) AS n FROM marketplace_listings WHERE seller_id = '0' AND status = 'sold'",
      )
      .get() as { n: number }
  ).n;

describe('Teiai daily relic auction invariants', () => {
  it('lists once a day, sells to the top bid as a sink, and an unsold relic vanishes', () => {
    const w = createWorld(11, { relicAuctionPerDay: 1 });
    live = w;
    run(w, [
      { t: 'grant', g: 0, u: 0, amount: 60_000 },
      { t: 'grant', g: 0, u: 1, amount: 60_000 },
      { t: 'teiaiRelic', g: 0 },
      { t: 'teiaiRelic', g: 0 },
      { t: 'relicBid', g: 0, u: 0, extra: 0 },
      { t: 'relicBid', g: 0, u: 1, extra: 300 },
      { t: 'relicSettle', g: 0 },
      // The next UTC day: a new relic, which nobody bids on.
      { t: 'advance', ms: 12 * 3_600_000 },
      { t: 'advance', ms: 12 * 3_600_000 },
      { t: 'teiaiRelic', g: 0 },
      { t: 'relicSettle', g: 0 },
    ]);
    expect(sales(w)).toBe(1);
    expect(relicCount(w)).toBe(1);
    const rows = w.server.store
      .stmt("SELECT status FROM marketplace_listings WHERE seller_id = '0' ORDER BY id")
      .all() as { status: string }[];
    expect(rows.map((r) => r.status)).toEqual(['sold', 'expired']);
  });

  it('never lists when it is off', () => {
    const w = createWorld(12);
    live = w;
    run(w, [
      { t: 'teiaiRelic', g: 0 },
      { t: 'relicBid', g: 0, u: 0, extra: 0 },
    ]);
    const n = w.server.store.stmt('SELECT COUNT(*) AS n FROM marketplace_listings').get() as {
      n: number;
    };
    expect(n.n).toBe(0);
  });
});
