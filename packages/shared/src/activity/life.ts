import { Type, type Static, type TProperties } from 'typebox';
import { ErrorCode } from '../errors.ts';
import { EpochMs, Pelica, Snowflake } from '../ids.ts';
import { IdempotencyKey } from '../intents.ts';

/**
 * Activity contracts of the "life" slice: underground labor, quiz, lottery, polls, shop,
 * missions, weekly ranking and transfer. Every route is under `/api`, needs the session token and
 * acts only on the token's own user and guild. Writes carry an `idempotencyKey`; the server stores
 * the first response per key and replays it (`replayed: true`). Clients send intents; amounts,
 * odds and outcomes are decided on the server.
 */
export const LIFE_ROUTES = {
  /** GET → `WorkView`. */
  work: '/api/life/work',
  /** POST `WorkClickRequest` → `WorkClickResponse`. */
  workClick: '/api/life/work/click',
  /** POST `WorkCollectRequest` → `WorkCollectResponse`. */
  workCollect: '/api/life/work/collect',
  /** POST `WorkDrinkRequest` → `WorkDrinkResponse`. */
  workDrink: '/api/life/work/drink',
  /** POST `WorkUpgradeRequest` → `WorkUpgradeResponse`. */
  workUpgrade: '/api/life/work/upgrade',
  /** POST `WorkHireRequest` → `WorkHireResponse`. */
  workHire: '/api/life/work/hire',
  /** POST `WorkDismissRequest` → `LifeWriteResponse`. */
  workDismiss: '/api/life/work/dismiss',
  /** POST `WorkRenewRequest` → `LifeWriteResponse`. */
  workRenew: '/api/life/work/renew',
  /** POST `WorkMergeRequest` → `WorkMergeResponse`. */
  workMerge: '/api/life/work/merge',
  /** GET (query `WorkRankingQuery`) → `WorkRanking`. */
  workRanking: '/api/life/work/ranking',
  /** GET → `QuizView`. */
  quiz: '/api/life/quiz',
  /** POST `QuizAnswerRequest` → `QuizAnswerResponse`. */
  quizAnswer: '/api/life/quiz/answer',
  /** POST `QuizPostRequest` → `QuizPostResponse`. */
  quizPost: '/api/life/quiz/post',
  /** POST `QuizWithdrawRequest` → `LifeWriteResponse`. */
  quizWithdraw: '/api/life/quiz/withdraw',
  /** GET → `LotteryView`. */
  lottery: '/api/life/lottery',
  /** POST `LotteryJoinRequest` → `LifeWriteResponse`. */
  lotteryJoin: '/api/life/lottery/join',
  /** GET → `PollsView`. */
  polls: '/api/life/polls',
  /** POST `PollCreateRequest` → `PollWriteResponse`. */
  pollCreate: '/api/life/polls/create',
  /** POST `PollVoteRequest` → `PollWriteResponse`. */
  pollVote: '/api/life/polls/vote',
  /** GET → `ShopView`. */
  shop: '/api/life/shop',
  /** POST `ShopBuyRequest` → `ShopBuyResponse`. */
  shopBuy: '/api/life/shop/buy',
  /** POST `LotBuyRequest` → `ShopBuyResponse` (black-market lots reveal their item here). */
  shopMarketBuy: '/api/life/shop/market/buy',
  /** POST `LotBuyRequest` → `ShopBuyResponse`. */
  shopSeizedBuy: '/api/life/shop/seized/buy',
  /** GET → `MissionsView`. */
  missions: '/api/life/missions',
  /** GET → `RankingView`. */
  ranking: '/api/life/ranking',
  /** GET → `TransferView`. */
  transfer: '/api/life/transfer',
  /** GET (query `TransferMembersQuery`) → `TransferMembers`. */
  transferMembers: '/api/life/transfer/members',
  /** POST `TransferPreviewRequest` → `TransferPreview` (read-only, creates nothing). */
  transferPreview: '/api/life/transfer/preview',
  /** POST `TransferSendRequest` → `TransferSendResponse`. */
  transferSend: '/api/life/transfer/send',
} as const;
export type LifeRoute = (typeof LIFE_ROUTES)[keyof typeof LIFE_ROUTES];

const closed = { additionalProperties: false } as const;
const count = Type.Integer({ minimum: 0 });
const Name = Type.String({ maxLength: 80 });

