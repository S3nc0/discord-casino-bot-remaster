/**
 * Bitbloom embed color palette for Discord chat embeds.
 * Keep every bot color role mapped here so theme re-tunes are a one-file change.
 */
export const BOT_THEME_COLORS = {
  primary: 0x00867e, // --teal-50
  secondary: 0xe76d1e, // --orange-60
  tertiary: 0xaf71fe, // --violet-60
  info: 0x009cc8, // --sky-60
  success: 0x31a63a, // --green-60
  warning: 0xe89b0f, // --amber-70
  error: 0xdc3a31, // --red-50
  gold: 0xe0c70c, // --yellow-80
  neutral: 0x6f7979, // --neutral-50
  dark: 0x192121, // --neutral-12
} as const;

export type BotColorRole = keyof typeof BOT_THEME_COLORS;

/** Look up the Discord embed color integer for a Bitbloom color role. */
export function botColor(role: BotColorRole): number {
  return BOT_THEME_COLORS[role];
}
