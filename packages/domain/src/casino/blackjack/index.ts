import { shuffle, type Rng } from '@casino/shared';

export const SUITS = ['♠', '♥', '♦', '♣'] as const;
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

export type BlackjackResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

export function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

export function shuffledDeck(rng: Rng): Card[] {
  return shuffle(rng, newDeck());
}

function cardValue(rank: Rank): number {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

/** Aces count 11 and drop to 1 one at a time while the hand is over 21. */
export function handValue(cards: readonly Card[]): number {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card.rank);
    if (card.rank === 'A') aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export function isBlackjack(cards: readonly Card[]): boolean {
  return cards.length === 2 && handValue(cards) === 21;
}

/** The dealer stands on every 17, soft ones included. */
export const DEALER_STANDS_ON = 17;

/** Result of one hand against the dealer, in the legacy priority order. */
export function resultOf(player: readonly Card[], dealer: readonly Card[]): BlackjackResult {
  if (isBlackjack(player)) return isBlackjack(dealer) ? 'push' : 'blackjack';
  if (isBlackjack(dealer)) return 'lose';
  const p = handValue(player);
  if (p > 21) return 'bust';
  const d = handValue(dealer);
  if (d > 21 || p > d) return 'win';
  return p === d ? 'push' : 'lose';
}

/** Gross payout for the whole escrow (a double included). Natural pays 3:2, floored. */
export function payoutOf(result: BlackjackResult, bet: number): number {
  switch (result) {
    case 'blackjack':
      return Math.floor((bet * 5) / 2);
    case 'win':
      return bet * 2;
    case 'push':
      return bet;
    default:
      return 0;
  }
}

/** Mission tags the round earns. */
export function tagsOf(result: BlackjackResult, doubled: boolean): string[] {
  const tags: string[] = [];
  if (result === 'blackjack') tags.push('natural');
  if ((result === 'win' || result === 'blackjack') && doubled) tags.push('double_win');
  return tags;
}

// ---- a table of seats against one dealer (a solo game is a table of one seat) ----

export interface BlackjackSeat {
  cards: Card[];
  /** Escrow of this seat (doubled when `doubled`). */
  bet: number;
  doubled: boolean;
  /** `playing` until the seat stands, busts, hits 21 or has a natural. */
  status: 'playing' | 'done';
}

export interface BlackjackTable {
  deck: Card[];
  dealer: Card[];
  seats: BlackjackSeat[];
  dealerDone: boolean;
}

function draw(rng: Rng, deck: Card[]): Card {
  // A fresh deck is added only if a long table ran the first one dry.
  if (deck.length === 0) deck.push(...shuffledDeck(rng));
  return deck.pop() as Card;
}

/**
 * Deal: every seat gets two cards (in seat order), then the dealer two. A seat with a natural,
 * or any seat when the dealer has one, is done at once.
 */
export function deal(rng: Rng, bets: readonly number[]): BlackjackTable {
  const deck = shuffledDeck(rng);
  const seats: BlackjackSeat[] = bets.map((bet) => ({
    cards: [],
    bet,
    doubled: false,
    status: 'playing',
  }));
  // Legacy deals player = [pop(), pop()] then dealer = [pop(), pop()]; for several seats each
  // takes its pair in order.
  for (const seat of seats) seat.cards.push(draw(rng, deck), draw(rng, deck));
  const dealer = [draw(rng, deck), draw(rng, deck)];
  const dealerNatural = isBlackjack(dealer);
  for (const seat of seats) {
    if (dealerNatural || isBlackjack(seat.cards)) seat.status = 'done';
  }
  return { deck, dealer, seats, dealerDone: false };
}

export function canAct(table: BlackjackTable, seat: number): boolean {
  return !table.dealerDone && table.seats[seat]?.status === 'playing';
}

export function canDouble(table: BlackjackTable, seat: number): boolean {
  const s = table.seats[seat];
  return canAct(table, seat) && s !== undefined && s.cards.length === 2 && !s.doubled;
}

/** Hit: one card; 21 or more ends the seat's turn. */
export function hit(rng: Rng, table: BlackjackTable, seat: number): void {
  const s = table.seats[seat];
  if (!s || !canAct(table, seat)) throw new RangeError('seat cannot act');
  s.cards.push(draw(rng, table.deck));
  if (handValue(s.cards) >= 21) s.status = 'done';
}

export function stand(table: BlackjackTable, seat: number): void {
  const s = table.seats[seat];
  if (!s || !canAct(table, seat)) throw new RangeError('seat cannot act');
  s.status = 'done';
}

/** Double: first two cards only; the server has already added the extra stake to escrow. */
export function double(rng: Rng, table: BlackjackTable, seat: number): void {
  const s = table.seats[seat];
  if (!s || !canDouble(table, seat)) throw new RangeError('seat cannot double');
  s.bet *= 2;
  s.doubled = true;
  s.cards.push(draw(rng, table.deck));
  s.status = 'done';
}

export function allSeatsDone(table: BlackjackTable): boolean {
  return table.seats.every((s) => s.status === 'done');
}

/**
 * The dealer draws to 17 unless nobody is left to beat (every seat busted or the dealer or a
 * seat has a natural that decides the hand without a draw).
 */
export function dealerPlay(rng: Rng, table: BlackjackTable): void {
  if (table.dealerDone) return;
  const live = table.seats.some((s) => !isBlackjack(s.cards) && handValue(s.cards) <= 21);
  if (live) {
    while (handValue(table.dealer) < DEALER_STANDS_ON) table.dealer.push(draw(rng, table.deck));
  }
  table.dealerDone = true;
}

export interface SeatResult {
  result: BlackjackResult;
  bet: number;
  payout: number;
  doubled: boolean;
  playerValue: number;
  tags: string[];
}

export function seatResult(table: BlackjackTable, seat: number): SeatResult {
  const s = table.seats[seat];
  if (!s) throw new RangeError('no such seat');
  const result = resultOf(s.cards, table.dealer);
  return {
    result,
    bet: s.bet,
    payout: payoutOf(result, s.bet),
    doubled: s.doubled,
    playerValue: handValue(s.cards),
    tags: tagsOf(result, s.doubled),
  };
}
