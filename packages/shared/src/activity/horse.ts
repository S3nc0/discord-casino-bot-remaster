import { Type, type Static } from 'typebox';
import { EpochMs, Pelica } from '../ids.ts';
import { IdempotencyKey } from '../intents.ts';
import { ErrorCode } from '../errors.ts';

/**
 * Activity contract of the horse racing and arena screens (docs/spec/horse.md,
 * docs/spec/horse-breeding.md, docs/spec/arena.md). All routes need the session token and act on
 * the token's own user and guild. Every write carries an `idempotencyKey`: the first response is
 * stored and replayed for repeats (`replayed: true`); the same key with another body is `conflict`.
 * The client sends intents, never results.
 */
export const HORSE_ROUTES = {
  /** GET → `HorseStable`. */
  stable: '/api/horse/stable',
  /** POST `HorseCreateRequest` → `HorseWriteResponse` (spends one voucher). */
  create: '/api/horse/create',
  /** POST `HorseCarrotRequest` → `HorseWriteResponse`. */
  carrot: '/api/horse/carrot',
  /** POST `HorseGoldCarrotRequest` → `HorseWriteResponse`. */
  goldCarrot: '/api/horse/gold-carrot',
  /** POST `HorseStyleRequest` → `HorseWriteResponse`. */
  style: '/api/horse/style',
  /** POST `HorseRetireRequest` → `HorseRetireResponse`. */
  retire: '/api/horse/retire',
  /** GET (query `HorseBreedPreviewQuery`) → `HorseBreedPreview`. */
  breedPreview: '/api/horse/breed/preview',
  /** POST `HorseBreedRequest` → `HorseBreedResponse`. */
  breed: '/api/horse/breed',
  /** GET → `HorseCard`: today's races. */
  card: '/api/horse/card',
  /** GET → `HorseRaceDetail`. `:id` is the race id. */
  race: '/api/horse/races/:id',
  /** GET → `HorseTimeline` (404 until the race is done). */
  timeline: '/api/horse/races/:id/timeline',
  /** POST `HorseEntryRequest` → `HorseWriteResponse`. */
  enter: '/api/horse/races/:id/enter',
  /** POST `HorseEntryRequest` → `HorseWriteResponse`. */
  withdraw: '/api/horse/races/:id/withdraw',
  /** POST `HorseBetRequest` → `HorseBetResponse`. */
  bet: '/api/horse/races/:id/bet',
} as const;

export const ARENA_ROUTES = {
  /** GET → `ArenaToday`. */
  today: '/api/arena/today',
  /** POST `ArenaBetRequest` → `ArenaBetResponse`. */
  bet: '/api/arena/bet',
} as const;

const closed = { additionalProperties: false } as const;

// ---- catalogues the screens need (kept equal to packages/domain/race by a server test) ----

export const HORSE_STATS = ['speed', 'stamina', 'power', 'guts'] as const;
export type HorseStat = (typeof HORSE_STATS)[number];
export const HORSE_COATS = [
  '栗毛',
  '鹿毛',
  '黒鹿毛',
  '青毛',
  '芦毛',
  '白毛',
  '栃栗毛',
  '月毛',
] as const;
export const HORSE_SILKS = ['🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫'] as const;
export const HORSE_STYLES = ['nige', 'senko', 'sashi', 'oikomi'] as const;
export type HorseStyle = (typeof HORSE_STYLES)[number];
export const HORSE_BET_KINDS = [
  'win',
  'place',
  'quinella',
  'wide',
  'exacta',
  'trio',
  'trifecta',
] as const;
export type HorseBetKind = (typeof HORSE_BET_KINDS)[number];
/** Lanes a ticket needs, by kind. */
export const HORSE_PICKS_NEEDED: Readonly<Record<HorseBetKind, number>> = {
  win: 1,
  place: 1,
  quinella: 2,
  wide: 2,
  exacta: 2,
  trio: 3,
  trifecta: 3,
};
/** Kinds the screen may buy for several horses at once (one ticket each). */
export const HORSE_MULTI_KINDS: readonly HorseBetKind[] = ['win', 'place'];

