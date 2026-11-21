import type { Rng } from '@casino/shared';
import {
  compare,
  payoutFor,
  playHand,
  type ChinchiroOutcome,
  type ChinchiroResult,
  type ChinchiroRoll,
} from './index.ts';

// The chinchiro lobby table: the host opens it with a bet, up to six players sit at that bet,
// and when the join window ends (or the host starts it early) the dealer plays one hand and
// every seat is dealt its own. Spec: docs/spec/chinchiro.md, "Multiplayer Table".

export const TABLE_JOIN_MS = 60_000;
export const TABLE_MAX_SEATS = 6;
/** Pause between the steps of the reveal, for clients that animate it. */
export const TABLE_STEP_MS = 900;

export type TableRefusal =
  | 'started' // もう始まっています。
  | 'already_sat' // もう座っています。
  | 'full' // 満席です（6人）。
  | 'not_seated' // 座っていないか、もう始まっています。
  | 'host_only' // 始められるのは、卓を立てた人だけです。
  | 'bet_mismatch';

export interface LobbyState {
  phase: 'lobby' | 'playing';
  hostId: string;
  /** What every seat stakes. */
  bet: number;
  /** Seated players in sitting order; the host sits first. */
  seats: readonly string[];
  /** Epoch ms when the lobby starts by itself. */
  deadline: number;
}

export type LobbyResult = { ok: true; state: LobbyState } | { ok: false; reason: TableRefusal };

const refuse = (reason: TableRefusal): LobbyResult => ({ ok: false, reason });

/** A new lobby with the host already seated. */
export function openLobby(hostId: string, bet: number, nowMs: number): LobbyState {
  return {
    phase: 'lobby',
    hostId,
    bet,
    seats: [hostId],
    deadline: nowMs + TABLE_JOIN_MS,
  };
}

export function sit(state: LobbyState, userId: string, bet: number): LobbyResult {
  if (state.phase !== 'lobby') return refuse('started');
  if (state.seats.includes(userId)) return refuse('already_sat');
  if (state.seats.length >= TABLE_MAX_SEATS) return refuse('full');
  if (bet !== state.bet) return refuse('bet_mismatch');
  return { ok: true, state: { ...state, seats: [...state.seats, userId] } };
}

/** Standing up before the start gives the stake back (the caller refunds). */
export function stand(state: LobbyState, userId: string): LobbyResult {
  if (state.phase !== 'lobby' || !state.seats.includes(userId)) return refuse('not_seated');
  return { ok: true, state: { ...state, seats: state.seats.filter((id) => id !== userId) } };
}

/** The host may start early; nobody else may. */
export function begin(state: LobbyState, userId: string): LobbyResult {
  if (state.phase !== 'lobby') return refuse('started');
  if (userId !== state.hostId) return refuse('host_only');
  return { ok: true, state: { ...state, phase: 'playing' } };
}

/** The window ran out: the lobby starts whoever is still seated. */
export function expire(state: LobbyState): LobbyState {
  return state.phase === 'lobby' ? { ...state, phase: 'playing' } : state;
}

export interface SeatResult {
  userId: string;
  rolls: ChinchiroRoll[];
  outcome: ChinchiroOutcome;
  payout: number;
  penalty: number;
}

export interface TableRound {
  dealerRolls: ChinchiroRoll[];
  seats: SeatResult[];
}

/** No seats at the start: the table is folded (`誰も座らなかったので、卓をたたみました。`). */
export function isEmpty(state: LobbyState): boolean {
  return state.seats.length === 0;
}

/** The dealer plays one hand, then each seat in order plays its own and is compared to it. */
export function playTable(rng: Rng, bet: number, seats: readonly string[]): TableRound {
  const dealerRolls = playHand(rng);
  const dealer = (dealerRolls[dealerRolls.length - 1] as ChinchiroRoll).hand;
  return {
    dealerRolls,
    seats: seats.map((userId) => {
      const rolls = playHand(rng);
      const outcome = compare((rolls[rolls.length - 1] as ChinchiroRoll).hand, dealer);
      return { userId, rolls, outcome, ...payoutFor(outcome, bet) };
    }),
  };
}

/** The result card is green when at least half of the seats won. */
export function tableWon(results: readonly { outcome: { result: ChinchiroResult } }[]): boolean {
  const wins = results.filter((r) => r.outcome.result === 'win').length;
  return wins * 2 >= results.length;
}
