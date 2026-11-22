import { Type, type Static } from 'typebox';
import { EpochMs, Pelica, PelicaDelta, Snowflake } from '../ids.ts';
import { IdempotencyKey } from '../intents.ts';
import { LedgerReason } from '../ledger.ts';

/**
 * Casino slice of the Activity: the screens for chinchiro, slots, roulette, pachinko and
 * blackjack, the daily bonus on Home and the ledger history.
 *
 * The games run on the socket events that already exist (`game:bet`, `game:action`,
 * `table:join`, `table:leave`, `table:state`); this file only describes what comes back in
 * `IntentAccepted.result` and `TableSnapshot.data`, plus the four HTTP routes the screens add.
 * Everything here is additive and read by both sides.
 */

const closed = { additionalProperties: false } as const;

// ---- HTTP routes ---------------------------------------------------------------------------

export const CASINO_ROUTES = {
  /** GET → `CasinoOverview` (jackpot pool, minimum bet, the user's last rounds). */
  overview: '/api/casino/overview',
  /** GET → `DailyStatus`. */
  daily: '/api/daily',
  /** POST `DailyClaimRequest` → `DailyClaimResponse`; `conflict` when nothing can be claimed yet. */
  dailyClaim: '/api/daily/claim',
  /** GET (query `HistoryQuery`) → `HistoryPage`. */
  history: '/api/history',
} as const;
export type CasinoRoute = (typeof CASINO_ROUTES)[keyof typeof CASINO_ROUTES];

/** The games the casino slice plays (`GameId` minus horse and arena). */
export const CASINO_GAME_IDS = ['chinchiro', 'pachinko', 'slots', 'blackjack', 'roulette'] as const;
export type CasinoGameId = (typeof CASINO_GAME_IDS)[number];

/** Pelica `10`: the smallest bet the server accepts (`MIN_BET`). */
export const CASINO_MIN_BET = 10;

// ---- GET /api/casino/overview ---------------------------------------------------------------

export const RecentRound = Type.Object({
  roundId: Type.String({ maxLength: 64 }),
  game: Type.Enum(CASINO_GAME_IDS),
  stake: Pelica,
  /** Total credited for the round (0 on a loss). */
  payout: Pelica,
  net: PelicaDelta,
  settledAt: EpochMs,
});
export type RecentRound = Static<typeof RecentRound>;

export const CasinoOverview = Type.Object({
  minBet: Pelica,
  /** The guild's jackpot pool. */
  jackpotPool: Pelica,
  /** Games the owner switched off in this guild. */
  disabled: Type.Array(Type.Enum(CASINO_GAME_IDS)),
  /** The user's last settled rounds, newest first (at most 10). */
  recent: Type.Array(RecentRound, { maxItems: 10 }),
});
export type CasinoOverview = Static<typeof CasinoOverview>;

// ---- daily bonus ----------------------------------------------------------------------------

export const DAILY_STREAK_CAP = 20;

export const DailyStatus = Type.Object({
  claimable: Type.Boolean(),
  /** When the next 6 hour slot opens (epoch ms). */
  nextSlotAt: EpochMs,
  /** Consecutive days claimed so far. */
  streak: Type.Integer({ minimum: 0 }),
});
export type DailyStatus = Static<typeof DailyStatus>;

export const DailyClaimRequest = Type.Object({ idempotencyKey: IdempotencyKey }, closed);
export type DailyClaimRequest = Static<typeof DailyClaimRequest>;

export const DailyClaimResponse = Type.Object({
  /** true when this is the stored answer to a repeated key. */
  replayed: Type.Boolean(),
  /** Gross bonus (after a double ticket and relic). */
  amount: Pelica,
  /** Teiai's cut while in debt. */
  skimmed: Pelica,
  /** Withheld toward the debt. */
  repaid: Pelica,
  streak: Type.Integer({ minimum: 1 }),
  boosted: Type.Boolean(),
  guarded: Type.Integer({ minimum: 0 }),
  balance: Pelica,
  nextSlotAt: EpochMs,
});
export type DailyClaimResponse = Static<typeof DailyClaimResponse>;

// ---- GET /api/history -----------------------------------------------------------------------