export const HorseStatName = Type.Enum(HORSE_STATS);
export const HorseStyleName = Type.Enum(HORSE_STYLES);
export const HorseBetKindName = Type.Enum(HORSE_BET_KINDS);

export const HorseStats = Type.Object({
  speed: Type.Integer(),
  stamina: Type.Integer(),
  power: Type.Integer(),
  guts: Type.Integer(),
});
export type HorseStats = Static<typeof HorseStats>;

/** Numbers every screen needs next to the live state. Server values, never client constants. */
export const HorseRules = Type.Object({
  maxHorses: Type.Integer(),
  maxRaces: Type.Integer(),
  nameMax: Type.Integer(),
  entryFee: Pelica,
  breedFee: Pelica,
  minStake: Pelica,
  maxStake: Pelica,
  maxRaceStake: Pelica,
  breedMinRaces: Type.Integer(),
  maxFoals: Type.Integer(),
  breedCooldownMs: Type.Integer(),
  foalMaturityMs: Type.Integer(),
});
export type HorseRules = Static<typeof HorseRules>;

// ---- stable ----

export const HorseBreedState = Type.Object({
  ok: Type.Boolean(),
  /** The first rule that says no (`min_races`, `cooldown`, `foal_limit`, `foal_immature`, ...). */
  rule: Type.Optional(Type.String({ maxLength: 40 })),
  /** For `cooldown` and `foal_immature`: when it clears. */
  at: Type.Optional(EpochMs),
});
export type HorseBreedState = Static<typeof HorseBreedState>;

export const HorseInfo = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  name: Type.String(),
  coat: Type.String(),
  silks: Type.String(),
  stats: HorseStats,
  /** null = automatic. */
  style: Type.Union([HorseStyleName, Type.Null()]),
  autoStyle: HorseStyleName,
  races: Type.Integer(),
  wins: Type.Integer(),
  places: Type.Integer(),
  /** Pelica paid (+) or owed (-) if retired now. */
  retireValue: Type.Integer(),
  generation: Type.Integer(),
  parents: Type.Union([
    Type.Tuple([
      Type.Object({ id: Type.Integer(), name: Type.String() }),
      Type.Object({ id: Type.Integer(), name: Type.String() }),
    ]),
    Type.Null(),
  ]),
  maturesAt: Type.Union([EpochMs, Type.Null()]),
  lastBredAt: Type.Union([EpochMs, Type.Null()]),
  foalCount: Type.Integer(),
  baseValue: Pelica,
  /** Gold carrot already used. */
  goldCarrotUsed: Type.Boolean(),
  /** An open race this horse is entered in. */
  enteredRaceId: Type.Union([Type.Integer(), Type.Null()]),
  breed: HorseBreedState,
});
export type HorseInfo = Static<typeof HorseInfo>;

export const HorseItems = Type.Object({
  voucher: Type.Integer({ minimum: 0 }),
  carrot: Type.Integer({ minimum: 0 }),
  goldCarrot: Type.Integer({ minimum: 0 }),
});
export type HorseItems = Static<typeof HorseItems>;

export const HorseStable = Type.Object({
  now: EpochMs,
  balance: Pelica,
  horses: Type.Array(HorseInfo),
  items: HorseItems,
  rules: HorseRules,
  /** Horse breeding is switched off for the guild. */
  breedingEnabled: Type.Boolean(),
  /** Teiai debt blocks breeding. */
  inDebt: Type.Boolean(),
});
export type HorseStable = Static<typeof HorseStable>;

/** Every write answers with this shape (plus its own fields); `balance` is read after the write. */
export const HorseWriteResponse = Type.Object({
  replayed: Type.Boolean(),
  balance: Pelica,
  horse: Type.Optional(HorseInfo),
});
export type HorseWriteResponse = Static<typeof HorseWriteResponse>;

export const HorseCreateRequest = Type.Object(
  {
    idempotencyKey: IdempotencyKey,
    name: Type.String({ minLength: 1, maxLength: 40 }),
    coat: Type.String({ minLength: 1, maxLength: 8 }),
    silks: Type.String({ minLength: 1, maxLength: 8 }),
  },
  closed,
);
export type HorseCreateRequest = Static<typeof HorseCreateRequest>;

