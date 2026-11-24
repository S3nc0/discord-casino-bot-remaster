import type { Rng } from '@casino/shared';
import { playHand, strength, type ChinchiroHand, type ChinchiroRoll } from './index.ts';

// The chinchiro table: the host opens it with a bet, two to six players sit at that bet, and
// when the join window ends (or the host starts it early) everyone rolls their own hand. The
// strongest hand takes the losers' stakes minus the table fee (winner takes all, ties split).
// Spec: docs/spec/chinchiro.md, "Multiplayer Table".

export const TABLE_JOIN_MS = 60_000;
export const TABLE_MIN_SEATS = 2;
export const TABLE_MAX_SEATS = 6;
/** How long the seats have to roll; whoever has not rolled by then is rolled automatically. */
export const TABLE_ROLL_MS = 45_000;
/** The table fee: 10 % of the losers' stakes, in basis points. */
export const TABLE_RAKE_BPS = 1000;
/** Pause between two rolls of one hand, for clients that animate it. */
export const TABLE_STEP_MS = 900;

export type TableRefusal =
  | 'started' // もう始まっています。
  | 'already_sat' // もう座っています。
  | 'full' // 満席です（6人）。
  | 'not_seated' // 座っていないか、もう始まっています。
  | 'host_only' // 始められるのは、卓を立てた人だけです。
  | 'bet_mismatch'
  | 'not_at_table' // この卓に座っていません。
  | 'finished' // もう決着しています。
  | 'not_started' // まだ始まっていません。
  | 'already_rolled'; // もう振りました。

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

/**
 * Fewer than two seats at the start: the table folds and every stake is refunded
 * (`2人そろわなかったので、卓をたたみました（賭け金は全額返しました）。`).
 */
export function tooFew(state: LobbyState): boolean {
  return state.seats.length < TABLE_MIN_SEATS;
}

/** Where a table is, as far as one seat's roll is concerned. */
export interface RollCheck {
  phase: 'lobby' | 'rolling' | 'finished';
  seats: readonly string[];
  rolled: readonly string[];
}

/** Why `userId` may not roll now, or `null` when they may. The order is the legacy one. */
export function rollRefusal(state: RollCheck, userId: string): TableRefusal | null {
  if (!state.seats.includes(userId)) return 'not_at_table';
  if (state.phase === 'finished') return 'finished';
  if (state.phase === 'lobby') return 'not_started';
  if (state.rolled.includes(userId)) return 'already_rolled';
  return null;
}

/** One press plays the whole hand: up to three rolls until a hand forms (as solo). */
export function rollSeat(rng: Rng): ChinchiroRoll[] {
  return playHand(rng);
}

export interface PotResult {
  /** Per seat, in seat order: what is paid back from the escrow (own stake included; 0 on a loss). */
  payouts: number[];
  /** Per seat: holds the strongest hand. */
  winners: boolean[];
  /** Kept by the table: `bet × seats − Σ payouts` (the fee plus the division leftover). */
  rake: number;
}

/**
 * Winner takes all. The strongest hand (or every hand tied for it) shares the losers' stakes
 * minus the fee: `share = floor(bet × losers × 9/10) // winners`; a winner gets `bet + share`,
 * a loser 0. When every hand is equal, everyone gets the bet back. Hifumi pays no double here:
 * it is simply the weakest hand. Integer form of the legacy `int(bet*losers*0.9)//len(winners)`.
 */
export function potPayouts(hands: readonly ChinchiroHand[], bet: number): PotResult {
  if (hands.length === 0) return { payouts: [], winners: [], rake: 0 };
  const strengths = hands.map(strength);
  const best = Math.max(...strengths);
  const winners = strengths.map((s) => s === best);
  const winnerCount = winners.filter(Boolean).length;
  const losers = hands.length - winnerCount;
  const pot = Math.floor((bet * losers * (10_000 - TABLE_RAKE_BPS)) / 10_000);
  const share = Math.floor(pot / winnerCount);
  const payouts = winners.map((w) => (w ? bet + share : 0));
  const rake = bet * hands.length - payouts.reduce((sum, p) => sum + p, 0);
  return { payouts, winners, rake };
}

/** Seat indexes for the result list: strongest first, ties in seat order. */
export function resultOrder(hands: readonly ChinchiroHand[]): number[] {
  const strengths = hands.map(strength);
  return hands
    .map((_, i) => i)
    .sort((a, b) => (strengths[b] as number) - (strengths[a] as number) || a - b);
}