/** A write's response: the first response of the key, plus the balance now. */
export const LifeWriteResponse = Type.Object({
  /** true when this is the stored response to a repeated key. */
  replayed: Type.Boolean(),
  /** Balance in this guild after the change. */
  balance: Pelica,
});
export type LifeWriteResponse = Static<typeof LifeWriteResponse>;

const written = <T extends TProperties>(props: T) =>
  Type.Object({ replayed: Type.Boolean(), balance: Pelica, ...props });

/**
 * Body of a refused request. `rule` is the stable snake_case key of the game rule that said no
 * (client text `screen.life.rule.<rule>`), `params` fill it; `error` is the generic code.
 */
export const LifeError = Type.Object({
  error: ErrorCode,
  rule: Type.Optional(Type.String({ maxLength: 64 })),
  params: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()]))),
  retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type LifeError = Static<typeof LifeError>;

const keyed = { idempotencyKey: IdempotencyKey } as const;

// ---- labor ----

export const WORKER_KINDS_WIRE = ['apprentice', 'miner', 'craftsman', 'foreman'] as const;
export const WorkerKindWire = Type.Enum(WORKER_KINDS_WIRE);
export type WorkerKindWire = Static<typeof WorkerKindWire>;

export const ToolWire = Type.Enum(['pick', 'glove'] as const);
export type ToolWire = Static<typeof ToolWire>;

export const BuffKeyWire = Type.Enum([
  'click',
  'wage',
  'luck',
  'recovery',
  'daily',
  'prize',
] as const);
export type BuffKeyWire = Static<typeof BuffKeyWire>;

export const WorkerContract = Type.Object({
  id: Type.Integer(),
  kind: WorkerKindWire,
  expiresAt: EpochMs,
  renew: Type.Boolean(),
});
export type WorkerContract = Static<typeof WorkerContract>;

export const WorkView = Type.Object({
  now: EpochMs,
  balance: Pelica,
  pick: count,
  glove: count,
  dorm: count,
  /** Contracts the dorm can hold. */
  slots: count,
  /** 0..100, fractional. */
  fatigue: Type.Number({ minimum: 0, maximum: 100 }),
  clicks: count,
  dayClicks: count,
  /** Clicks per day that pay in full. */
  dayCap: count,
  /** Pay of the next click at the current fatigue. */
  clickPay: count,
  /** Earnings waiting to be collected. */
  pot: count,
  terrain: Type.String({ maxLength: 16 }),
  /** Next upgrade cost per tool; null at the maximum level. */
  upgrade: Type.Object({
    pick: Type.Union([count, Type.Null()]),
    glove: Type.Union([count, Type.Null()]),
    dorm: Type.Union([count, Type.Null()]),
  }),
  maxLevel: count,
  dormMax: count,
  workers: Type.Array(WorkerContract),
  /** Contract fee per kind, wage per hour (milli-Pelica free: whole Pelica). */
  hire: Type.Array(Type.Object({ kind: WorkerKindWire, fee: count, hourly: Type.Number() })),
  /** Ores and relics dug but not collected yet. */
  ores: Type.Record(Type.String(), count),
  relics: Type.Record(Type.String(), count),
  /** Relics owned (by id with star suffix), and the stacked buffs they give. */
  held: Type.Record(Type.String(), count),
  buffs: Type.Record(Type.String(), Type.Number()),
  mergeCount: count,
  starMax: count,
  /** Energy drinks owned. */
  drinks: count,
  skimBps: count,
});
export type WorkView = Static<typeof WorkView>;

export const WorkClickRequest = Type.Object({ ...keyed }, closed);
export type WorkClickRequest = Static<typeof WorkClickRequest>;
export const WorkClickResponse = written({
  /** Inside the one-second cooldown: nothing was paid. */
  tooFast: Type.Boolean(),
  pay: count,
  crit: Type.Boolean(),
  combo: Type.Boolean(),
  ore: Type.Union([Type.String(), Type.Null()]),
  capped: Type.Boolean(),
  fatigue: Type.Number(),
});
export type WorkClickResponse = Static<typeof WorkClickResponse>;

