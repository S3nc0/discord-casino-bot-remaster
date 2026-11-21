import { Type, type Static } from 'typebox';

/** Discord snowflake, always a decimal string (JS numbers lose precision above 2^53). */
export const Snowflake = Type.String({ pattern: '^[0-9]{17,20}$' });
export type Snowflake = Static<typeof Snowflake>;

/** Activity instance id as given by the Embedded App SDK (`discordSdk.instanceId`). */
export const InstanceId = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9_.:-]+$',
});
export type InstanceId = Static<typeof InstanceId>;

/** Milliseconds since the Unix epoch (UTC). Every timestamp on the wire uses this. */
export const EpochMs = Type.Integer({ minimum: 0 });
export type EpochMs = Static<typeof EpochMs>;

/**
 * A Pelica amount. Integer, never negative: balances cannot go below 0 (debt lives in its own
 * tables, as in the original). Signed changes use `PelicaDelta`.
 */
export const Pelica = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export type Pelica = Static<typeof Pelica>;

export const PelicaDelta = Type.Integer({
  minimum: -Number.MAX_SAFE_INTEGER,
  maximum: Number.MAX_SAFE_INTEGER,
});
export type PelicaDelta = Static<typeof PelicaDelta>;

/** A rate in basis points (1 bp = 0.01 %). Interest, fees, odds changes. Never a float. */
export const BasisPoints = Type.Integer({ minimum: -100_000_000, maximum: 100_000_000 });
export type BasisPoints = Static<typeof BasisPoints>;

/** Fixed-point scale for prices: 1 Pelica = 1_000_000 micro-Pelica. */
export const PRICE_SCALE = 1_000_000;
/** A unit price in micro-Pelica (stock prices, option strikes). */
export const PriceMicros = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export type PriceMicros = Static<typeof PriceMicros>;

/** Fixed-point scale for quantities: 1 unit = 1000 milli-units (shares can be bought in 0.001). */
export const QUANTITY_SCALE = 1000;
export const QuantityMilli = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export type QuantityMilli = Static<typeof QuantityMilli>;

/** Games a player can wager on. These count toward stats, missions and ranking. */
export const GAME_IDS = [
  'chinchiro',
  'pachinko',
  'slots',
  'blackjack',
  'roulette',
  'horse',
  'arena',
] as const;
export const GameId = Type.Enum(GAME_IDS);
export type GameId = (typeof GAME_IDS)[number];

/** Activity screens. Launch intents and rich presence point at one of these. */
export const SCREEN_IDS = [
  'home',
  ...GAME_IDS,
  'daily',
  'missions',
  'ranking',
  'transfer',
  'history',
  'inventory',
  'relics',
  'shop',
  'market',
  'stocks',
  'crypto',
  'bank',
  'loans',
  'kyosai',
  'companies',
  'work',
  'quiz',
  'lottery',
  'poll',
  'inbox',
  'profile',
  'settings',
] as const;
export const ScreenId = Type.Enum(SCREEN_IDS);
export type ScreenId = (typeof SCREEN_IDS)[number];

export function isGameId(value: string): value is GameId {
  return (GAME_IDS as readonly string[]).includes(value);
}

export function isScreenId(value: string): value is ScreenId {
  return (SCREEN_IDS as readonly string[]).includes(value);
}
