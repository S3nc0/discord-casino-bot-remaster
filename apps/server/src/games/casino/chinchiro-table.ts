import { CHINCHIRO_PROFILE, MIN_BET, chinchiroTable as tbl } from '@casino/domain/casino';
import type { chinchiro as chin } from '@casino/domain/casino';
import type { ErrorCode, TableSnapshot } from '@casino/shared';
import { AppError } from '../../runtime/errors.ts';
import { GameRuleError } from '../progression/context.ts';
import type { RoundRow } from './core.ts';
import type { GameContext } from './context.ts';
import { evictIdleTables } from './tables.ts';
import type { Caller, SettlementSummary } from './types.ts';

/** How long the result stays on the table before it is free for the next lobby. */
export const CHINCHIRO_TABLE_RESULT_MS = 10_000;

type Phase = 'idle' | 'lobby' | 'rolling' | 'result';

interface Seated {
  caller: Caller;
  row: RoundRow;
  /** The seat's whole hand once it rolled (by the button or automatically). */
  rolls: chin.ChinchiroRoll[] | null;
}

interface SeatResult {
  userId: string;
  isWinner: boolean;
  payout: number;
  settlement: SettlementSummary | null;
}

interface Table {
  guildId: string;
  instanceId: string;
  seq: number;
  phase: Phase;
  /** The shared round id: the table's own, owner of every seat's session lock. */
  roundId: string | null;
  lobby: tbl.LobbyState | null;
  seated: Seated[];
  /** Result phase: strongest hand first. */
  results: SeatResult[];
  rake: number;
  /** Settling failed and every stake was returned instead. */
  refunded: boolean;
  /** Epoch ms the lobby starts by itself, or the seats left are rolled automatically. */
  deadline: number | null;
  /** The last table folded with fewer than two seats (everyone refunded). */
  folded: boolean;
  cancel: (() => void) | null;
  /** Epoch ms of the last change, for idle eviction. */
  touchedAt: number;
}

export interface TableSeatAccepted {
  tableRound: string;
  roundId: string;
  host: boolean;
  deadline: number | null;
}

export interface TableStandAccepted {
  tableRound: string;
  refunded: number;
}

export interface TableBeginAccepted {
  tableRound: string;
  seats: number;
}

export interface TableRollAccepted {
  tableRound: string;
  rolls: chin.ChinchiroRoll[];
  /** The last seat rolled, so the table settled. */
  finished: boolean;
}

const REFUSAL: Record<tbl.TableRefusal, ErrorCode> = {
  started: 'conflict',
  already_sat: 'conflict',
  full: 'conflict',
  not_seated: 'conflict',
  host_only: 'forbidden',
  bet_mismatch: 'invalid_payload',
  not_at_table: 'forbidden',
  finished: 'conflict',
  not_started: 'conflict',
  already_rolled: 'conflict',
};

function refused(reason: tbl.TableRefusal): AppError {
  return new AppError(REFUSAL[reason], { message: reason });
}

/** A roll refusal: the chat bot shows `bot.rule.chinchiro_table_<reason>`. */
function rollRefused(reason: tbl.TableRefusal): AppError {
  return new GameRuleError(`chinchiro_table_${reason}`, {}, REFUSAL[reason]);
}

/**
 * The shared chinchiro table of an Activity instance (or a chat channel): the host opens a
 * lobby with a bet, two to six seat at that bet for a minute (the host may start early), then
 * every seat rolls its own hand within 45 seconds and the strongest hand takes the pot (the
 * losers' stakes minus the 10 % fee; ties split). Stakes are escrowed per seat when sitting and
 * returned on standing or when the table folds. The whole table settles in one transaction.
 */
export class ChinchiroTableService {
  private readonly ctx: GameContext;
  private readonly tables = new Map<string, Table>();

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  /** Tables held in memory (idle ones of past instances are evicted). */
  tableCount(): number {
    return this.tables.size;
  }

  snapshot(guildId: string, instanceId: string): TableSnapshot {
    return this.snap(this.table(guildId, instanceId));
  }