export const WorkCollectRequest = Type.Object({ ...keyed }, closed);
export type WorkCollectRequest = Static<typeof WorkCollectRequest>;
export const WorkCollectResponse = written({
  amount: count,
  skimmed: count,
  withheld: count,
  net: count,
  ores: Type.Record(Type.String(), count),
  relics: Type.Record(Type.String(), count),
});
export type WorkCollectResponse = Static<typeof WorkCollectResponse>;

export const WorkDrinkRequest = Type.Object({ ...keyed }, closed);
export type WorkDrinkRequest = Static<typeof WorkDrinkRequest>;
export const WorkDrinkResponse = written({ fatigue: Type.Number() });
export type WorkDrinkResponse = Static<typeof WorkDrinkResponse>;

/** Upgrade a tool, or the dorm (`tool: 'dorm'`). */
export const WorkUpgradeRequest = Type.Object(
  { ...keyed, tool: Type.Enum(['pick', 'glove', 'dorm'] as const) },
  closed,
);
export type WorkUpgradeRequest = Static<typeof WorkUpgradeRequest>;
export const WorkUpgradeResponse = written({ level: count });
export type WorkUpgradeResponse = Static<typeof WorkUpgradeResponse>;

export const WorkHireRequest = Type.Object({ ...keyed, kind: WorkerKindWire }, closed);
export type WorkHireRequest = Static<typeof WorkHireRequest>;
export const WorkHireResponse = written({ workerId: Type.Integer() });
export type WorkHireResponse = Static<typeof WorkHireResponse>;

export const WorkDismissRequest = Type.Object({ ...keyed, kind: WorkerKindWire }, closed);
export type WorkDismissRequest = Static<typeof WorkDismissRequest>;

export const WorkRenewRequest = Type.Object({ ...keyed, renew: Type.Boolean() }, closed);
export type WorkRenewRequest = Static<typeof WorkRenewRequest>;

export const WorkMergeRequest = Type.Object(
  { ...keyed, itemId: Type.String({ pattern: '^relic_[a-z]+(_s[1-9])?$', maxLength: 32 }) },
  closed,
);
export type WorkMergeRequest = Static<typeof WorkMergeRequest>;
export const WorkMergeResponse = written({ itemId: Type.String({ maxLength: 32 }) });
export type WorkMergeResponse = Static<typeof WorkMergeResponse>;

export const WorkRankingQuery = Type.Object(
  { period: Type.Optional(Type.Enum(['total', 'today'] as const)) },
  closed,
);
export type WorkRankingQuery = Static<typeof WorkRankingQuery>;
export const WorkRankRow = Type.Object({
  rank: Type.Integer({ minimum: 1 }),
  userId: Snowflake,
  name: Name,
  clicks: count,
  earned: count,
});
export type WorkRankRow = Static<typeof WorkRankRow>;
export const WorkRanking = Type.Object({
  period: Type.Enum(['total', 'today'] as const),
  rows: Type.Array(WorkRankRow),
  self: Type.Union([WorkRankRow, Type.Null()]),
  total: count,
});
export type WorkRanking = Static<typeof WorkRanking>;

// ---- quiz ----

export const QuizItem = Type.Object({
  id: Type.Integer(),
  question: Type.String({ maxLength: 600 }),
  choices: Type.Array(Type.String({ maxLength: 120 }), { minItems: 4, maxItems: 4 }),
  reward: Pelica,
  /** null: no deadline (official quizzes). */
  expiresAt: Type.Union([EpochMs, Type.Null()]),
  /** null: an official quiz paid by the house. */
  authorName: Type.Union([Name, Type.Null()]),
});
export type QuizItem = Static<typeof QuizItem>;

export const QuizMine = Type.Object({
  id: Type.Integer(),
  question: Type.String({ maxLength: 600 }),
  reward: Pelica,
  expiresAt: Type.Union([EpochMs, Type.Null()]),
  answers: count,
  correct: count,
  /** Paid to the author so far. */
  earned: count,
});
export type QuizMine = Static<typeof QuizMine>;

export const QuizLimits = Type.Object({
  openLimit: count,
  dailyLimit: count,
  minGames: count,
  questionMax: count,
  choiceMax: count,
  explanationMax: count,
  minMinutes: count,
  maxMinutes: count,
  defaultMinutes: count,
});
export type QuizLimits = Static<typeof QuizLimits>;

