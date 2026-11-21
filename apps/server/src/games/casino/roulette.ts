import { MIN_BET, adjustPayout, roulette as rl, type RtpLevel } from '@casino/domain/casino';
import type { TableSnapshot } from '@casino/shared';
import { AppError } from '../../runtime/errors.ts';
import type { GameContext } from './context.ts';
import type { RoundRow } from './core.ts';
import type { Caller, SettlementSummary } from './types.ts';

/** How long a shared table takes bets after the first one. */
export const ROULETTE_BETTING_MS = 20_000;
/** A finished spin stays on screen this long before the table takes bets again. */
export const ROULETTE_RESULT_MS = 6_000;
const HISTORY = 12;

type Phase = 'idle' | 'betting' | 'spinning' | 'result';

export interface RouletteLine {
  kind: rl.RouletteKind;
  number?: number;
  stake: number;
}

export interface RouletteBetInput {
  stake: number;
  /** One line per chip group, as in `BetIntent.bets` (`targets` holds the straight number). */
  bets?: { kind: string; targets: (number | string)[]; stake: number }[];
  /** Single-bet shortcut (chat): kind and, for `number`, the pocket. */
  kind?: string;
  number?: number;
  /** Shared table only: the round the client saw. */
  roundId?: string;
  idempotencyKey?: string;
}

interface Bettor {
  caller: Caller;
  row: RoundRow;
  lines: RouletteLine[];
  settlement?: SettlementSummary;
  winnings?: number;
}

interface Table {
  guildId: string;
  instanceId: string;
  seq: number;
  phase: Phase;
  roundId: string | null;
  bets: Bettor[];
  deadline: number | null;
  result: number | null;
  timeline: rl.SpinFrame[] | null;
  history: number[];
  cancel: (() => void) | null;
}

export interface RouletteSolo {
  roundId: string;
  result: number;
  color: rl.RouletteColor;
  win: boolean;
  timeline: rl.SpinFrame[];
  lines: RouletteLine[];
  settlement: SettlementSummary;
}

export interface RouletteBetAccepted {
  /** Shared table round: the one every bettor of this spin shares. */
  tableRound: string;
  /** This player's ledger round (one per accepted bet). */
  roundId: string;
  lines: RouletteLine[];
  deadline: number | null;
}

function parseLines(input: RouletteBetInput): RouletteLine[] {
  const raw = input.bets ?? [
    {
      kind: input.kind ?? '',
      targets: input.number === undefined ? [] : [input.number],
      stake: input.stake,
    },
  ];
  const lines: RouletteLine[] = raw.map((line) => {
    const target = line.targets[0];
    const bet = rl.validateBet({
      kind: line.kind,
      ...(typeof target === 'number' ? { number: target } : {}),
    });
    const ok =
      bet !== null &&
      line.targets.length === (bet.kind === 'number' ? 1 : 0) &&
      Number.isSafeInteger(line.stake) &&
      line.stake >= MIN_BET;
    if (!ok || bet === null) throw new AppError('invalid_payload', { message: 'bad roulette bet' });
    return {
      kind: bet.kind,
      ...(bet.number === undefined ? {} : { number: bet.number }),
      stake: line.stake,
    };
  });
  if (lines.reduce((sum, l) => sum + l.stake, 0) !== input.stake || lines.length === 0) {
    throw new AppError('invalid_payload', { message: 'stake must equal the sum of the lines' });
  }
  return lines;
}

const asBet = (line: RouletteLine): rl.RouletteBet => ({
  kind: line.kind,
  ...(line.number === undefined ? {} : { number: line.number }),
});

/** Gross payout of a set of lines, the RTP level applied line by line (each kind has its own `W`). */
function payLines(lines: RouletteLine[], result: number, level: number): number {
  let total = 0;
  for (const line of lines) {
    const gross = rl.payoutOf(asBet(line), line.stake, result);
    total += adjustPayout(rl.rouletteProfile(line.kind), level as RtpLevel, line.stake, gross);
  }
  return total;
}

export class RouletteService {
  private readonly ctx: GameContext;
  private readonly tables = new Map<string, Table>();

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  // ---- shared table: a betting window, then one spin for the room ------------------------

  placeBet(caller: Caller, input: RouletteBetInput) {
    const { core, idem, clock, scheduler } = this.ctx;
    const instanceId = caller.instanceId;
    if (instanceId === undefined) throw new AppError('invalid_payload', { message: 'no table' });
    return idem.run(
      caller,
      input.idempotencyKey,
      'game:bet:roulette',
      input,
      (): RouletteBetAccepted => {
        const lines = parseLines(input);
        const table = this.table(caller.guildId, instanceId);
        if (table.phase === 'spinning') throw new AppError('conflict');
        if (
          table.phase === 'betting' &&
          input.roundId !== undefined &&
          input.roundId !== table.roundId
        ) {
          throw new AppError('conflict');
        }
        if (table.phase !== 'betting' && input.roundId !== undefined)
          throw new AppError('conflict');
        const opening = table.phase !== 'betting';
        const tableRound = opening ? core.newRoundId('rlt') : (table.roundId as string);
        const row = core.begin(caller, 'roulette', input.stake, {
          owner: tableRound,
          tableRound,
          detail: lines,
        });
        if (opening) {
          table.cancel?.();
          Object.assign(table, {
            phase: 'betting',
            roundId: tableRound,
            bets: [],
            result: null,
            timeline: null,
            deadline: clock.now() + ROULETTE_BETTING_MS,
          });
          table.cancel = scheduler.after(ROULETTE_BETTING_MS, () => this.spin(table));
        }
        table.bets.push({ caller, row, lines });
        this.push(table);
        return { tableRound, roundId: row.roundId, lines, deadline: table.deadline };
      },
    );
  }