export const HorseCarrotRequest = Type.Object(
  {
    idempotencyKey: IdempotencyKey,
    horseId: Type.Integer({ minimum: 1 }),
    from: HorseStatName,
    to: HorseStatName,
  },
  closed,
);
export type HorseCarrotRequest = Static<typeof HorseCarrotRequest>;

export const HorseGoldCarrotRequest = Type.Object(
  {
    idempotencyKey: IdempotencyKey,
    horseId: Type.Integer({ minimum: 1 }),
    first: HorseStatName,
    second: HorseStatName,
  },
  closed,
);
export type HorseGoldCarrotRequest = Static<typeof HorseGoldCarrotRequest>;

export const HorseStyleRequest = Type.Object(
  {
    idempotencyKey: IdempotencyKey,
    horseId: Type.Integer({ minimum: 1 }),
    /** null = automatic. */
    style: Type.Union([HorseStyleName, Type.Null()]),
  },
  closed,
);
export type HorseStyleRequest = Static<typeof HorseStyleRequest>;

export const HorseRetireRequest = Type.Object(
  { idempotencyKey: IdempotencyKey, horseId: Type.Integer({ minimum: 1 }) },
  closed,
);
export type HorseRetireRequest = Static<typeof HorseRetireRequest>;

export const HorseRetireResponse = Type.Object({
  replayed: Type.Boolean(),
  balance: Pelica,
  /** Positive: paid to the owner. Negative: the fee charged (a shortfall becomes Teiai debt). */
  value: Type.Integer(),
});
export type HorseRetireResponse = Static<typeof HorseRetireResponse>;

// ---- breeding ----

export const HorseBreedPreviewQuery = Type.Object(
  {
    a: Type.String({ pattern: '^[1-9][0-9]{0,15}$' }),
    b: Type.String({ pattern: '^[1-9][0-9]{0,15}$' }),
  },
  closed,
);
export type HorseBreedPreviewQuery = Static<typeof HorseBreedPreviewQuery>;

export const HorseRange = Type.Object({ min: Type.Integer(), max: Type.Integer() });
export type HorseRange = Static<typeof HorseRange>;

/** What a foal of these two parents can look like. The real roll happens once, when paid. */
export const HorseBreedPreview = Type.Object({
  fee: Pelica,
  total: HorseRange,
  stats: Type.Object({
    speed: HorseRange,
    stamina: HorseRange,
    power: HorseRange,
    guts: HorseRange,
  }),
  /** Parents' coats first, then the chance (percent) of a random coat. */
  coats: Type.Tuple([Type.String(), Type.String()]),
  randomCoatPercent: Type.Integer(),
  generation: Type.Integer(),
  /** The breed form could be submitted now: the first rule that says no, if any. */
  eligible: HorseBreedState,
  /** Which parent the rule is about (name), when it is about one horse. */
  ruleHorse: Type.Optional(Type.String()),
  maturityMs: Type.Integer(),
});
export type HorseBreedPreview = Static<typeof HorseBreedPreview>;

export const HorseBreedRequest = Type.Object(
  {
    idempotencyKey: IdempotencyKey,
    parentA: Type.Integer({ minimum: 1 }),
    parentB: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 40 }),
    silks: Type.String({ minLength: 1, maxLength: 8 }),
  },
  closed,
);
export type HorseBreedRequest = Static<typeof HorseBreedRequest>;

export const HorseBreedResponse = Type.Object({
  replayed: Type.Boolean(),
  balance: Pelica,
  breedingId: Type.Integer(),
  fee: Pelica,
  foal: HorseInfo,
});
export type HorseBreedResponse = Static<typeof HorseBreedResponse>;

// ---- races ----

export const RACE_PHASES = [
  'upcoming',
  'entry_open',
  'entry_closed',
  'betting',
  'bet_closed',
  'done',
] as const;
export type RacePhase = (typeof RACE_PHASES)[number];

export const HorseTrack = Type.Object({ distance: Type.Integer(), going: Type.String() });
export type HorseTrack = Static<typeof HorseTrack>;