export const HISTORY_PAGE_DEFAULT = 20;
export const HISTORY_PAGE_MAX = 50;

/** Query values are strings; the server checks digit strings like `InboxQuery`. */
export const HistoryQuery = Type.Object(
  {
    /** Only entries with `id < before`. Omit for the newest page. */
    before: Type.Optional(Type.String({ pattern: '^[1-9][0-9]{0,15}$' })),
    limit: Type.Optional(Type.String({ pattern: '^(?:[1-9]|[1-4][0-9]|50)$' })),
  },
  closed,
);
export type HistoryQuery = Static<typeof HistoryQuery>;

export const HistoryEntry = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  delta: PelicaDelta,
  balanceAfter: Pelica,
  reason: LedgerReason,
  /** What the row refers to (`round`, `daily`, ...), for display only. */
  refType: Type.Union([Type.String({ maxLength: 32 }), Type.Null()]),
  createdAt: EpochMs,
});
export type HistoryEntry = Static<typeof HistoryEntry>;

export const HistoryPage = Type.Object({
  /** Newest first. */
  items: Type.Array(HistoryEntry, { maxItems: HISTORY_PAGE_MAX }),
  /** `before` for the next, older page; null when there is none. */
  nextBefore: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});
export type HistoryPage = Static<typeof HistoryPage>;

// ---- game results (`IntentAccepted.result`) ------------------------------------------------

/** What a settlement paid. Mirrors the server's `SettlementSummary`. */
export const SettlementView = Type.Object({
  roundId: Type.String(),
  game: Type.Enum(CASINO_GAME_IDS),
  stake: Pelica,
  /** Credited for the round: payout + event bonus + insurance. */
  payout: Pelica,
  net: PelicaDelta,
  eventBonus: Pelica,
  insured: Pelica,
  penalty: Pelica,
  penaltyShortfall: Pelica,
  withheld: Pelica,
  /** Jackpot paid on this round (0 when it was not hit). */
  jackpot: Pelica,
  /** Pool left after the round. */
  jackpotPool: Pelica,
  balance: Pelica,
  tier: Type.Union([
    Type.Literal('jackpot'),
    Type.Literal('super'),
    Type.Literal('big'),
    Type.Null(),
  ]),
});
export type SettlementView = Static<typeof SettlementView>;

export const CHINCHIRO_KINDS = ['pinzoro', 'arashi', 'shigoro', 'me', 'menashi', 'hifumi'] as const;
export type ChinchiroKind = (typeof CHINCHIRO_KINDS)[number];

export const ChinchiroRollView = Type.Object({
  dice: Type.Tuple([Type.Integer(), Type.Integer(), Type.Integer()]),
  hand: Type.Object({ kind: Type.Enum(CHINCHIRO_KINDS), value: Type.Integer() }),
});
export type ChinchiroRollView = Static<typeof ChinchiroRollView>;

export const CHINCHIRO_RESULTS = ['win', 'lose', 'draw'] as const;
export type ChinchiroResultKind = (typeof CHINCHIRO_RESULTS)[number];

/** Solo chinchiro: `game:bet` starts it, `game:action` `roll` plays it. */
export const ChinchiroView = Type.Object({
  roundId: Type.String(),
  stake: Pelica,
  status: Type.Union([Type.Literal('player_turn'), Type.Literal('settled')]),
  dealerRolls: Type.Array(ChinchiroRollView),
  playerRolls: Type.Array(ChinchiroRollView),
  rollsLeft: Type.Integer({ minimum: 0 }),
  /** Epoch ms when the turn times out; null once settled. */
  deadline: Type.Union([EpochMs, Type.Null()]),
  result: Type.Optional(
    Type.Object({
      outcome: Type.Enum(CHINCHIRO_RESULTS),
      multiplier: Type.Number(),
      payout: Pelica,
      penalty: Pelica,
      settlement: SettlementView,
    }),
  ),
});
export type ChinchiroView = Static<typeof ChinchiroView>;

