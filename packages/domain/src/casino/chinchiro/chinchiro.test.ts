import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pyRandom } from '../testing/pyrandom.ts';
import {
  classify,
  compare,
  payoutFor,
  playHand,
  startRound,
  playerRoll,
  resolve,
} from './index.ts';
import type { Dice } from './index.ts';

interface Fixture {
  seed: number;
  classifications: { dice: Dice; hand: { kind: string; value: number } }[];
  matchups: {
    dealer_dice: Dice;
    player_dice: Dice;
    outcome: { multiplier: number; result: string };
    payout_bet_1000: [number, number];
  }[];
  seeded_rounds: {
    dealer_rolls: { dice: Dice; hand: { kind: string; value: number } }[];
    player_rolls: { dice: Dice; hand: { kind: string; value: number } }[];
    outcome: { multiplier: number; result: string };
    payout_bet_1000: [number, number];
  }[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../../tests/fixtures/legacy/chinchiro/hands.json', import.meta.url),
    'utf8',
  ),
) as Fixture;

describe('chinchiro parity with the legacy fixtures', () => {
  it('classifies every listed hand', () => {
    for (const c of fixture.classifications) expect(classify(c.dice)).toEqual(c.hand);
  });

  it('compares and pays every matchup', () => {
    for (const m of fixture.matchups) {
      const outcome = compare(classify(m.player_dice), classify(m.dealer_dice));
      expect(outcome).toEqual(m.outcome);
      const { payout, penalty } = payoutFor(outcome, 1000);
      expect([payout, penalty]).toEqual(m.payout_bet_1000);
    }
  });

  it('replays the 15 seeded rounds draw for draw', () => {
    const rng = pyRandom(fixture.seed);
    for (const round of fixture.seeded_rounds) {
      const player = playHand(rng);
      const dealer = playHand(rng);
      expect(player).toEqual(round.player_rolls.map((r) => ({ dice: r.dice, hand: r.hand })));
      expect(dealer).toEqual(round.dealer_rolls.map((r) => ({ dice: r.dice, hand: r.hand })));
      const outcome = compare(player.at(-1)!.hand, dealer.at(-1)!.hand);
      expect(outcome).toEqual(round.outcome);
      const { payout, penalty } = payoutFor(outcome, 1000);
      expect([payout, penalty]).toEqual(round.payout_bet_1000);
    }
  });
});

describe('chinchiro round', () => {
  it('stops rolling on a scoring hand or after three rolls, and settles', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rng = pyRandom(seed);
      let round = startRound(rng, 100);
      expect(round.dealerRolls.length).toBeGreaterThanOrEqual(1);
      expect(round.dealerRolls.length).toBeLessThanOrEqual(3);
      while (round.status === 'player_turn') round = playerRoll(rng, round);
      expect(round.playerRolls.length).toBeLessThanOrEqual(3);
      const r = resolve(round);
      expect(r.payout === 0 ? r.result === 'lose' : true).toBe(true);
    }
  });

  it('rejects a roll after settlement', () => {
    const rng = pyRandom(7);
    let round = startRound(rng, 10);
    while (round.status === 'player_turn') round = playerRoll(rng, round);
    expect(() => playerRoll(rng, round)).toThrow();
  });
});