export const HorseRaceSummary = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  kind: Type.Enum(['regular', 'special']),
  major: Type.Boolean(),
  status: Type.Enum(['entry', 'betting', 'done']),
  /** Derived from the clock on the server so the screen needs no schedule maths. */
  phase: Type.Enum(RACE_PHASES),
  startAt: EpochMs,
  entryOpen: EpochMs,
  entryClose: EpochMs,
  betClose: EpochMs,
  /** Registered horses so far (before the close) or runners (after). */
  entrants: Type.Integer(),
  track: Type.Union([HorseTrack, Type.Null()]),
  /** The caller's horse entered in this race. */
  myHorse: Type.Union([Type.Object({ id: Type.Integer(), name: Type.String() }), Type.Null()]),
  /** The caller's total stake in this race. */
  myStake: Pelica,
  /** Lane numbers first to last once done. */
  placings: Type.Union([Type.Array(Type.Integer()), Type.Null()]),
});
export type HorseRaceSummary = Static<typeof HorseRaceSummary>;

export const HorseCard = Type.Object({
  now: EpochMs,
  races: Type.Array(HorseRaceSummary),
  /** Next regular start, for the "no open race" line. */
  nextStartAt: Type.Union([EpochMs, Type.Null()]),
});
export type HorseCard = Static<typeof HorseCard>;

export const HorseRunner = Type.Object({
  /** -1 until the entries close. */
  lane: Type.Integer(),
  name: Type.String(),
  silks: Type.String(),
  coat: Type.String(),
  mine: Type.Boolean(),
  npc: Type.Boolean(),
  /** null for runners of other owners before the close (only the name is public then). */
  stats: Type.Union([HorseStats, Type.Null()]),
  style: Type.Union([HorseStyleName, Type.Null()]),
  /** 1 good, 0 normal, -1 poor; null before the close. */
  form: Type.Union([Type.Integer(), Type.Null()]),
  races: Type.Integer(),
  wins: Type.Integer(),
  places: Type.Integer(),
  horseId: Type.Union([Type.Integer(), Type.Null()]),
});
export type HorseRunner = Static<typeof HorseRunner>;

export const HorseTicket = Type.Object({
  id: Type.Integer(),
  kind: HorseBetKindName,
  /** `3`, `2-4`, `4>2`, `1-3-5`, `4>2>1`. */
  key: Type.String(),
  stake: Pelica,
  oddsTenths: Type.Integer(),
  /** null until the race is settled. */
  payout: Type.Union([Pelica, Type.Null()]),
});
export type HorseTicket = Static<typeof HorseTicket>;

/** Odds table: kind → ticket key → odds in tenths (4.3x = 43). */
export const HorseOddsTable = Type.Record(
  Type.String(),
  Type.Record(Type.String(), Type.Integer()),
);
export type HorseOddsTable = Static<typeof HorseOddsTable>;

export const HorseRaceDetail = Type.Object({
  now: EpochMs,
  race: HorseRaceSummary,
  runners: Type.Array(HorseRunner),
  /** Empty until the entries close. Blended odds, fixed at purchase. */
  odds: HorseOddsTable,
  tickets: Type.Array(HorseTicket),
  /** Prize money the caller's horse earned (0 when none). */
  myPrize: Pelica,
  /** The caller's horses that could be entered right now. */
  enterable: Type.Array(Type.Integer()),
  hasTimeline: Type.Boolean(),
});
export type HorseRaceDetail = Static<typeof HorseRaceDetail>;

export const HorseTimeline = Type.Object({
  raceId: Type.Integer(),
  track: HorseTrack,
  runners: Type.Array(
    Type.Object({
      lane: Type.Integer(),
      name: Type.String(),
      silks: Type.String(),
      mine: Type.Boolean(),
    }),
  ),
  /** Progress in milli (0..1000) of every runner after each tick, same order as `runners`. */
  frames: Type.Array(Type.Array(Type.Integer())),
  /** Lanes first to last. */
  placings: Type.Array(Type.Integer()),
});
export type HorseTimeline = Static<typeof HorseTimeline>;

