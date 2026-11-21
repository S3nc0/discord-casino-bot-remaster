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

/** A Pelica amount. Integer, never negative. Signed changes use `PelicaDelta`. */
export const Pelica = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export type Pelica = Static<typeof Pelica>;

export const PelicaDelta = Type.Integer({
  minimum: -Number.MAX_SAFE_INTEGER,
  maximum: Number.MAX_SAFE_INTEGER,
});
export type PelicaDelta = Static<typeof PelicaDelta>;

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
  'shop',
  'market',
  'stocks',
  'bank',
  'loans',
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
