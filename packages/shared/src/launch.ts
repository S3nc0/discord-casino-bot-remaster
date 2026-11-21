import { Type, type Static } from 'typebox';
import { EpochMs, ScreenId, Snowflake } from './ids.ts';

/** How long a launch intent stays valid after the bot stores it. */
export const LAUNCH_INTENT_TTL_MS = 2 * 60 * 1000;

/**
 * Screen to open after auth, stored right before the bot answers an interaction with
 * LAUNCH_ACTIVITY. A newer intent for the same user and guild replaces the old one.
 */
export const LaunchIntent = Type.Object(
  {
    userId: Snowflake,
    guildId: Snowflake,
    screen: ScreenId,
    expires: EpochMs,
  },
  { additionalProperties: false },
);
export type LaunchIntent = Static<typeof LaunchIntent>;

/**
 * In-process service only. There is no HTTP route for creating launch intents: the bot calls
 * `create` directly, and `POST /api/token` calls `consume` for the session's own user and guild.
 */
export interface LaunchIntentService {
  /** Store (or replace) the intent; `expires` = now + LAUNCH_INTENT_TTL_MS. */
  create(input: { userId: string; guildId: string; screen: ScreenId }): LaunchIntent;
  /** Return and mark consumed the unexpired intent of exactly this user in this guild. */
  consume(userId: string, guildId: string): LaunchIntent | null;
}