  /** Open a lobby (when none is running) or sit at the running one. */
  sit(caller: Caller, input: { stake: number; roundId?: string; idempotencyKey?: string }) {
    const { core, idem, clock, scheduler } = this.ctx;
    const instanceId = this.instanceOf(caller);
    return idem.run(
      caller,
      input.idempotencyKey,
      'game:bet:chinchiro-table',
      { stake: input.stake, roundId: input.roundId },
      (): TableSeatAccepted => {
        const table = this.table(caller.guildId, instanceId);
        if (table.phase === 'rolling') throw refused('started');
        const joining = table.phase === 'lobby' && table.lobby !== null;
        if (joining) {
          if (input.roundId !== undefined && input.roundId !== table.roundId) {
            throw new AppError('conflict');
          }
          const next = tbl.sit(table.lobby as tbl.LobbyState, caller.userId, input.stake);
          if (!next.ok) throw refused(next.reason);
          const row = core.begin(caller, 'chinchiro', input.stake, {
            owner: table.roundId as string,
            tableRound: table.roundId as string,
          });
          table.lobby = next.state;
          table.seated.push({ caller, row, rolls: null });
          this.push(table);
          return {
            tableRound: table.roundId as string,
            roundId: row.roundId,
            host: false,
            deadline: table.deadline,
          };
        }
        if (input.roundId !== undefined) throw new AppError('conflict');
        core.check(caller, 'chinchiro', input.stake);
        const tableRound = core.newRoundId('cht');
        const row = core.begin(caller, 'chinchiro', input.stake, {
          owner: tableRound,
          tableRound,
        });
        table.cancel?.();
        const lobby = tbl.openLobby(caller.userId, input.stake, clock.now());
        Object.assign(table, {
          phase: 'lobby',
          roundId: tableRound,
          lobby,
          seated: [{ caller, row, rolls: null }],
          results: [],
          rake: 0,
          refunded: false,
          deadline: lobby.deadline,
          folded: false,
        });
        table.cancel = scheduler.after(tbl.TABLE_JOIN_MS, () => this.start(table, tableRound));
        this.push(table);
        return { tableRound, roundId: row.roundId, host: true, deadline: lobby.deadline };
      },
    );
  }

  /** Leave the lobby before it starts; the stake comes back in full. */
  stand(caller: Caller, input: { roundId: string; idempotencyKey?: string }) {
    const { core, idem } = this.ctx;
    const instanceId = this.instanceOf(caller);
    return idem.run(
      caller,
      input.idempotencyKey,
      'game:action:chinchiro-table:stand',
      { roundId: input.roundId },
      (): TableStandAccepted => {
        const table = this.table(caller.guildId, instanceId);
        if (table.roundId !== input.roundId || table.lobby === null) throw new AppError('conflict');
        const next = tbl.stand(table.lobby, caller.userId);
        if (!next.ok) throw refused(next.reason);
        const seat = table.seated.find((s) => s.caller.userId === caller.userId) as Seated;
        core.refund(seat.row, table.roundId as string);
        table.lobby = next.state;
        table.seated = table.seated.filter((s) => s !== seat);
        this.push(table);
        return { tableRound: input.roundId, refunded: seat.row.stake };
      },
    );
  }

  /** The host starts the table before the minute is up. */
  begin(caller: Caller, input: { roundId: string; idempotencyKey?: string }) {
    const { idem } = this.ctx;
    const instanceId = this.instanceOf(caller);
    return idem.run(
      caller,
      input.idempotencyKey,
      'game:action:chinchiro-table:begin',
      { roundId: input.roundId },
      (): TableBeginAccepted => {
        const table = this.table(caller.guildId, instanceId);
        if (table.roundId !== input.roundId || table.lobby === null) throw new AppError('conflict');
        const next = tbl.begin(table.lobby, caller.userId);
        if (!next.ok) throw refused(next.reason);
        const seats = table.seated.length;
        this.start(table, input.roundId);
        return { tableRound: input.roundId, seats };
      },
    );
  }

