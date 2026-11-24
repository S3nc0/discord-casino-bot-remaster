// Stream panel commands for the invariant suite (docs/spec/stream.md §11). The money check
// they are held to after every step is `stream-check.ts`.
import fc from 'fast-check';
import { GameRuleError } from '../../apps/server/src/games/progression/context.ts';
import { AppError } from '../../apps/server/src/runtime/errors.ts';
import { GUILDS, USERS, dayOf, type World } from './world.ts';

export type StreamCmd =
  | { t: 'streamStart'; g: number; u: number; k: number }
  | { t: 'streamTip'; g: number; u: number; amount: number; k: number }
  | { t: 'streamOpen'; g: number; u: number; k: number }
  | { t: 'streamBet'; g: number; u: number; side: 'win' | 'lose'; amount: number; k: number }
  | { t: 'streamLock'; g: number; u: number; k: number }
  | { t: 'streamSettle'; g: number; u: number; winner: 'win' | 'lose'; k: number }
  | { t: 'streamVoid'; g: number; u: number; owner: boolean; k: number }
  | { t: 'streamEnd'; g: number; u: number; k: number }
  /** The 1-minute jobs: lock rounds past `autoLockAt`, close panels past 24 h. */
  | { t: 'streamCloseDue'; advance: number };

// Streams mostly play in the first guild, so rounds get bettors on both sides.
const g = fc.oneof({ weight: 4, arbitrary: fc.constant(0) }, fc.nat(GUILDS.length - 1));
const u = fc.nat(USERS.length - 1);
const k = fc.nat(2);
const side = fc.constantFrom('win' as const, 'lose' as const);
const betAmount = fc.oneof(
  { weight: 5, arbitrary: fc.integer({ min: 100, max: 3000 }) },
  { weight: 1, arbitrary: fc.integer({ min: 3000, max: 11_000 }) },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 99 }) },
);
const tipAmount = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: 100, max: 3000 }) },
  { weight: 1, arbitrary: fc.integer({ min: 3000, max: 21_000 }) },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 99 }) },
);

export const streamCommands: { weight: number; arbitrary: fc.Arbitrary<StreamCmd> }[] = [
  { weight: 3, arbitrary: fc.record({ t: fc.constant('streamStart' as const), g, u, k }) },
  {
    weight: 3,
    arbitrary: fc.record({ t: fc.constant('streamTip' as const), g, u, amount: tipAmount, k }),
  },
  { weight: 4, arbitrary: fc.record({ t: fc.constant('streamOpen' as const), g, u, k }) },
  {
    weight: 10,
    arbitrary: fc.record({
      t: fc.constant('streamBet' as const),
      g,
      u,
      side,
      amount: betAmount,
      k,
    }),
  },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('streamLock' as const), g, u, k }) },
  {
    weight: 4,
    arbitrary: fc.record({ t: fc.constant('streamSettle' as const), g, u, winner: side, k }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ t: fc.constant('streamVoid' as const), g, u, owner: fc.boolean(), k }),
  },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('streamEnd' as const), g, u, k }) },
  {
    weight: 2,
    arbitrary: fc.record({
      t: fc.constant('streamCloseDue' as const),
      advance: fc.oneof(
        fc.integer({ min: 0, max: 60_000 }),
        fc.integer({ min: 9 * 60_000, max: 11 * 60_000 }),
        fc.integer({ min: 20 * 3_600_000, max: 25 * 3_600_000 }),
      ),
    }),
  },
];

/** What `step` returns (kept here so this file does not import the command list back). */
interface StepResult {
  keyed?: { describe: string; run(): { response: unknown; replayed: boolean } };
}

/** The transfer oracle of `commands.ts` (`expectedTransfer`), passed in by the caller. */
type TransferOracle = (input: {
  sender: string;
  receiver: string;
  amount: number;
  games: number;
  sentToday: number;
  debt: number;
  balance: number;
}) => { ok: true; fee: number } | { ok: false; code: string };

type Keyed = (
  describe: string,
  who: { g: number; u: number },
  idempotencyKey: string,
  run: () => { response: unknown; replayed: boolean },
) => StepResult;

interface LiveStream {
  id: number;
  streamer_id: string;
}
interface RoundRow {
  id: number;
  status: string;
  auto_lock_at: number;
}

const OWNER = '123456789012345699';

/** Whether a command is one of the stream panel's. */
export function isStreamCmd(c: { t: string }): c is StreamCmd {
  return c.t.startsWith('stream');
}

/** A stream write as the suite's replay bookkeeping wants it. */
const asReplay =
  <R extends { replayed: boolean }>(fn: () => R) =>
  (): { response: unknown; replayed: boolean } => {
    const response = fn();
    return { response, replayed: response.replayed };
  };
const ledgerCount = (w: World): number =>
  (w.server.store.stmt('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }).n;

/** The rule (or error code) that refused a call, or null when it went through. */
function refusal(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof GameRuleError) return error.rule;
    if (error instanceof AppError) return error.code;
    throw error;
  }
}

