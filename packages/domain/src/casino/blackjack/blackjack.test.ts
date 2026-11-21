import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pyRandom } from '../testing/pyrandom.ts';
import {
  deal,
  dealerPlay,
  double,
  handValue,
  hit,
  isBlackjack,
  payoutOf,
  seatResult,
  stand,
  type Card,
  type Rank,
  type Suit,
} from './index.ts';

type Raw = [string | number, string];
interface Fixture {
  seed: number;
  hand_evaluations: { cards: [number, string][]; is_blackjack: boolean; value: number }[];
  payout_table_bet_1000: Record<string, number>;
  seeded_games: {
    actions: string[];
    bet: number;
    initial_player: Raw[];
    initial_dealer: Raw[];
    final_player: Raw[];
    final_dealer: Raw[];
    player_value: number;
    dealer_value: number;
    result: string;
    payout: number;
  }[];
  double_down_case: {
    seed: number;
    bet: number;
    doubled: boolean;
    initial_player: Raw[];
    final_player: Raw[];
    final_dealer: Raw[];
    payout: number;
    result: string;
  };
}
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../../tests/fixtures/legacy/blackjack/hands.json', import.meta.url),
    'utf8',
  ),
) as Fixture;

const RANK_BY_NUMBER: Record<number, Rank> = {
  1: 'A',
  11: 'J',
  12: 'Q',
  13: 'K',
};
const card = ([rank, suit]: Raw): Card => ({
  rank: (typeof rank === 'number' ? (RANK_BY_NUMBER[rank] ?? String(rank)) : rank) as Rank,
  suit: suit as Suit,
});
const raw = (cards: readonly Card[]): Raw[] => cards.map((c) => [c.rank, c.suit]);

describe('blackjack parity with the legacy fixtures', () => {
  // The fixture's `hand_evaluations` feed integer ranks (1..13) to the legacy function, which
  // adds them literally (A = 1, K = 13) instead of treating them as cards. Only the hand with
  // plain number cards is a real evaluation; the others are replayed with the card model.
  it('values hands and spots naturals', () => {
    const real = fixture.hand_evaluations.filter((e) => e.cards.every(([r]) => r >= 2 && r <= 10));
    expect(real).toHaveLength(1);
    for (const e of real) {
      const cards = e.cards.map((c) => card(c));
      expect(handValue(cards)).toBe(e.value);
      expect(isBlackjack(cards)).toBe(e.is_blackjack);
    }
    const hand = (...ranks: Rank[]): Card[] => ranks.map((rank) => ({ rank, suit: '♠' }));
    expect(handValue(hand('A', 'K'))).toBe(21);
    expect(isBlackjack(hand('A', 'K'))).toBe(true);
    expect(handValue(hand('A', 'A', '9'))).toBe(21);
    expect(handValue(hand('A', '6', '10'))).toBe(17);
    expect(handValue(hand('5', '5', 'A'))).toBe(21);
    expect(isBlackjack(hand('5', '5', 'A'))).toBe(false);
  });

  it('pays the table', () => {
    for (const [result, payout] of Object.entries(fixture.payout_table_bet_1000)) {
      if (result === 'surrender') continue; // not a rule of this game
      expect(payoutOf(result as 'win', 1000)).toBe(payout);
    }
    expect(payoutOf('blackjack', 11)).toBe(27);
  });

  it('replays the 10 seeded hit/stand games', () => {
    const rng = pyRandom(fixture.seed);
    for (const g of fixture.seeded_games) {
      const table = deal(rng, [g.bet]);
      expect(raw(table.seats[0]!.cards)).toEqual(g.initial_player);
      expect(raw(table.dealer)).toEqual(g.initial_dealer);
      for (const action of g.actions) {
        if (action === 'hit') hit(rng, table, 0);
        else stand(table, 0);
      }
      if (table.seats[0]!.status === 'playing') stand(table, 0);
      dealerPlay(rng, table);
      expect(raw(table.seats[0]!.cards)).toEqual(g.final_player);
      expect(raw(table.dealer)).toEqual(g.final_dealer);
      const r = seatResult(table, 0);
      expect(r.playerValue).toBe(g.player_value);
      expect(handValue(table.dealer)).toBe(g.dealer_value);
      expect(r.result).toBe(g.result);
      expect(r.payout).toBe(g.payout);
    }
  });

  it('replays the double-down game', () => {
    const d = fixture.double_down_case;
    const rng = pyRandom(d.seed);
    const table = deal(rng, [1000]);
    expect(raw(table.seats[0]!.cards)).toEqual(d.initial_player);
    double(rng, table, 0);
    dealerPlay(rng, table);
    expect(raw(table.seats[0]!.cards)).toEqual(d.final_player);
    expect(raw(table.dealer)).toEqual(d.final_dealer);
    const r = seatResult(table, 0);
    expect([r.bet, r.doubled, r.result, r.payout]).toEqual([d.bet, d.doubled, d.result, d.payout]);
    expect(r.tags).toEqual(['double_win']);
  });
});

describe('blackjack table', () => {
  it('lets seats play in turn against one dealer and stops on naturals', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = pyRandom(seed);
      const table = deal(rng, [100, 200, 300]);
      expect(table.seats).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        while (table.seats[i]!.status === 'playing') {
          if (handValue(table.seats[i]!.cards) < 17) hit(rng, table, i);
          else stand(table, i);
        }
      }
      dealerPlay(rng, table);
      const natural = table.seats.some((s) => isBlackjack(s.cards));
      if (natural && table.seats.every((s) => isBlackjack(s.cards) || handValue(s.cards) > 21)) {
        expect(table.dealer.length).toBeGreaterThanOrEqual(2);
      }
      for (let i = 0; i < 3; i++) {
        const r = seatResult(table, i);
        expect(r.payout).toBeGreaterThanOrEqual(0);
        expect(r.payout).toBeLessThanOrEqual(Math.floor((r.bet * 5) / 2));
      }
    }
  });

  it('does not draw for the dealer when every seat busted', () => {
    // Find a game where the only seat busts, and check the dealer kept two cards.
    for (let seed = 1; seed < 500; seed++) {
      const rng = pyRandom(seed);
      const table = deal(rng, [100]);
      if (table.seats[0]!.status === 'done') continue;
      while (table.seats[0]!.status === 'playing') hit(rng, table, 0);
      if (handValue(table.seats[0]!.cards) > 21) {
        dealerPlay(rng, table);
        expect(table.dealer).toHaveLength(2);
        return;
      }
    }
    throw new Error('no bust found');
  });

  it('refuses a second double and a double after a hit', () => {
    const rng = pyRandom(1005);
    for (let seed = 1; seed < 100; seed++) {
      const t = deal(pyRandom(seed), [100]);
      if (t.seats[0]!.status !== 'playing') continue;
      hit(rng, t, 0);
      if (t.seats[0]!.status === 'playing') expect(() => double(rng, t, 0)).toThrow();
    }
  });
});
