import { Type, type Static, type TSchema } from 'typebox';
import {
  BasisPoints,
  EpochMs,
  GameId,
  InstanceId,
  Pelica,
  PelicaDelta,
  PriceMicros,
  QuantityMilli,
  Snowflake,
} from './ids.ts';

/**
 * Domain events. Produced by server services after a state change has been committed,
 * published on the in-process bus, and consumed by subscribers (socket rooms, announcer,
 * webhook personas, DM queue, inbox, presence). Every event belongs to one guild.
 * Global things (the stock market) are fanned out as one event per guild.
 */
function event<T extends string, P extends Record<string, TSchema>>(type: T, props: P) {
  return Type.Object({
    type: Type.Literal(type),
    guildId: Snowflake,
    at: EpochMs,
    ...props,
  });
}

/** Where the action happened. Announcements add an "Open in Activity" button for chat ones. */
export const EventSource = Type.Enum(['activity', 'chat', 'system']);

export const GameSettled = event('GameSettled', {
  userId: Snowflake,
  game: GameId,
  roundId: Type.String({ maxLength: 64 }),
  stake: Pelica,
  payout: Pelica,
  net: PelicaDelta,
  source: EventSource,
  instanceId: Type.Optional(InstanceId),
});

export const BigWin = event('BigWin', {
  userId: Snowflake,
  game: GameId,
  roundId: Type.String({ maxLength: 64 }),
  payout: Pelica,
  /** payout / stake in basis points (25_000 = x2.5), for display. */
  multiplierBps: BasisPoints,
});

export const Jackpot = event('Jackpot', {
  userId: Snowflake,
  game: GameId,
  amount: Pelica,
});

export const RaceScheduled = event('RaceScheduled', {
  raceId: Type.Integer({ minimum: 1 }),
  startsAt: EpochMs,
  entrants: Type.Integer({ minimum: 0 }),
});

export const RaceFinished = event('RaceFinished', {
  raceId: Type.Integer({ minimum: 1 }),
  /** Horse ids from first to last. */
  placings: Type.Array(Type.Integer({ minimum: 1 })),
  /** Owners whose horse ran, for the per-owner result DM. */
  ownerIds: Type.Array(Snowflake),
  /** Bettors with at least one ticket, for the per-bettor result DM. */
  bettorIds: Type.Array(Snowflake),
});

export const HorseRetired = event('HorseRetired', {
  userId: Snowflake,
  horseId: Type.Integer({ minimum: 1 }),
  payout: Pelica,
});

export const MarketTick = event('MarketTick', {
  /** Ticker → price in micro-Pelica. Sent once per minute. */
  prices: Type.Record(Type.String({ maxLength: 16 }), PriceMicros),
});

export const MarketMove = event('MarketMove', {
  ticker: Type.String({ maxLength: 16 }),
  direction: Type.Enum(['spike', 'crash']),
  /** Signed change over the detection window in basis points. */
  changeBps: BasisPoints,
  price: PriceMicros,
});

export const LoanDue = event('LoanDue', {
  userId: Snowflake,
  loanId: Type.Integer({ minimum: 1 }),
  amount: Pelica,
  dueAt: EpochMs,
});

export const BankruptcyGraceStarted = event('BankruptcyGraceStarted', {
  userId: Snowflake,
  debt: Pelica,
  graceEndsAt: EpochMs,
});

export const MissionCompleted = event('MissionCompleted', {
  userId: Snowflake,
  missionId: Type.String({ maxLength: 64 }),
  reward: Pelica,
});

export const TitleAwarded = event('TitleAwarded', {
  userId: Snowflake,
  titleId: Type.String({ maxLength: 64 }),
  /** Monday of the ranking week (YYYY-MM-DD, game time zone) for weekly titles. */
  week: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
});

export const OrderFilled = event('OrderFilled', {
  userId: Snowflake,
  orderId: Type.Integer({ minimum: 1 }),
  ticker: Type.String({ maxLength: 16 }),
  side: Type.Enum(['buy', 'sell']),
  quantity: QuantityMilli,
  price: PriceMicros,
});

export const MarketplaceOutbid = event('MarketplaceOutbid', {
  userId: Snowflake,
  listingId: Type.Integer({ minimum: 1 }),
  newBid: Pelica,
});

export const DailyReady = event('DailyReady', {
  userId: Snowflake,
});

/**
 * A player went bankrupt: voluntary (`/破産`), forced when the grace period ran out, or a
 * successful overseas escape. Separate from `BankruptcyGraceStarted`, which only opens the
 * 24 h window and may end without a bankruptcy.
 */
export const BankruptcyDeclared = event('BankruptcyDeclared', {
  userId: Snowflake,
  cause: Type.Enum(['voluntary', 'forced', 'escape']),
  /** Teiai debt before the sequence and after compression (0 after an escape). */
  debtBefore: Pelica,
  debtAfter: Pelica,
});

/** A company closed after unpaid upkeep (or its owner's bankruptcy); stakes are wiped. */
export const CompanyBankrupt = event('CompanyBankrupt', {
  ownerId: Snowflake,
  companyName: Type.String({ minLength: 1, maxLength: 64 }),
  cause: Type.Enum(['upkeep', 'owner_bankrupt']),
  /** Investors whose stakes were wiped, for the per-investor notice. */
  investorIds: Type.Array(Snowflake),
});

/** A guild lottery closed: one winner takes the pot, or every entrant got the fee back. */
export const LotteryDrawn = event('LotteryDrawn', {
  lotteryId: Type.Integer({ minimum: 1 }),
  outcome: Type.Enum(['won', 'refunded']),
  /** Set when `outcome` is `won`. */
  winnerId: Type.Optional(Snowflake),
  /** Pot paid to the winner; 0 when refunded. */
  prize: Pelica,
  fee: Pelica,
  entrantIds: Type.Array(Snowflake),
});

export const DomainEvent = Type.Union([
  GameSettled,
  BigWin,
  Jackpot,
  RaceScheduled,
  RaceFinished,
  HorseRetired,
  MarketTick,
  MarketMove,
  LoanDue,
  BankruptcyGraceStarted,
  MissionCompleted,
  TitleAwarded,
  OrderFilled,
  MarketplaceOutbid,
  DailyReady,
  BankruptcyDeclared,
  CompanyBankrupt,
  LotteryDrawn,
]);
export type DomainEvent = Static<typeof DomainEvent>;
export type DomainEventType = DomainEvent['type'];
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

/** Event name → payload, for a typed in-process EventEmitter. */
export type DomainEventMap = { [K in DomainEventType]: DomainEventOf<K> };

export const DOMAIN_EVENT_TYPES = [
  'GameSettled',
  'BigWin',
  'Jackpot',
  'RaceScheduled',
  'RaceFinished',
  'HorseRetired',
  'MarketTick',
  'MarketMove',
  'LoanDue',
  'BankruptcyGraceStarted',
  'MissionCompleted',
  'TitleAwarded',
  'OrderFilled',
  'MarketplaceOutbid',
  'DailyReady',
  'BankruptcyDeclared',
  'CompanyBankrupt',
  'LotteryDrawn',
] as const satisfies readonly DomainEventType[];