export const QuizView = Type.Object({
  now: EpochMs,
  balance: Pelica,
  /** The oldest open quiz this player may answer. */
  next: Type.Union([QuizItem, Type.Null()]),
  mine: Type.Array(QuizMine),
  limits: QuizLimits,
  /** Games played; user quizzes pay (and count) only from `limits.minGames`. */
  gamesPlayed: count,
});
export type QuizView = Static<typeof QuizView>;

export const QuizAnswerRequest = Type.Object(
  {
    ...keyed,
    quizId: Type.Integer({ minimum: 1 }),
    choice: Type.Integer({ minimum: 0, maximum: 3 }),
  },
  closed,
);
export type QuizAnswerRequest = Static<typeof QuizAnswerRequest>;
export const QuizAnswerResponse = written({
  correct: Type.Boolean(),
  /** Index of the right choice. */
  answer: Type.Integer({ minimum: 0, maximum: 3 }),
  explanation: Type.String({ maxLength: 900 }),
  reward: count,
  rewardBlocked: Type.Boolean(),
});
export type QuizAnswerResponse = Static<typeof QuizAnswerResponse>;

/** `choices[0]` is the right answer; the server shuffles what players see. */
export const QuizPostRequest = Type.Object(
  {
    ...keyed,
    question: Type.String({ minLength: 1, maxLength: 600 }),
    choices: Type.Array(Type.String({ maxLength: 160 }), { minItems: 4, maxItems: 4 }),
    explanation: Type.Optional(Type.String({ maxLength: 900 })),
    reward: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    minutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 525_600 })),
  },
  closed,
);
export type QuizPostRequest = Static<typeof QuizPostRequest>;
export const QuizPostResponse = written({ quizId: Type.Integer() });
export type QuizPostResponse = Static<typeof QuizPostResponse>;

export const QuizWithdrawRequest = Type.Object(
  { ...keyed, quizId: Type.Integer({ minimum: 1 }) },
  closed,
);
export type QuizWithdrawRequest = Static<typeof QuizWithdrawRequest>;

// ---- lottery ----

export const LotteryCurrent = Type.Object({
  id: Type.Integer(),
  hostName: Name,
  fee: Pelica,
  closesAt: EpochMs,
  /** What the winner takes: `fee * entrants`. */
  pot: Pelica,
  entrantCount: count,
  /** Up to 20 names, in entry order. */
  entrants: Type.Array(Name, { maxItems: 20 }),
  joined: Type.Boolean(),
});
export type LotteryCurrent = Static<typeof LotteryCurrent>;

export const LotteryResult = Type.Object({
  id: Type.Integer(),
  /** `won`: one winner; `refunded`: fewer than two entrants (or cancelled): everyone got the fee back. */
  outcome: Type.Enum(['won', 'refunded'] as const),
  cancelled: Type.Boolean(),
  winnerName: Type.Union([Name, Type.Null()]),
  iWon: Type.Boolean(),
  iEntered: Type.Boolean(),
  prize: Pelica,
  fee: Pelica,
  entrantCount: count,
});
export type LotteryResult = Static<typeof LotteryResult>;

export const LotteryView = Type.Object({
  now: EpochMs,
  balance: Pelica,
  current: Type.Union([LotteryCurrent, Type.Null()]),
  last: Type.Union([LotteryResult, Type.Null()]),
  minEntrants: count,
});
export type LotteryView = Static<typeof LotteryView>;

export const LotteryJoinRequest = Type.Object(
  { ...keyed, raffleId: Type.Integer({ minimum: 1 }) },
  closed,
);
export type LotteryJoinRequest = Static<typeof LotteryJoinRequest>;

// ---- polls ----

export const PollItem = Type.Object({
  id: Type.Integer(),
  creatorName: Name,
  mine: Type.Boolean(),
  title: Type.String({ maxLength: 220 }),
  closesAt: EpochMs,
  status: Type.Enum(['open', 'closed'] as const),
  yes: count,
  no: count,
  voters: count,
  /** What I voted; null: not yet. */
  myVote: Type.Union([Type.Enum(['yes', 'no'] as const), Type.Null()]),
  verdict: Type.Enum(['yes', 'no', 'tie'] as const),
});
export type PollItem = Static<typeof PollItem>;