/** `game:bet` chinchiro with `args.table = true`: the seat taken at the shared lobby. */
export const ChinchiroSeatAccepted = Type.Object({
  tableRound: Type.String(),
  roundId: Type.String(),
  host: Type.Boolean(),
  deadline: Type.Union([EpochMs, Type.Null()]),
});
export type ChinchiroSeatAccepted = Static<typeof ChinchiroSeatAccepted>;

/** Public data of the chinchiro table snapshot (`TableSnapshot.data`). */
export const ChinchiroTableData = Type.Object({
  minBet: Pelica,
  /** Time one dice step stays on screen during the reveal. */
  stepMs: Type.Integer({ minimum: 0 }),
  deadline: Type.Union([EpochMs, Type.Null()]),
  closedEmpty: Type.Boolean(),
  hostId: Type.Optional(Snowflake),
  bet: Type.Optional(Pelica),
  seatRounds: Type.Optional(Type.Array(Type.Object({ userId: Snowflake, roundId: Type.String() }))),
  dealerRolls: Type.Optional(Type.Array(ChinchiroRollView)),
  hands: Type.Optional(
    Type.Array(
      Type.Object({
        userId: Snowflake,
        roundId: Type.String(),
        rolls: Type.Array(ChinchiroRollView),
      }),
    ),
  ),
  verdicts: Type.Optional(
    Type.Array(
      Type.Object({
        userId: Snowflake,
        result: Type.Enum(CHINCHIRO_RESULTS),
        multiplier: Type.Number(),
        payout: Pelica,
        net: PelicaDelta,
        settled: Type.Boolean(),
      }),
    ),
  ),
  won: Type.Optional(Type.Boolean()),
});
export type ChinchiroTableData = Static<typeof ChinchiroTableData>;

export const SLOT_SYMBOLS = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣'] as const;
export type SlotSymbolView = (typeof SLOT_SYMBOLS)[number];

export const SlotsResultView = Type.Object({
  roundId: Type.String(),
  reels: Type.Tuple([Type.Enum(SLOT_SYMBOLS), Type.Enum(SLOT_SYMBOLS), Type.Enum(SLOT_SYMBOLS)]),
  /** Payout multiple of the bet (0, 0.3, 1.5, 5 ... 500). */
  multiplier: Type.Number(),
  label: Type.Object({ kind: Type.String(), symbol: Type.Optional(Type.String()) }),
  settlement: SettlementView,
});
export type SlotsResultView = Static<typeof SlotsResultView>;

export const PACHINKO_OMENS = ['', 'blue', 'red', 'gold'] as const;
export const PACHINKO_TIERS = ['', 'normal', 'super', 'premium'] as const;

export const PachinkoSpinView = Type.Object({
  omen: Type.Enum(PACHINKO_OMENS),
  tier: Type.Enum(PACHINKO_TIERS),
  hitProb: Type.Number(),
  hit: Type.Boolean(),
  /** Round multipliers of the chain; empty on a miss. */
  rounds: Type.Array(Type.Number()),
});
export type PachinkoSpinView = Static<typeof PachinkoSpinView>;

export const PachinkoSetView = Type.Object({
  /** Balls (of 100) that entered the start pocket. */
  starts: Type.Integer({ minimum: 0 }),
  spins: Type.Array(PachinkoSpinView),
  raw: Type.Number(),
});
export type PachinkoSetView = Static<typeof PachinkoSetView>;

export const PACHINKO_BALLS_PER_SET = 100;
export const PACHINKO_MAX_SETS = 10;

export const PachinkoResultView = Type.Object({
  roundId: Type.String(),
  /** Bet per set. */
  bet: Pelica,
  sets: Type.Array(PachinkoSetView),
  topRound: Type.Number(),
  settlement: SettlementView,
});
export type PachinkoResultView = Static<typeof PachinkoResultView>;

export const CARD_RANKS = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
] as const;
export const CARD_SUITS = ['♠', '♥', '♦', '♣'] as const;

export const CardView = Type.Object({
  rank: Type.Enum(CARD_RANKS),
  suit: Type.Enum(CARD_SUITS),
});
export type CardView = Static<typeof CardView>;

export const BLACKJACK_RESULTS = ['blackjack', 'win', 'push', 'lose', 'bust'] as const;
export type BlackjackResultKind = (typeof BLACKJACK_RESULTS)[number];

