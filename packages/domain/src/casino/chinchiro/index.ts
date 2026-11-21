import type { Rng } from '@casino/shared';

export type ChinchiroKind = 'pinzoro' | 'arashi' | 'shigoro' | 'me' | 'menashi' | 'hifumi';
export type Dice = readonly [number, number, number];

export interface ChinchiroHand {
  kind: ChinchiroKind;
  /** Arashi: the repeated face. Me: the odd die. 0 for the others. */
  value: number;
}

export interface ChinchiroRoll {
  dice: Dice;
  hand: ChinchiroHand;
}

/** A participant rolls up to this many times, stopping on the first hand that scores. */
export const MAX_ROLLS = 3;
/** The winner's multiplier doubles when the loser holds hifumi. */
export const HIFUMI_FACTOR = 2;

export const ROLE_MULT: Readonly<Record<ChinchiroKind, number>> = {
  pinzoro: 5,
  arashi: 3,
  shigoro: 2,
  me: 1,
  menashi: 1,
  hifumi: 1,
};

export function classify(dice: Dice): ChinchiroHand {
  const [a, b, c] = [...dice].sort((x, y) => x - y) as [number, number, number];
  if (a === b && b === c)
    return a === 1 ? { kind: 'pinzoro', value: 0 } : { kind: 'arashi', value: a };
  if (a === 4 && b === 5 && c === 6) return { kind: 'shigoro', value: 0 };
  if (a === 1 && b === 2 && c === 3) return { kind: 'hifumi', value: 0 };
  if (a === b) return { kind: 'me', value: c };
  if (b === c) return { kind: 'me', value: a };
  return { kind: 'menashi', value: 0 };
}

export function strength(hand: ChinchiroHand): number {
  switch (hand.kind) {
    case 'pinzoro':
      return 100;
    case 'arashi':
      return 40 + hand.value;
    case 'shigoro':
      return 30;
    case 'me':
      return 10 + hand.value;
    case 'menashi':
      return 1;
    case 'hifumi':
      return 0;
  }
}

export function rollDice(rng: Rng): Dice {
  return [rng.int(1, 7), rng.int(1, 7), rng.int(1, 7)];
}

export function rollOnce(rng: Rng): ChinchiroRoll {
  const dice = rollDice(rng);
  return { dice, hand: classify(dice) };
}

/** Up to three rolls; stops as soon as one is not menashi. The last roll is the hand. */
export function playHand(rng: Rng): ChinchiroRoll[] {
  const rolls: ChinchiroRoll[] = [];
  for (let i = 0; i < MAX_ROLLS; i++) {
    const roll = rollOnce(rng);
    rolls.push(roll);
    if (roll.hand.kind !== 'menashi') break;
  }
  return rolls;
}

export type ChinchiroResult = 'win' | 'lose' | 'draw';
export interface ChinchiroOutcome {
  result: ChinchiroResult;
  multiplier: number;
}

/** Player against dealer. Menashi against menashi goes to the dealer (house edge). */
export function compare(player: ChinchiroHand, dealer: ChinchiroHand): ChinchiroOutcome {
  const p = strength(player);
  const d = strength(dealer);
  if (p === d) {
    return player.kind === 'menashi'
      ? { result: 'lose', multiplier: 1 }
      : { result: 'draw', multiplier: 0 };
  }
  if (p > d) {
    return {
      result: 'win',
      multiplier: ROLE_MULT[player.kind] * (dealer.kind === 'hifumi' ? HIFUMI_FACTOR : 1),
    };
  }
  return {
    result: 'lose',
    multiplier: ROLE_MULT[dealer.kind] * (player.kind === 'hifumi' ? HIFUMI_FACTOR : 1),
  };
}

/**
 * `payout` is credited (stake included); `penalty` is the extra owed on a multiplier loss
 * (`bet * (mult - 1)`), taken from cash and any shortfall becomes debt.
 */
export function payoutFor(
  outcome: ChinchiroOutcome,
  bet: number,
): { payout: number; penalty: number } {
  switch (outcome.result) {
    case 'win':
      return { payout: bet + bet * outcome.multiplier, penalty: 0 };
    case 'draw':
      return { payout: bet, penalty: 0 };
    case 'lose':
      return { payout: 0, penalty: bet * (outcome.multiplier - 1) };
  }
}

// ---- interactive solo round: the dealer rolls first, the player rolls one click at a time ----

export interface ChinchiroRound {
  bet: number;
  dealerRolls: ChinchiroRoll[];
  playerRolls: ChinchiroRoll[];
  status: 'player_turn' | 'settled';
}

export function startRound(rng: Rng, bet: number): ChinchiroRound {
  return { bet, dealerRolls: playHand(rng), playerRolls: [], status: 'player_turn' };
}

export function playerRoll(rng: Rng, round: ChinchiroRound): ChinchiroRound {
  if (round.status !== 'player_turn') throw new RangeError('round is settled');
  const roll = rollOnce(rng);
  const playerRolls = [...round.playerRolls, roll];
  const done = roll.hand.kind !== 'menashi' || playerRolls.length >= MAX_ROLLS;
  return { ...round, playerRolls, status: done ? 'settled' : 'player_turn' };
}

/** Time ran out or the client left: the last roll stands, or menashi if none (no dodging). */
export function forceSettle(round: ChinchiroRound): ChinchiroRound {
  return { ...round, status: 'settled' };
}

const MENASHI: ChinchiroHand = { kind: 'menashi', value: 0 };

export function playerHand(round: ChinchiroRound): ChinchiroHand {
  return round.playerRolls[round.playerRolls.length - 1]?.hand ?? MENASHI;
}

export function dealerHand(round: ChinchiroRound): ChinchiroHand {
  return round.dealerRolls[round.dealerRolls.length - 1]?.hand ?? MENASHI;
}

export function resolve(
  round: ChinchiroRound,
): ChinchiroOutcome & { payout: number; penalty: number } {
  const outcome = compare(playerHand(round), dealerHand(round));
  return { ...outcome, ...payoutFor(outcome, round.bet) };
}