export const HorseEntryRequest = Type.Object(
  { idempotencyKey: IdempotencyKey, horseId: Type.Integer({ minimum: 1 }) },
  closed,
);
export type HorseEntryRequest = Static<typeof HorseEntryRequest>;

export const HorseBetRequest = Type.Object(
  {
    idempotencyKey: IdempotencyKey,
    kind: HorseBetKindName,
    lanes: Type.Array(Type.Integer({ minimum: 1, maximum: 8 }), { minItems: 1, maxItems: 3 }),
    stake: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
  },
  closed,
);
export type HorseBetRequest = Static<typeof HorseBetRequest>;

export const HorseBetResponse = Type.Object({
  replayed: Type.Boolean(),
  balance: Pelica,
  betId: Type.Integer(),
  oddsTenths: Type.Integer(),
});
export type HorseBetResponse = Static<typeof HorseBetResponse>;

// ---- arena ----

export const ARENA_FORMATS = ['duel', 'royale'] as const;
export type ArenaFormatName = (typeof ARENA_FORMATS)[number];
export const ARENA_STATUSES = ['semi_betting', 'final_betting', 'done'] as const;
export type ArenaStatusName = (typeof ARENA_STATUSES)[number];

export const ArenaFighter = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  name: Type.String(),
  basePower: Type.Integer(),
  group: Type.Integer(),
  stage: Type.Enum(['semi', 'final', 'out']),
  result: Type.Union([Type.Enum(['won', 'lost']), Type.Null()]),
  /** All bets so far, spectators included. */
  betTotal: Pelica,
  /** Weapon bonus in percent (0..100), from `betTotal`. */
  weaponPercent: Type.Integer({ minimum: 0, maximum: 100 }),
  /** Win odds of the open stage in hundredths (4.30x = 430); 0 once out. */
  oddsHundredths: Type.Integer(),
  /** The caller's stake on this fighter in the open stage. */
  myStake: Pelica,
});
export type ArenaFighter = Static<typeof ArenaFighter>;

export const ArenaMyBet = Type.Object({
  fighterId: Type.Integer(),
  stage: Type.Enum(['semi', 'final']),
  amount: Pelica,
  /** null until the stage is settled. */
  payout: Type.Union([Pelica, Type.Null()]),
});
export type ArenaMyBet = Static<typeof ArenaMyBet>;

export const ArenaTournament = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  format: Type.Enum(ARENA_FORMATS),
  day: Type.String(),
  status: Type.Enum(ARENA_STATUSES),
  championId: Type.Union([Type.Integer(), Type.Null()]),
  fighters: Type.Array(ArenaFighter),
  myBets: Type.Array(ArenaMyBet),
  /** When the semifinals and the final resolve (epoch ms). */
  semiAt: EpochMs,
  finalAt: EpochMs,
});
export type ArenaTournament = Static<typeof ArenaTournament>;

export const ArenaToday = Type.Object({
  now: EpochMs,
  balance: Pelica,
  minStake: Pelica,
  maxStake: Pelica,
  tournaments: Type.Array(ArenaTournament),
});
export type ArenaToday = Static<typeof ArenaToday>;

export const ArenaBetRequest = Type.Object(
  {
    idempotencyKey: IdempotencyKey,
    tournamentId: Type.Integer({ minimum: 1 }),
    fighterId: Type.Integer({ minimum: 1 }),
    amount: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
  },
  closed,
);
export type ArenaBetRequest = Static<typeof ArenaBetRequest>;

export const ArenaBetResponse = Type.Object({ replayed: Type.Boolean(), balance: Pelica });
export type ArenaBetResponse = Static<typeof ArenaBetResponse>;

// ---- errors ----

/**
 * Body of a failed horse or arena write: the `ApiError` fields plus the game rule that said no.
 * `rule` is a snake_case key (`bet_closed`, `stake_range`, ...) the screen shows as
 * `screen.horse.err.<rule>`; `params` fill its placeholders.
 */
export const HorseApiError = Type.Object({
  error: ErrorCode,
  retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
  rule: Type.Optional(Type.String({ maxLength: 40 })),
  params: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()]))),
});
export type HorseApiError = Static<typeof HorseApiError>;
