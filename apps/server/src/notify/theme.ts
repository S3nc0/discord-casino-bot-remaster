/**
 * Unified Bitbloom embed color palette for Discord chat replies, announcements, and DMs.
 * Keep every Discord embed color role mapped here so theme re-tunes are a one-file change.
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
  'dark',
] as const;

export type EmbedRole = (typeof EMBED_ROLES)[number];

/** Bitbloom token name (`design/bitbloom/tokens.json`, dark theme for themed roles) backing each role. */
export const EMBED_ROLE_TOKENS: Readonly<Record<EmbedRole, string>> = Object.freeze({
  primary: 'primary', // green-70
  secondary: 'secondary', // sky-70
  tertiary: 'tertiary', // yellow-80
  success: 'success', // green-80
  warning: 'warning', // orange-80
  error: 'error', // red-70
  info: 'secondary', // sky-70
  gold: 'tertiary', // yellow-80
  race: 'emerald-50',
  market: 'blue-50',
  bank: 'red-30',
  neutral: 'neutral-50',
  dark: 'neutral-12',
});

/** Role → 24-bit RGB hex integer, aligned with Bitbloom round 2 (`design/bitbloom/tokens.json`). */
export const EMBED_ROLE_COLORS: Readonly<Record<EmbedRole, number>> = Object.freeze({
  primary: 0x59c059, // --primary (dark: --green-70)
  secondary: 0x29b8e9, // --secondary (dark: --sky-70)
  tertiary: 0xdfc738, // --tertiary (dark: --yellow-80)
  success: 0x80db7c, // --success (dark: --green-80)
  warning: 0xf8b996, // --warning (dark: --orange-80)
  error: 0xf4907f, // --error (dark: --red-70)
  info: 0x29b8e9, // --secondary (dark: --sky-70)
  gold: 0xdfc738, // --tertiary (dark: --yellow-80)
  race: 0x328561, // --emerald-50
  market: 0x4177c7, // --blue-50
  bank: 0x72342c, // --red-30
  neutral: 0x6f778b, // --neutral-50
  dark: 0x172030, // --neutral-12
});

/** Role → `#RRGGBB` string map. */
export const EMBED_ROLE_HEX: Readonly<Record<EmbedRole, `#${string}`>> = Object.freeze({
  primary: '#59c059',
  secondary: '#29b8e9',
  tertiary: '#dfc738',
  success: '#80db7c',
  warning: '#f8b996',
  error: '#f4907f',
  info: '#29b8e9',
  gold: '#dfc738',
  race: '#328561',
  market: '#4177c7',
  bank: '#72342c',
  neutral: '#6f778b',
  dark: '#172030',
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

/** Look up the Discord embed color integer for a Bitbloom color role. */
export function embedColor(role: EmbedRole): number {
  return EMBED_ROLE_COLORS[role];
}

/** Alias kept for bot call sites. */
export const botColor = embedColor;
