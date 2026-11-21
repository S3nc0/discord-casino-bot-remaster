import { BLACKJACK_PROFILE, MIN_BET, blackjack as bj } from '@casino/domain/casino';
import type { TableSnapshot } from '@casino/shared';
import { AppError } from '../../runtime/errors.ts';
import type { GameContext } from './context.ts';
import type { RoundRow } from './core.ts';
import type { Caller, SettlementSummary } from './types.ts';

export const BLACKJACK_SEATS = 5;
/** A shared table deals this long after its first bet (or earlier on `deal`). */
export const BLACKJACK_BETTING_MS = 15_000;
/** Time a seat has to act at a shared table; a solo game gets the legacy 90 s. */
export const BLACKJACK_TURN_MS = 30_000;
export const BLACKJACK_SOLO_TURN_MS = 90_000;
/** How long a finished table shows its result before it takes bets again. */
export const BLACKJACK_RESULT_MS = 8_000;

type Phase = 'betting' | 'player' | 'settled';

interface Seat {
  caller: Caller;
  row: RoundRow;
  settlement?: SettlementSummary;
}

interface State {
  id: string;
  shared: boolean;
  key: string;
  guildId: string;
  instanceId: string | null;
  phase: Phase;
  seats: Seat[];
  table: bj.BlackjackTable | null;
  /** Seat whose turn it is (-1 when nobody's). */
  turn: number;
  deadline: number | null;
  cancel: (() => void) | null;
  seq: number;
}

export interface BlackjackSeatView {
  index: number;
  userId: string;
  cards: bj.Card[];
  value: number;
  stake: number;
  doubled: boolean;
  status: 'playing' | 'done';
  result?: bj.BlackjackResult;
  payout?: number;
  settlement?: SettlementSummary;
}

export interface BlackjackView {
  /** Table round id; for a solo game it is also the ledger round id. */
  roundId: string;
  shared: boolean;
  phase: Phase;
  /** While a seat is still playing the second dealer card is hidden (null). */
  dealer: (bj.Card | null)[];
  dealerValue: number | null;
  seats: BlackjackSeatView[];
  turn: number;
  deadline: number | null;
}

export interface BlackjackActionParams {
  roundId: string;
  idempotencyKey?: string;
  /** `double` only: accept borrowing from Teiai for the missing cash. */
  credit?: boolean;
}

export class BlackjackService {
  private readonly ctx: GameContext;
  private readonly states = new Map<string, State>();
  /** Shared table of an instance → its current state id. */
  private readonly shared = new Map<string, string>();
  private readonly seqs = new Map<string, number>();

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  // ---- shared table ---------------------------------------------------------------------

  /** Take a seat with a stake. The first bet opens the betting window. */
  bet(caller: Caller, params: { stake: number; roundId?: string; idempotencyKey?: string }) {
    const { core, idem, clock, scheduler } = this.ctx;
    const instanceId = caller.instanceId;
    if (instanceId === undefined) throw new AppError('invalid_payload', { message: 'no table' });
    return idem.run(caller, params.idempotencyKey, 'game:bet:blackjack', params, () => {
      const key = `${caller.guildId}:${instanceId}`;
      let state = this.sharedState(key);
      if (state && state.phase === 'settled') state = undefined;
      if (state && state.phase !== 'betting') throw new AppError('conflict');
      if (params.roundId !== undefined && params.roundId !== (state?.id ?? null)) {
        throw new AppError('conflict');
      }
      if (state?.seats.some((s) => s.caller.userId === caller.userId))
        throw new AppError('conflict');
      if (state && state.seats.length >= BLACKJACK_SEATS) throw new AppError('game_busy');
      const fresh = state === undefined;
      const id = state?.id ?? core.newRoundId('bjt');
      const row = core.begin(caller, 'blackjack', params.stake, { owner: id, tableRound: id });
      if (!state) {
        state = {
          id,
          shared: true,
          key,
          guildId: caller.guildId,
          instanceId,
          phase: 'betting',
          seats: [],
          table: null,
          turn: -1,
          deadline: clock.now() + BLACKJACK_BETTING_MS,
          cancel: null,
          seq: this.seqs.get(key) ?? 0,
        };
        this.states.set(id, state);
        this.shared.set(key, id);
      }
      state.seats.push({ caller, row });
      if (fresh) {
        const target = state;
        target.cancel = scheduler.after(BLACKJACK_BETTING_MS, () =>
          this.guarded(target, () => this.dealNow(target)),
        );
      }
      this.push(state);
      return this.view(state);
    });
  }

