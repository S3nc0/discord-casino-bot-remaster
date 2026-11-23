import { CHINCHIRO_PROFILE, MIN_BET, chinchiroTable as tbl } from '@casino/domain/casino';
import type { chinchiro as chin } from '@casino/domain/casino';
import type { ErrorCode, TableSnapshot } from '@casino/shared';
import { AppError } from '../../runtime/errors.ts';
import type { RoundRow } from './core.ts';
import type { GameContext } from './context.ts';
import { evictIdleTables } from './tables.ts';
import type { Caller, SettlementSummary } from './types.ts';

/** How long the result stays on the table before it is free for the next lobby. */
export const CHINCHIRO_TABLE_RESULT_MS = 10_000;

type Phase = 'idle' | 'lobby' | 'playing' | 'result';

interface Seated {
  caller: Caller;
  row: RoundRow;
}

interface SeatOutcome {
  userId: string;
  roundId: string;
  rolls: chin.ChinchiroRoll[];
  result: chin.ChinchiroResult;
  multiplier: number;
  payout: number;
  penalty: number;
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
  dealerRolls: chin.ChinchiroRoll[] | null;
  outcomes: SeatOutcome[];
  /** Epoch ms the lobby starts by itself, or the reveal ends. */
  deadline: number | null;
  /** The last table ended without a seat (`誰も座らなかったので、卓をたたみました。`). */
  closedEmpty: boolean;
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

const REFUSAL: Record<tbl.TableRefusal, ErrorCode> = {
  started: 'conflict',
  already_sat: 'conflict',
  full: 'conflict',
  not_seated: 'conflict',
  host_only: 'forbidden',
  bet_mismatch: 'invalid_payload',
};

function refused(reason: tbl.TableRefusal): AppError {
  return new AppError(REFUSAL[reason], { message: reason });
}

/**
 * The shared chinchiro table of an Activity instance: the host opens a lobby with a bet, up to
 * six seat at that bet for a minute (the host may start early), then the dealer plays one hand
 * and every seat its own. Stakes are escrowed per seat when sitting and returned on standing;
 * the reveal is timed so players see the rolls before the money moves.
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
        if (table.phase === 'playing') throw new AppError('conflict');
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
          table.seated.push({ caller, row });
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
          seated: [{ caller, row }],
          dealerRolls: null,
          outcomes: [],
          deadline: lobby.deadline,
          closedEmpty: false,
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
        dealerRolls: null,
        outcomes: [],
        deadline: null,
        closedEmpty: false,
        cancel: null,
        touchedAt: this.ctx.clock.now(),
      };
      this.tables.set(key, table);
    }
    return table;
  }

  /** The lobby ends (timer or host): fold an empty table, otherwise deal. */
  private start(table: Table, tableRound: string): void {
    const { rng, clock, scheduler } = this.ctx;
    if (table.roundId !== tableRound || table.phase !== 'lobby' || table.lobby === null) return;
    table.cancel?.();
    table.cancel = null;
    const lobby = tbl.expire(table.lobby);
    if (tbl.isEmpty(lobby)) {
      Object.assign(table, {
        phase: 'idle',
        roundId: null,
        lobby: null,
        seated: [],
        deadline: null,
        closedEmpty: true,
      });
      this.push(table);
      return;
    }
    const round = tbl.playTable(
      rng,
      lobby.bet,
      table.seated.map((s) => s.caller.userId),
    );
    const steps =
      round.dealerRolls.length + round.seats.reduce((sum, s) => sum + s.rolls.length, 0);
    table.lobby = lobby;
    table.phase = 'playing';
    table.dealerRolls = round.dealerRolls;
    table.outcomes = round.seats.map((seat, i) => ({
      userId: seat.userId,
      roundId: (table.seated[i] as Seated).row.roundId,
      rolls: seat.rolls,
      result: seat.outcome.result,
      multiplier: seat.outcome.multiplier,
      payout: seat.payout,
      penalty: seat.penalty,
      settlement: null,
    }));
    const reveal = Math.max(1, steps) * tbl.TABLE_STEP_MS;
    table.deadline = clock.now() + reveal;
    this.push(table);
    table.cancel = scheduler.after(reveal, () => this.payOut(table, tableRound));
  }

  /** The reveal is over: settle every seat on its own; a failed seat gets its stake back. */
  private payOut(table: Table, tableRound: string): void {
    const { core, scheduler, logger } = this.ctx;
    if (table.roundId !== tableRound || table.phase !== 'playing') return;
    table.cancel = null;
    table.outcomes.forEach((outcome, i) => {
      const seat = table.seated[i] as Seated;
      try {
        outcome.settlement = core.settle(
          seat.row,
          { payout: outcome.payout, penalty: outcome.penalty, profile: CHINCHIRO_PROFILE },
          tableRound,
        );
      } catch (error) {
        logger.error({ err: error, roundId: seat.row.roundId }, 'chinchiro table settle failed');
        try {
          core.refund(seat.row, tableRound);
        } catch (refundError) {
          logger.error({ err: refundError, roundId: seat.row.roundId }, 'chinchiro refund failed');
        }
      }
    });
    table.phase = 'result';
    table.deadline = null;
    this.push(table);
    table.cancel = scheduler.after(CHINCHIRO_TABLE_RESULT_MS, () => {
      if (table.roundId !== tableRound || table.phase !== 'result') return;
      table.cancel = null;
      Object.assign(table, {
        phase: 'idle',
        roundId: null,
        lobby: null,
        seated: [],
        dealerRolls: null,
        outcomes: [],
      });
      this.push(table);
    });
  }

  private snap(table: Table): TableSnapshot {
    const showRolls = table.phase === 'playing' || table.phase === 'result';
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
        stepMs: tbl.TABLE_STEP_MS,
        deadline: table.deadline,
        closedEmpty: table.closedEmpty,
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
        ...(showRolls && table.dealerRolls !== null
          ? {
              dealerRolls: table.dealerRolls,
              hands: table.outcomes.map((o) => ({
                userId: o.userId,
                roundId: o.roundId,
                rolls: o.rolls,
              })),
            }
          : {}),
        ...(table.phase === 'result'
          ? {
              verdicts: table.outcomes.map((o) => ({
                userId: o.userId,
                result: o.result,
                multiplier: o.multiplier,
                payout: o.settlement?.payout ?? 0,
                net: o.settlement?.net ?? 0,
                settled: o.settlement !== null,
              })),
              won: tbl.tableWon(table.outcomes.map((o) => ({ outcome: { result: o.result } }))),
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
