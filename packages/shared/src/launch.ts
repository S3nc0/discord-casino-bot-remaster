import { Type, type Static } from 'typebox';
import { EpochMs, ScreenId, Snowflake } from './ids.ts';

/** How long a launch intent stays valid after the bot stores it. */
export const LAUNCH_INTENT_TTL_MS = 2 * 60 * 1000;

/**
 * POST /api/launch-intent (bot side; in-process call, the HTTP route is internal only).
 * Stored right before the bot answers an interaction with LAUNCH_ACTIVITY, so the Activity
 * opens on `screen` after auth. A newer intent for the same user and guild replaces the old one.
 */
export const LaunchIntent = Type.Object({
  userId: Snowflake,
  guildId: Snowflake,
  screen: ScreenId,
  expires: EpochMs,
});
export type LaunchIntent = Static<typeof LaunchIntent>;

export const LaunchIntentResponse = Type.Object({ ok: Type.Literal(true) });
export type LaunchIntentResponse = Static<typeof LaunchIntentResponse>;