  /** Any seated player can start the hand before the window closes. */
  deal(caller: Caller, params: BlackjackActionParams) {
    return this.ctx.idem.run(
      caller,
      params.idempotencyKey,
      'game:action:blackjack',
      { ...params, a: 'deal' },
      () => {
        const state = this.stateFor(caller, params.roundId);
        if (state.phase !== 'betting') throw new AppError('conflict');
        this.dealNow(state);
        return this.view(state);
      },
    );
  }

  // ---- solo (chat commands) ---------------------------------------------------------------

  /** A private table of one seat, dealt at once. */
  startSolo(caller: Caller, params: { stake: number; idempotencyKey?: string }) {
    const { core, idem } = this.ctx;
    return idem.run(
      caller,
      params.idempotencyKey,
      'game:bet:blackjack',
      { ...params, solo: true },
      () => {
        const row = core.begin(caller, 'blackjack', params.stake);
        const state: State = {
          id: row.roundId,
          shared: false,
          key: row.roundId,
          guildId: caller.guildId,
          instanceId: null,
          phase: 'betting',
          seats: [{ caller, row }],
          table: null,
          turn: -1,
          deadline: null,
          cancel: null,
          seq: 0,
        };
        this.states.set(state.id, state);
        this.dealNow(state);
        return this.view(state);
      },
    );
  }

  // ---- seat actions ------------------------------------------------------------------------

  hit(caller: Caller, params: BlackjackActionParams) {
    return this.act(caller, params, 'hit', (state, seat) =>
      bj.hit(this.ctx.rng, state.table!, seat),
    );
  }

  stand(caller: Caller, params: BlackjackActionParams) {
    return this.act(caller, params, 'stand', (state, seat) => bj.stand(state.table!, seat));
  }

  /** Double the stake, take one card, stand. Cash only unless `credit` lets Teiai lend. */
  double(caller: Caller, params: BlackjackActionParams) {
    return this.act(caller, params, 'double', (state, seat) => {
      const table = state.table!;
      if (!bj.canDouble(table, seat)) throw new AppError('conflict');
      const s = state.seats[seat]!;
      this.ctx.core.addStake(s.row, table.seats[seat]!.bet, {
        allowCredit: params.credit === true,
      });
      bj.double(this.ctx.rng, table, seat);
    });
  }

  /** The caller's open game or table, if any. */
  current(caller: Caller): BlackjackView | null {
    for (const state of this.states.values()) {
      if (
        state.guildId === caller.guildId &&
        state.seats.some((s) => s.caller.userId === caller.userId)
      ) {
        return this.view(state);
      }
    }
    return null;
  }

  /** Snapshot of the shared table of an instance (idle when nobody sits). */
  snapshot(guildId: string, instanceId: string): TableSnapshot {
    const state = this.sharedState(`${guildId}:${instanceId}`);
    return state ? this.snap(state) : this.idleSnapshot(guildId, instanceId);
  }

  // ---- internals ---------------------------------------------------------------------------

  private sharedState(key: string): State | undefined {
    const id = this.shared.get(key);
    return id === undefined ? undefined : this.states.get(id);
  }

  private stateFor(caller: Caller, roundId: string): State {
    const state = this.states.get(roundId);
    if (
      !state ||
      state.guildId !== caller.guildId ||
      !state.seats.some((s) => s.caller.userId === caller.userId)
    ) {
      throw new AppError('conflict');
    }
    return state;
  }

  private act(
    caller: Caller,
    params: BlackjackActionParams,
    action: string,
    apply: (state: State, seat: number) => void,
  ) {
    return this.ctx.idem.run(
      caller,
      params.idempotencyKey,
      'game:action:blackjack',
      { ...params, a: action },
      () => {
        const state = this.stateFor(caller, params.roundId);
        if (state.phase !== 'player' || !state.table) throw new AppError('conflict');
        const seat = state.seats.findIndex((s) => s.caller.userId === caller.userId);
        if (seat !== state.turn) throw new AppError('conflict');
        apply(state, seat);
        this.advance(state);
        return this.view(state);
      },
    );
  }

