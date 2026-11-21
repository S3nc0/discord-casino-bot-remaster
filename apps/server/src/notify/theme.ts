/**
 * Embed colour roles for announcements and DMs.
 *
 * TODO(B4a/integration): B4a defines `bot/theme.ts` in parallel; unify on a single shared
 * role→hex map once bot/ and notify/ are integrated.
 */
export const EMBED_ROLES = [
  'primary',
  'secondary',
  'tertiary',
  'success',
  'warning',
  'error',
  'info',
  'gold',
  'race',
  'market',
  'bank',
  'neutral',
] as const;

export type EmbedRole = (typeof EMBED_ROLES)[number];

/** Role → 24-bit RGB hex integer, aligned with `bot/theme.ts` and Bitbloom (`design/bitbloom/tokens.css`). */
export const EMBED_ROLE_COLORS: Readonly<Record<EmbedRole, number>> = Object.freeze({
  primary: 0x00867e, // --teal-50
  secondary: 0xe76d1e, // --orange-60
  tertiary: 0xaf71fe, // --violet-60
  success: 0x31a63a, // --green-60
  warning: 0xe89b0f, // --amber-70
  error: 0xdc3a31, // --red-50
  info: 0x009cc8, // --sky-60
  gold: 0xe0c70c, // --yellow-80
  race: 0x00885b, // --emerald-50
  market: 0x0077dc, // --blue-50
  bank: 0x93000f, // --red-30
  neutral: 0x6f7979, // --neutral-50
});

/** Role → `#RRGGBB` string map (mirrors `bot/theme.ts`). */
export const EMBED_ROLE_HEX: Readonly<Record<EmbedRole, `#${string}`>> = Object.freeze({
  primary: '#00867e',
  secondary: '#e76d1e',
  tertiary: '#af71fe',
  success: '#31a63a',
  warning: '#e89b0f',
  error: '#dc3a31',
  info: '#009cc8',
  gold: '#e0c70c',
  race: '#00885b',
  market: '#0077dc',
  bank: '#93000f',
  neutral: '#6f7979',
});

export interface EmbedTheme {
  readonly colors: Readonly<Record<EmbedRole, number>>;
  color(role: EmbedRole): number;
  hex(role: EmbedRole): `#${string}`;
}

export function createEmbedTheme(overrides: Partial<Record<EmbedRole, number>> = {}): EmbedTheme {
  const colors: Record<EmbedRole, number> = { ...EMBED_ROLE_COLORS, ...overrides };
  return {
    colors,
    color: (role) => colors[role],
    hex: (role) => `#${colors[role].toString(16).padStart(6, '0')}`,
  };
}

export const defaultEmbedTheme: EmbedTheme = createEmbedTheme();