export const BlackjackSeatView = Type.Object({
  index: Type.Integer({ minimum: 0 }),
  userId: Snowflake,
  cards: Type.Array(CardView),
  value: Type.Integer({ minimum: 0 }),
  stake: Pelica,
  doubled: Type.Boolean(),
  status: Type.Union([Type.Literal('playing'), Type.Literal('done')]),
  result: Type.Optional(Type.Enum(BLACKJACK_RESULTS)),
  payout: Type.Optional(Pelica),
  settlement: Type.Optional(SettlementView),
});
export type BlackjackSeatView = Static<typeof BlackjackSeatView>;

export const BLACKJACK_PHASES = ['betting', 'player', 'settled'] as const;

/** The blackjack table. Also `TableSnapshot.data` while a hand is running. */
export const BlackjackView = Type.Object({
  roundId: Type.String(),
  shared: Type.Boolean(),
  phase: Type.Enum(BLACKJACK_PHASES),
  /** The hole card is `null` while a seat is still playing. */
  dealer: Type.Array(Type.Union([CardView, Type.Null()])),
  dealerValue: Type.Union([Type.Integer(), Type.Null()]),
  seats: Type.Array(BlackjackSeatView),
  /** Seat whose turn it is (-1 when nobody's). */
  turn: Type.Integer(),
  deadline: Type.Union([EpochMs, Type.Null()]),
});
export type BlackjackView = Static<typeof BlackjackView>;

export const ROULETTE_KINDS = [
  'red',
  'black',
  'even',
  'odd',
  'low',
  'high',
  'dozen1',
  'dozen2',
  'dozen3',
  'number',
] as const;
export type RouletteKindView = (typeof ROULETTE_KINDS)[number];

export const RouletteLineView = Type.Object({
  kind: Type.Enum(ROULETTE_KINDS),
  number: Type.Optional(Type.Integer({ minimum: 0, maximum: 36 })),
  stake: Pelica,
});
export type RouletteLineView = Static<typeof RouletteLineView>;

/** `game:bet` roulette: the chips were accepted, the spin follows when the window closes. */
export const RouletteBetAccepted = Type.Object({
  tableRound: Type.String(),
  roundId: Type.String(),
  lines: Type.Array(RouletteLineView),
  deadline: Type.Union([EpochMs, Type.Null()]),
});
export type RouletteBetAccepted = Static<typeof RouletteBetAccepted>;

export const SPIN_FRAME_KINDS = ['start', 'bounce', 'slow', 'result'] as const;

export const SpinFrameView = Type.Object({
  atMs: Type.Integer({ minimum: 0 }),
  kind: Type.Enum(SPIN_FRAME_KINDS),
  pocket: Type.Optional(Type.Integer({ minimum: 0, maximum: 36 })),
});
export type SpinFrameView = Static<typeof SpinFrameView>;

export const ROULETTE_COLORS = ['green', 'red', 'black'] as const;

/** Public data of the roulette table snapshot (`TableSnapshot.data`). */
export const RouletteTableData = Type.Object({
  deadline: Type.Union([EpochMs, Type.Null()]),
  minBet: Pelica,
  /** Last results, newest first (at most 12). */
  history: Type.Array(Type.Integer({ minimum: 0, maximum: 36 })),
  bets: Type.Array(
    Type.Object({
      userId: Snowflake,
      roundId: Type.String(),
      stake: Pelica,
      lines: Type.Array(RouletteLineView),
    }),
  ),
  result: Type.Optional(Type.Integer({ minimum: 0, maximum: 36 })),
  color: Type.Optional(Type.Enum(ROULETTE_COLORS)),
  timeline: Type.Optional(Type.Union([Type.Array(SpinFrameView), Type.Null()])),
  payouts: Type.Optional(
    Type.Array(Type.Object({ userId: Snowflake, payout: Pelica, net: PelicaDelta })),
  ),
});
export type RouletteTableData = Static<typeof RouletteTableData>;

/** Idle blackjack table: only the minimum bet is public. */
export const BlackjackIdleData = Type.Object({ minBet: Pelica });
export type BlackjackIdleData = Static<typeof BlackjackIdleData>;