  snapshot(guildId: string, instanceId: string): TableSnapshot {
    return this.snap(this.table(guildId, instanceId));
  }

  // ---- solo (chat) ------------------------------------------------------------------------

  /** One bet, one spin, paid at once; no room involved. */
  playSolo(caller: Caller, input: RouletteBetInput) {
    const { core, idem, rng } = this.ctx;
    return idem.run(
      caller,
      input.idempotencyKey,
      'game:bet:roulette',
      { ...input, solo: true },
      (): RouletteSolo => {
        const lines = parseLines(input);
        const row = core.begin(caller, 'roulette', input.stake, { detail: lines });
        const result = rl.spin(rng);
        const timeline = rl.spinTimeline(rng, result);
        const payout = payLines(lines, result, core.rtpLevel(caller.guildId, 'roulette'));
        const settlement = core.settle(row, {
          payout,
          profile: rl.rouletteProfile('red'),
          rtpDone: true,
        });
        return {
          roundId: row.roundId,
          result,
          color: rl.colorOf(result),
          win: payout > 0,
          timeline,
          lines,
          settlement,
        };
      },
    );
  }

  // ---- internals ---------------------------------------------------------------------------

  private table(guildId: string, instanceId: string): Table {
    const key = `${guildId}:${instanceId}`;
    let table = this.tables.get(key);
    if (!table) {
      table = {
        guildId,
        instanceId,
        seq: 0,
        phase: 'idle',
        roundId: null,
        bets: [],
        deadline: null,
        result: null,
        timeline: null,
        history: [],
        cancel: null,
      };
      this.tables.set(key, table);
    }
    return table;
  }

  /** The window closed: one server spin, the timeline goes to the room, payment follows it. */
  private spin(table: Table): void {
    const { rng, clock, scheduler } = this.ctx;
    table.cancel = null;
    if (table.phase !== 'betting' || table.bets.length === 0) return;
    const result = rl.spin(rng);
    const timeline = rl.spinTimeline(rng, result);
    const duration = timeline[timeline.length - 1]?.atMs ?? 0;
    table.phase = 'spinning';
    table.result = result;
    table.timeline = timeline;
    table.deadline = clock.now() + duration;
    this.push(table);
    table.cancel = scheduler.after(duration, () => this.payOut(table));
  }

  private payOut(table: Table): void {
    const { core, scheduler, logger } = this.ctx;
    table.cancel = null;
    const result = table.result as number;
    const level = core.rtpLevel(table.guildId, 'roulette');
    for (const bettor of table.bets) {
      try {
        const payout = payLines(bettor.lines, result, level);
        bettor.winnings = payout;
        bettor.settlement = core.settle(
          bettor.row,
          { payout, profile: rl.rouletteProfile('red'), rtpDone: true },
          table.roundId as string,
        );
      } catch (error) {
        logger.error({ err: error, roundId: bettor.row.roundId }, 'roulette settlement failed');
        try {
          core.refund(bettor.row, table.roundId as string);
        } catch (refundError) {
          logger.error({ err: refundError, roundId: bettor.row.roundId }, 'roulette refund failed');
        }
      }
    }
    table.history = [result, ...table.history].slice(0, HISTORY);
    table.phase = 'result';
    table.deadline = null;
    this.push(table);
    table.cancel = scheduler.after(ROULETTE_RESULT_MS, () => {
      if (table.phase !== 'result') return;
      table.cancel = null;
      Object.assign(table, {
        phase: 'idle',
        roundId: null,
        bets: [],
        result: null,
        timeline: null,
      });
      this.push(table);
    });
  }

  private snap(table: Table): TableSnapshot {
    const bettors: string[] = [];
    for (const b of table.bets)
      if (!bettors.includes(b.caller.userId)) bettors.push(b.caller.userId);
    const showResult = table.phase === 'spinning' || table.phase === 'result';
    return {
      guildId: table.guildId,
      instanceId: table.instanceId,
      game: 'roulette',
      seq: table.seq,
      roundId: table.roundId,
      phase: table.phase,
      seats: bettors.map((userId, index) => ({ index, userId })),
      data: {
        deadline: table.deadline,
        minBet: MIN_BET,
        history: table.history,
        bets: table.bets.map((b) => ({
          userId: b.caller.userId,
          roundId: b.row.roundId,
          stake: b.row.stake,
          lines: b.lines,
        })),
        ...(showResult && table.result !== null
          ? { result: table.result, color: rl.colorOf(table.result), timeline: table.timeline }
          : {}),
        ...(table.phase === 'result'
          ? {
              payouts: table.bets.map((b) => ({
                userId: b.caller.userId,
                payout: b.settlement?.payout ?? 0,
                net: b.settlement?.net ?? 0,
              })),
            }
          : {}),
      },
    };
  }

  private push(table: Table): void {
    table.seq += 1;
    this.ctx.broadcast(this.snap(table));
  }
}
