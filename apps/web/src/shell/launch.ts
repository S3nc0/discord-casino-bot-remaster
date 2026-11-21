import { isScreenId, type LaunchIntent, type ScreenId } from '@casino/shared';

/**
 * Screen to open after auth. The server consumed the intent for this very user and guild
 * (`POST /api/token`); the client still refuses an intent for someone else or an unknown screen
 * (an older server could add screens we do not ship) and falls back to Home.
 */
export function screenForIntent(
  intent: LaunchIntent | null | undefined,
  session: { userId: string; guildId: string },
): ScreenId {
  if (!intent) return 'home';
  if (intent.userId !== session.userId || intent.guildId !== session.guildId) return 'home';
  return isScreenId(intent.screen) ? intent.screen : 'home';
}