export const PollsView = Type.Object({
  now: EpochMs,
  polls: Type.Array(PollItem),
  limits: Type.Object({
    titleMax: count,
    defaultMinutes: count,
    maxMinutes: count,
    maxOpen: count,
  }),
});
export type PollsView = Static<typeof PollsView>;

export const PollCreateRequest = Type.Object(
  {
    ...keyed,
    title: Type.String({ minLength: 1, maxLength: 220 }),
    minutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 43_200 })),
  },
  closed,
);
export type PollCreateRequest = Static<typeof PollCreateRequest>;

export const PollVoteRequest = Type.Object(
  { ...keyed, pollId: Type.Integer({ minimum: 1 }), yes: Type.Boolean() },
  closed,
);
export type PollVoteRequest = Static<typeof PollVoteRequest>;

export const PollWriteResponse = written({ poll: PollItem });
export type PollWriteResponse = Static<typeof PollWriteResponse>;

// ---- shop ----

export const SHOP_KINDS = [
  'title',
  'card_color',
  'card_icon',
  'consumable',
  'racing',
  'market',
  'skin_dice',
  'skin_table',
  'collection',
  'color_role',
] as const;
export const ShopKind = Type.Enum(SHOP_KINDS);
export type ShopKind = Static<typeof ShopKind>;

export const ShopItem = Type.Object({
  id: Type.String({ maxLength: 40 }),
  kind: ShopKind,
  price: Pelica,
  owned: count,
  /** Units buyable right now for limited stock (energy drinks); null: unlimited. */
  available: Type.Union([count, Type.Null()]),
  /** One copy at most. */
  unique: Type.Boolean(),
  /** The server asks the player to confirm (price at or above `confirmFrom`). */
  confirm: Type.Boolean(),
});
export type ShopItem = Static<typeof ShopItem>;

export const MarketLotView = Type.Object({
  id: Type.Integer(),
  /** `?` for a black-market lot until bought. */
  itemId: Type.String({ maxLength: 40 }),
  black: Type.Boolean(),
  mode: Type.Enum(['auction', 'fixed'] as const),
  qty: count,
  /** Price right now (Dutch auctions fall over time). */
  price: Pelica,
  expiresAt: EpochMs,
  confirm: Type.Boolean(),
});
export type MarketLotView = Static<typeof MarketLotView>;

export const SeizedLotView = Type.Object({
  id: Type.Integer(),
  itemId: Type.String({ maxLength: 40 }),
  qty: count,
  price: Pelica,
});
export type SeizedLotView = Static<typeof SeizedLotView>;

export const ShopView = Type.Object({
  now: EpochMs,
  balance: Pelica,
  /** Teiai debt: debtors cannot buy. */
  debt: count,
  confirmFrom: count,
  items: Type.Array(ShopItem),
  market: Type.Array(MarketLotView),
  seized: Type.Array(SeizedLotView),
});
export type ShopView = Static<typeof ShopView>;

export const ShopBuyRequest = Type.Object(
  {
    ...keyed,
    itemId: Type.String({ pattern: '^[a-z0-9_]{1,40}$' }),
    qty: Type.Optional(Type.Integer({ minimum: 1, maximum: 99 })),
  },
  closed,
);
export type ShopBuyRequest = Static<typeof ShopBuyRequest>;

export const LotBuyRequest = Type.Object({ ...keyed, lotId: Type.Integer({ minimum: 1 }) }, closed);
export type LotBuyRequest = Static<typeof LotBuyRequest>;

export const ShopBuyResponse = written({
  itemId: Type.String({ maxLength: 40 }),
  price: count,
  /** Black-market lots only: how the real item compares with the one shown. */
  revealed: Type.Optional(Type.Enum(['same', 'worse', 'better'] as const)),
});
export type ShopBuyResponse = Static<typeof ShopBuyResponse>;

// ---- missions ----

export const MissionKindWire = Type.Enum([
  'play',
  'win',
  'wager',
  'streak',
  'play_game',
  'game_win',
  'tag',
  'big_win',
] as const);
export type MissionKindWire = Static<typeof MissionKindWire>;

export const MissionItem = Type.Object({
  id: Type.String({ maxLength: 64 }),
  kind: MissionKindWire,
  target: count,
  reward: count,
  progress: count,
  /** Done, and the reward is already paid (missions pay on completion; there is no claim step). */
  done: Type.Boolean(),
  /** Game the mission is about (`slots`, `blackjack`, ...), if any. */
  game: Type.Union([Type.String({ maxLength: 16 }), Type.Null()]),
  tag: Type.Union([Type.String({ maxLength: 24 }), Type.Null()]),
});
export type MissionItem = Static<typeof MissionItem>;