  /**
   * A seated player rolls: one press plays the whole hand (up to three rolls until a hand
   * forms). When the last seat has rolled, the table settles at once.
   */
  roll(caller: Caller, input: { roundId: string; idempotencyKey?: string }) {
    const { idem, rng } = this.ctx;
    const instanceId = this.instanceOf(caller);
    return idem.run(
      caller,
      input.idempotencyKey,
      'game:action:chinchiro-table:roll',
      { roundId: input.roundId },
      (): TableRollAccepted => {
        const table = this.table(caller.guildId, instanceId);
        if (table.roundId !== input.roundId) throw rollRefused('finished');
        const reason = tbl.rollRefusal(
          {
            phase:
              table.phase === 'lobby'
                ? 'lobby'
                : table.phase === 'rolling'
                  ? 'rolling'
                  : 'finished',
            seats: table.seated.map((s) => s.caller.userId),
            rolled: table.seated.filter((s) => s.rolls !== null).map((s) => s.caller.userId),
          },
          caller.userId,
        );
        if (reason !== null) throw rollRefused(reason);
        const seat = table.seated.find((s) => s.caller.userId === caller.userId) as Seated;
        seat.rolls = tbl.rollSeat(rng);
        const finished = table.seated.every((s) => s.rolls !== null);
        if (finished) this.finish(table, input.roundId);
        else this.push(table);
        return { tableRound: input.roundId, rolls: seat.rolls, finished };
      },
    );
  }

  // ---- internals ---------------------------------------------------------------------------

  private instanceOf(caller: Caller): string {
    if (caller.instanceId === undefined) {
      throw new AppError('invalid_payload', { message: 'no table' });
    }
    return caller.instanceId;
  }

  private table(guildId: string, instanceId: string): Table {
    const key = `${guildId}:${instanceId}`;
    let table = this.tables.get(key);
    if (!table) {
      evictIdleTables(this.tables, this.ctx.clock.now());
      table = {
        guildId,
        instanceId,
        seq: 0,
        phase: 'idle',
        roundId: null,
        lobby: null,
        seated: [],
        results: [],
        rake: 0,
        refunded: false,
        deadline: null,
        folded: false,
        cancel: null,
        touchedAt: this.ctx.clock.now(),
      };
      this.tables.set(key, table);
    }
    return table;
  }

  /** Every open seat gets its stake back, all in one transaction. */
  private refundAll(table: Table, tableRound: string): void {
    const { core } = this.ctx;
    core.store.transaction(() => {
      for (const seat of table.seated) core.refund(seat.row, tableRound);
    });
  }

  /** The lobby ends (timer or host): fold a table of fewer than two, otherwise start rolling. */
  private start(table: Table, tableRound: string): void {
    const { clock, scheduler, logger } = this.ctx;
    if (table.roundId !== tableRound || table.phase !== 'lobby' || table.lobby === null) return;
    table.cancel?.();
    table.cancel = null;
    const lobby = tbl.expire(table.lobby);
    if (tbl.tooFew(lobby)) {
      try {
        this.refundAll(table, tableRound);
      } catch (error) {
        // the rounds stay open; recovery at the next start refunds them
        logger.error({ err: error, tableRound }, 'chinchiro table fold refund failed');
      }
      Object.assign(table, {
        phase: 'idle',
        roundId: null,
        lobby: null,
        seated: [],
        deadline: null,
        folded: true,
      });
      this.push(table);
      return;
    }
    table.lobby = lobby;
    table.phase = 'rolling';
    table.deadline = clock.now() + tbl.TABLE_ROLL_MS;
    table.cancel = scheduler.after(tbl.TABLE_ROLL_MS, () => this.finish(table, tableRound));
    this.push(table);
  }