  private guarded(state: State, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.ctx.logger.error({ err: error, roundId: state.id }, 'blackjack timer failed');
      this.abort(state);
    }
  }

  private dealNow(state: State): void {
    state.cancel?.();
    state.cancel = null;
    state.table = bj.deal(
      this.ctx.rng,
      state.seats.map((s) => s.row.stake),
    );
    state.phase = 'player';
    this.advance(state);
  }

  /** Move to the next seat that can act, or let the dealer play and pay everyone. */
  private advance(state: State): void {
    const table = state.table!;
    state.cancel?.();
    state.cancel = null;
    const next = table.seats.findIndex((s) => s.status === 'playing');
    if (next < 0) {
      this.finish(state);
      return;
    }
    state.turn = next;
    const ms = state.shared ? BLACKJACK_TURN_MS : BLACKJACK_SOLO_TURN_MS;
    state.deadline = this.ctx.clock.now() + ms;
    state.cancel = this.ctx.scheduler.after(ms, () =>
      this.guarded(state, () => {
        if (state.phase !== 'player' || state.turn !== next) return;
        // Time is up: the seat stands.
        bj.stand(state.table!, next);
        this.advance(state);
      }),
    );
    this.push(state);
  }

  private finish(state: State): void {
    const table = state.table!;
    state.turn = -1;
    state.deadline = null;
    bj.dealerPlay(this.ctx.rng, table);
    state.phase = 'settled';
    try {
      state.seats.forEach((seat, i) => {
        const r = bj.seatResult(table, i);
        seat.settlement = this.ctx.core.settle(
          seat.row,
          { payout: r.payout, profile: BLACKJACK_PROFILE, tags: r.tags },
          state.id,
        );
      });
    } catch (error) {
      this.ctx.logger.error({ err: error, roundId: state.id }, 'blackjack settlement failed');
      this.abort(state);
      return;
    }
    this.push(state);
    if (state.shared) {
      state.cancel = this.ctx.scheduler.after(BLACKJACK_RESULT_MS, () => this.close(state));
    } else {
      this.states.delete(state.id);
    }
  }

  /** The result window is over: the table takes new bets. */
  private close(state: State): void {
    this.states.delete(state.id);
    if (this.shared.get(state.key) === state.id) this.shared.delete(state.key);
    this.seqs.set(state.key, state.seq + 1);
    if (state.instanceId !== null && !this.shared.has(state.key)) {
      this.ctx.broadcast(this.idleSnapshot(state.guildId, state.instanceId, state.seq + 1));
    }
  }

  /** Something broke mid-hand: every unsettled stake goes back. */
  private abort(state: State): void {
    state.cancel?.();
    for (const seat of state.seats) {
      try {
        // refund() checks the database: a seat that was already paid is left alone.
        this.ctx.core.refund(seat.row, state.id);
      } catch (error) {
        this.ctx.logger.error({ err: error, roundId: seat.row.roundId }, 'blackjack refund failed');
      }
    }
    state.phase = 'settled';
    this.close(state);
  }

  private view(state: State): BlackjackView {
    const table = state.table;
    const hidden = state.phase === 'player';
    const seats: BlackjackSeatView[] = state.seats.map((seat, index) => {
      const t = table?.seats[index];
      const settled = state.phase === 'settled' && t !== undefined && table !== null;
      const r = settled ? bj.seatResult(table, index) : undefined;
      return {
        index,
        userId: seat.caller.userId,
        cards: t?.cards ?? [],
        value: t ? bj.handValue(t.cards) : 0,
        stake: seat.row.stake,
        doubled: t?.doubled ?? false,
        status: t?.status ?? 'playing',
        ...(r ? { result: r.result, payout: r.payout } : {}),
        ...(seat.settlement ? { settlement: seat.settlement } : {}),
      };
    });
    return {
      roundId: state.id,
      shared: state.shared,
      phase: state.phase,
      dealer: table ? (hidden ? [table.dealer[0] ?? null, null] : [...table.dealer]) : [],
      dealerValue: table && !hidden ? bj.handValue(table.dealer) : null,
      seats,
      turn: state.turn,
      deadline: state.deadline,
    };
  }

  private snap(state: State): TableSnapshot {
    const seats = Array.from({ length: BLACKJACK_SEATS }, (_, index) => ({
      index,
      userId: state.seats[index]?.caller.userId ?? null,
    }));
    return {
      guildId: state.guildId,
      instanceId: state.instanceId ?? '',
      game: 'blackjack',
      seq: state.seq,
      roundId: state.id,
      phase: state.phase,
      seats,
      data: this.view(state),
    };
  }

  private idleSnapshot(guildId: string, instanceId: string, seq?: number): TableSnapshot {
    return {
      guildId,
      instanceId,
      game: 'blackjack',
      seq: seq ?? this.seqs.get(`${guildId}:${instanceId}`) ?? 0,
      roundId: null,
      phase: 'idle',
      seats: Array.from({ length: BLACKJACK_SEATS }, (_, index) => ({ index, userId: null })),
      data: { minBet: MIN_BET },
    };
  }

  private push(state: State): void {
    state.seq += 1;
    this.seqs.set(state.key, state.seq);
    if (state.shared && state.instanceId !== null) this.ctx.broadcast(this.snap(state));
  }
}