/** Run one stream command; `keyed` is the suite's replay bookkeeping. */
export function stepStream(
  w: World,
  c: StreamCmd,
  keyed: Keyed,
  expectedTransfer: TransferOracle,
): StepResult {
  const s = w.server;
  if (c.t === 'streamCloseDue') {
    w.timers.advance(c.advance);
    for (const guildId of GUILDS) {
      s.stream.lockDue(guildId);
      s.stream.closeDue(guildId);
    }
    return {};
  }
  const guildId = GUILDS[c.g] as string;
  const userId = USERS[c.u] as string;
  const actor = { guildId, userId };
  const idem = `${c.t}-${c.g}-${c.u}-${c.k}`.padEnd(16, '_');
  const live = s.store
    .stmt(
      `SELECT id, streamer_id FROM streams WHERE guild_id = ? AND status = 'live' ORDER BY id DESC LIMIT 1`,
    )
    .get(guildId) as LiveStream | undefined;
  if (c.t === 'streamStart') {
    return keyed(
      `stream start`,
      c,
      idem,
      asReplay(() => s.stream.start(actor, { title: 'Run', idempotencyKey: idem })),
    );
  }
  if (!live) return {};
  const streamId = live.id;
  const round = s.store
    .stmt(
      `SELECT id, status, auto_lock_at FROM stream_rounds WHERE stream_id = ? AND status IN ('open', 'locked')`,
    )
    .get(streamId) as RoundRow | undefined;
  switch (c.t) {
    case 'streamTip': {
      // The transfer oracle: tips share the daily cap and the rules with transfers.
      s.economy.ensureMember(guildId, userId);
      const sentToday = w.transfers
        .filter(
          (t) => t.guildId === guildId && t.sender === userId && t.day === dayOf(w.clock.now()),
        )
        .reduce((sum, t) => sum + t.amount, 0);
      const expected =
        userId === live.streamer_id
          ? { ok: false as const, code: 'stream_self_tip' }
          : c.amount < 100
            ? { ok: false as const, code: 'stream_tip_min' }
            : expectedTransfer({
                sender: userId,
                receiver: live.streamer_id,
                amount: c.amount,
                games: w.gamesPlayed.get(`${guildId}:${userId}`) ?? 0,
                sentToday,
                debt: s.finance.teiai.getDebt(guildId, userId),
                balance: s.economy.getBalance(guildId, userId),
              });
      const body = { streamId, amount: c.amount, idempotencyKey: idem };
      const used = w.intentKeys.has(`${guildId}:${userId}:${idem}`);
      const refused = used ? null : refusal(() => s.stream.tip(actor, body));
      if (used) {
        return keyed(
          `stream tip ${streamId} ${c.amount}`,
          c,
          idem,
          asReplay(() => s.stream.tip(actor, body)),
        );
      }
      const want = expected.ok
        ? null
        : expected.code === 'debt_blocks'
          ? 'stream_debt'
          : expected.code;
      if (refused !== want) throw new Error(`tip refused with ${refused}; expected ${want}`);
      if (refused === null) {
        w.transfers.push({ guildId, sender: userId, day: dayOf(w.clock.now()), amount: c.amount });
        w.intentKeys.set(`${guildId}:${userId}:${idem}`, `stream tip ${streamId} ${c.amount}`);
        return {
          keyed: { describe: `stream tip`, run: asReplay(() => s.stream.tip(actor, body)) },
        };
      }
      return {};
    }
    case 'streamOpen':
      return keyed(
        `stream open ${streamId}`,
        c,
        idem,
        asReplay(() => s.stream.openRound(actor, { streamId, idempotencyKey: idem })),
      );
    case 'streamBet': {
      if (!round) return {};
      s.economy.ensureMember(guildId, userId);
      return keyed(
        `stream bet ${round.id} ${c.side} ${c.amount}`,
        c,
        idem,
        asReplay(() =>
          s.stream.bet(actor, {
            streamId,
            roundId: round.id,
            side: c.side,
            amount: c.amount,
            idempotencyKey: idem,
          }),
        ),
      );
    }
    case 'streamLock':
      if (!round) return {};
      return keyed(
        `stream lock ${round.id}`,
        c,
        idem,
        asReplay(() => s.stream.lock(actor, { streamId, roundId: round.id, idempotencyKey: idem })),
      );
    case 'streamSettle': {
      if (!round) return {};
      const open = round.status === 'open' && w.clock.now() < round.auto_lock_at;
      const before = ledgerCount(w);
      const settle = () =>
        s.stream.settle(actor, {
          streamId,
          roundId: round.id,
          winner: c.winner,
          idempotencyKey: idem,
        });
      if (open) {
        // Locked-only rule (D3-1): a settle on an open round changes nothing.
        const why = refusal(settle);
        if (why === null) throw new Error(`round ${round.id} settled while bets were open`);
        if (ledgerCount(w) !== before) throw new Error('a refused settle wrote ledger rows');
        return {};
      }
      return keyed(`stream settle ${round.id} ${c.winner}`, c, idem, asReplay(settle));
    }
    case 'streamVoid':
      if (!round) return {};
      if (c.owner) {
        refusal(() =>
          s.stream.ownerVoid({
            guildId,
            ownerId: OWNER,
            target: `round:${round.id}`,
            reason: 'check',
          }),
        );
        return {};
      }
      return keyed(
        `stream void ${round.id}`,
        c,
        idem,
        asReplay(() =>
          s.stream.voidRound(actor, { streamId, roundId: round.id, idempotencyKey: idem }),
        ),
      );
    case 'streamEnd':
      return keyed(
        `stream end ${streamId}`,
        c,
        idem,
        asReplay(() => s.stream.end(actor, { streamId, idempotencyKey: idem })),
      );
  }
}