export const MissionsView = Type.Object({
  now: EpochMs,
  /** `YYYY-MM-DD`, the game day. */
  day: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
  /** When the roster changes (next local midnight). */
  resetAt: EpochMs,
  missions: Type.Array(MissionItem),
  /** Paid once when all missions of the day are done. */
  bonus: count,
  minBet: count,
  winStreak: count,
  bestStreak: count,
});
export type MissionsView = Static<typeof MissionsView>;

// ---- weekly ranking ----

export const RankingRow = Type.Object({
  rank: Type.Integer({ minimum: 1 }),
  userId: Snowflake,
  name: Name,
  net: Type.Integer(),
  plays: count,
  /** Could take the title: at least `minPlays` games and a profit. */
  qualified: Type.Boolean(),
});
export type RankingRow = Static<typeof RankingRow>;

export const RankingView = Type.Object({
  now: EpochMs,
  /** ISO date of the week's Monday, and of its Sunday. */
  week: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
  weekEnd: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
  /** The ranking closes at the next Monday 00:00 (game time zone). */
  endsAt: EpochMs,
  rows: Type.Array(RankingRow),
  self: Type.Union([
    Type.Object({
      rank: Type.Integer({ minimum: 1 }),
      net: Type.Integer(),
      plays: count,
      total: count,
    }),
    Type.Null(),
  ]),
  minPlays: count,
  /** The last weekly champion, who holds the title until the next announcement. */
  champion: Type.Union([
    Type.Object({
      userId: Snowflake,
      name: Name,
      week: Type.String({ maxLength: 10 }),
      net: Type.Integer(),
      wins: count,
    }),
    Type.Null(),
  ]),
});
export type RankingView = Static<typeof RankingView>;

// ---- transfer ----

export const TransferView = Type.Object({
  now: EpochMs,
  balance: Pelica,
  debt: count,
  gamesPlayed: count,
  minGames: count,
  sentToday: count,
  dailyLimit: count,
  /** Fee in basis points of the amount, paid on top by the sender. */
  feeBps: count,
  /** Amounts from here up ask for a confirmation. */
  confirmFrom: count,
  maxAmount: count,
});
export type TransferView = Static<typeof TransferView>;

export const TransferMembersQuery = Type.Object(
  { q: Type.Optional(Type.String({ maxLength: 40 })) },
  closed,
);
export type TransferMembersQuery = Static<typeof TransferMembersQuery>;
export const TransferMember = Type.Object({
  userId: Snowflake,
  name: Name,
  avatar: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
});
export type TransferMember = Static<typeof TransferMember>;
export const TransferMembers = Type.Object({ members: Type.Array(TransferMember) });
export type TransferMembers = Static<typeof TransferMembers>;

const TransferAmount = Type.Integer({ minimum: 1, maximum: 1_000_000 });

export const TransferPreviewRequest = Type.Object(
  { receiverId: Snowflake, amount: TransferAmount },
  closed,
);
export type TransferPreviewRequest = Static<typeof TransferPreviewRequest>;

/** The checks of a real send, run without moving anything. */
export const TransferPreview = Type.Union([
  Type.Object({
    ok: Type.Literal(true),
    amount: count,
    fee: count,
    /** What leaves the sender's balance: `amount + fee`. */
    total: count,
    needsConfirm: Type.Boolean(),
    /** Part of the amount the receiver's Teiai debt withholds. */
    receiverWithheld: count,
  }),
  Type.Object({
    ok: Type.Literal(false),
    rule: Type.String({ maxLength: 40 }),
    params: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()])),
  }),
]);
export type TransferPreview = Static<typeof TransferPreview>;

export const TransferSendRequest = Type.Object(
  { ...keyed, receiverId: Snowflake, amount: TransferAmount },
  closed,
);
export type TransferSendRequest = Static<typeof TransferSendRequest>;
export const TransferSendResponse = written({
  amount: count,
  fee: count,
  received: count,
  withheld: count,
});
export type TransferSendResponse = Static<typeof TransferSendResponse>;
