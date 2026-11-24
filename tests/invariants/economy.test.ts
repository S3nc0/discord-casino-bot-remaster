import fc from 'fast-check';
import { afterEach, describe, it } from 'vitest';
import { commands, step, type Cmd, type Replayable } from './commands.ts';
import { checkInvariants, createWorld, warmUp, type World } from './world.ts';

const RUNS = Number(process.env['INVARIANT_RUNS'] ?? 60);
const SEED =
  process.env['INVARIANT_SEED'] === undefined ? undefined : Number(process.env['INVARIANT_SEED']);

let live: World | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});

/** Play a command list through a fresh economy, checking the invariants after every step. */
async function play(seed: number, played: number[], list: Cmd[]): Promise<void> {
  const w = createWorld(seed, { relicAuctionPerDay: 1 });
  try {
    warmUp(w, played);
    let last: Replayable | undefined;
    for (const [index, cmd] of list.entries()) {
      try {
        const result = step(w, cmd, last);
        if (result.keyed) last = result.keyed;
        checkInvariants(w);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`step ${index} ${JSON.stringify(cmd)}: ${message}`, { cause: error });
      }
    }
  } finally {
    await w.close();
  }
}

const options = { numRuns: RUNS, ...(SEED === undefined ? {} : { seed: SEED }) };

describe('economy invariants over random command sequences', () => {
  it(
    'keeps balances, the ledger, supply, transfers and replays consistent',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 1_000_000 }),
          fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 6, maxLength: 6 }),
          commands(),
          async (seed, played, list) => {
            await play(seed, played, list);
          },
        ),
        options,
      );
      // fast-check enforces no deadline of its own; vitest's limit grows with the number of runs.
    },
    20_000 + RUNS * 150,
  );
});
