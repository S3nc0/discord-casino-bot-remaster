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
  StreamId,
  StreamRoundId,
} from './ids.ts';
import {
  STREAM_LIMITS,
  StreamEndCause,
  StreamLockCause,
  StreamSettleResult,
  StreamSide,
} from './stream.ts';

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

/** Labels a settled round earned (see `GameSettled.tags`). */
export const GameTag = Type.String({ pattern: '^[a-z][a-z0-9_]{0,31}$' });
export const GameTags = Type.Array(GameTag, { maxItems: 16 });

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
  /**
   * Game-specific labels of the round, read by missions (`tag` kind) and the announcer, e.g.
   * `natural` and `double_win` (blackjack) or `jackpot`. Lowercase snake_case; order carries
   * no meaning. Absent when the round earned none.
   */
  tags: Type.Optional(GameTags),
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

/**
 * A bred foal was born (docs/spec/horse-breeding.md §5). Breeding is instant, so this is
 * published right after the breeding transaction commits. Inbox + opt-in DM for the breeder
 * (`horse_foaled`); a guild announcement only when `statTotal >= FOAL_ANNOUNCE_MIN_TOTAL`.
 */
export const HorseFoaled = event('HorseFoaled', {
  /** Breeder, owner of the foal. */
  userId: Snowflake,
  foalId: Type.Integer({ minimum: 1 }),
  foalName: Type.String({ minLength: 1, maxLength: 12 }),
  /** Parent A and parent B, as picked in the breed form. */
  parentIds: Type.Tuple([Type.Integer({ minimum: 1 }), Type.Integer({ minimum: 1 })]),
  statTotal: Type.Integer({ minimum: 190, maximum: 210 }),
  generation: Type.Integer({ minimum: 1 }),
  maturesAt: EpochMs,
});

/** `HorseFoaled` is announced in the guild channel only from this stat total up. */
export const FOAL_ANNOUNCE_MIN_TOTAL = 205;

/**
 * Teiai put the day's relic up for auction on the player market (docs/spec/player-market.md §9).
 * Guild-wide: announced in the guild channel and open to every member, no one is named.
 */
export const TeiaiRelicListed = event('TeiaiRelicListed', {
  listingId: Type.Integer({ minimum: 1 }),
  /** Unstarred relic item id, e.g. `relic_fossil`. */
  itemId: Type.String({ minLength: 1, maxLength: 64 }),
  /** Starting price (the relic's reference value). */
  startPrice: Pelica,
  endAt: EpochMs,
});

// ---- stream panel (docs/spec/stream.md) ----
// None of these carries a `userId`: the socket layer would route such an event to that one user.
// The stream events go to the stream room (`rooms.stream`) and, for the announcer, to the channel.

/** A streamer opened a panel. */
export const StreamStarted = event('StreamStarted', {
  streamId: StreamId,
  streamerId: Snowflake,
  title: Type.String({ maxLength: STREAM_LIMITS.titleMax }),
  url: Type.Union([Type.String({ maxLength: STREAM_LIMITS.urlMax }), Type.Null()]),
  /** Text channel of the panel message, or null for a stream started in the Activity only. */
  channelId: Type.Union([Snowflake, Type.Null()]),
});

/** A super chat landed. The tip card is posted from this event. */
export const StreamTipped = event('StreamTipped', {
  streamId: StreamId,
  streamerId: Snowflake,
  tipperId: Snowflake,
  amount: Pelica,
  fee: Pelica,
  /** Up to 150 characters, may be empty. Posted with no mentions allowed. */
  message: Type.String({ maxLength: STREAM_LIMITS.tipMessageMax }),
  /** Panel totals after this tip. */
  tips: Pelica,
  tipCount: Type.Integer({ minimum: 0 }),
});

/** Totals of the active round changed because someone bet. No bettor identity. */
export const StreamBetPlaced = event('StreamBetPlaced', {
  streamId: StreamId,
  roundId: StreamRoundId,
  side: StreamSide,
  winTotal: Pelica,
  loseTotal: Pelica,
  bettors: Type.Integer({ minimum: 0 }),
});

export const StreamRoundOpened = event('StreamRoundOpened', {
  streamId: StreamId,
  streamerId: Snowflake,
  roundId: StreamRoundId,
  label: Type.String({ maxLength: STREAM_LIMITS.roundLabelMax }),
  /** Bets close by themselves at this time (open time + 10 minutes). */
  autoLockAt: EpochMs,
});

/** Bets closed: by the streamer, or by the 10-minute timer. */
export const StreamRoundLocked = event('StreamRoundLocked', {
  streamId: StreamId,
  streamerId: Snowflake,
  roundId: StreamRoundId,
  cause: StreamLockCause,
});

/** A round paid out or was voided. `result.cause` says who and why. */
export const StreamRoundSettled = event('StreamRoundSettled', {
  streamId: StreamId,
  streamerId: Snowflake,
  result: StreamSettleResult,
});

export const StreamEnded = event('StreamEnded', {
  streamId: StreamId,
  streamerId: Snowflake,
  cause: StreamEndCause,
  tips: Pelica,
  tipCount: Type.Integer({ minimum: 0 }),
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
  HorseFoaled,
  TeiaiRelicListed,
  StreamStarted,
  StreamTipped,
  StreamBetPlaced,
  StreamRoundOpened,
  StreamRoundLocked,
  StreamRoundSettled,
  StreamEnded,
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
  'HorseFoaled',
  'TeiaiRelicListed',
  'StreamStarted',
  'StreamTipped',
  'StreamBetPlaced',
  'StreamRoundOpened',
  'StreamRoundLocked',
  'StreamRoundSettled',
  'StreamEnded',
] as const satisfies readonly DomainEventType[];