  /**
   * Everyone has rolled, or the roll window ran out (the seats left are rolled now): settle the
   * pot. All seats settle in one transaction; if any fails, nothing is paid and every stake is
   * returned instead. Never twice for one table round.
   */
  private finish(table: Table, tableRound: string): void {
    const { core, rng, scheduler, logger } = this.ctx;
    if (table.roundId !== tableRound || table.phase !== 'rolling' || table.lobby === null) return;
    table.cancel?.();
    table.cancel = null;
    table.phase = 'result';
    table.deadline = null;
    for (const seat of table.seated) seat.rolls ??= tbl.rollSeat(rng);
    const hands = table.seated.map((s) => (s.rolls?.at(-1) as chin.ChinchiroRoll).hand);
    const pot = tbl.potPayouts(hands, table.lobby.bet);
    const order = tbl.resultOrder(hands);
    try {
      const settlements = core.store.transaction(() =>
        table.seated.map((seat, i) =>
          core.settle(
            seat.row,
            { payout: pot.payouts[i] as number, profile: CHINCHIRO_PROFILE, rtpDone: true },
            tableRound,
          ),
        ),
      );
      table.results = order.map((i) => ({
        userId: (table.seated[i] as Seated).caller.userId,
        isWinner: pot.winners[i] as boolean,
        payout: pot.payouts[i] as number,
        settlement: settlements[i] as SettlementSummary,
      }));
      table.rake = pot.rake;
      table.refunded = false;
    } catch (error) {
      logger.error({ err: error, tableRound }, 'chinchiro table settle failed');
      try {
        this.refundAll(table, tableRound);
      } catch (refundError) {
        logger.error({ err: refundError, tableRound }, 'chinchiro table refund failed');
      }
      table.results = order.map((i) => ({
        userId: (table.seated[i] as Seated).caller.userId,
        isWinner: pot.winners[i] as boolean,
        payout: 0,
        settlement: null,
      }));
      table.rake = 0;
      table.refunded = true;
    }
    this.push(table);
    table.cancel = scheduler.after(CHINCHIRO_TABLE_RESULT_MS, () => {
      if (table.roundId !== tableRound || table.phase !== 'result') return;
      table.cancel = null;
      Object.assign(table, {
        phase: 'idle',
        roundId: null,
        lobby: null,
        seated: [],
        results: [],
        rake: 0,
        refunded: false,
      });
      this.push(table);
    });
  }

  private snap(table: Table): TableSnapshot {
    const showHands = table.phase === 'rolling' || table.phase === 'result';
    const seats = Array.from({ length: tbl.TABLE_MAX_SEATS }, (_, index) => ({
      index,
      userId: table.seated[index]?.caller.userId ?? null,
    }));
    return {
      guildId: table.guildId,
      instanceId: table.instanceId,
      game: 'chinchiro',
      seq: table.seq,
      roundId: table.roundId,
      phase: table.phase,
      seats,
      data: {
        minBet: MIN_BET,
        minSeats: tbl.TABLE_MIN_SEATS,
        rakeBps: tbl.TABLE_RAKE_BPS,
        stepMs: tbl.TABLE_STEP_MS,
        deadline: table.deadline,
        folded: table.folded,
        ...(table.lobby === null
          ? {}
          : {
              hostId: table.lobby.hostId,
              bet: table.lobby.bet,
              seatRounds: table.seated.map((s) => ({
                userId: s.caller.userId,
                roundId: s.row.roundId,
              })),
            }),
        ...(showHands
          ? {
              hands: table.seated.map((s) => ({
                userId: s.caller.userId,
                roundId: s.row.roundId,
                rolled: s.rolls !== null,
                rolls: s.rolls ?? [],
              })),
            }
          : {}),
        ...(table.phase === 'result'
          ? {
              results: table.results.map((r) => ({
                userId: r.userId,
                isWinner: r.isWinner,
                payout: r.settlement?.payout ?? 0,
                net: r.settlement?.net ?? 0,
                settled: r.settlement !== null,
              })),
              rake: table.rake,
              refunded: table.refunded,
            }
          : {}),
      },
    };
  }

  private push(table: Table): void {
    table.seq += 1;
    table.touchedAt = this.ctx.clock.now();
    this.ctx.broadcast(this.snap(table));
  }
}
