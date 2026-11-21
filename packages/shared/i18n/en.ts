/**
 * English messages. This file defines the key set; ja.ts must have exactly the same keys
 * (checked by the compiler and by `pnpm i18n:check`). Keys are flat and dotted.
 * Placeholders use `{name}` and must match across languages.
 */
export const en = {
  'app.name': 'Discord Casino Remaster',
  'currency.name': 'Pelica',
  'currency.amount': '{amount} Pelica',
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.loading': 'Loading…',
  'launch.openInActivity': 'Open in Activity',
  'settings.language': 'Language',
  'settings.sound': 'Sound',
  'settings.motion': 'Animations',
  'error.unauthorized': 'Your session ended. Please open the app again.',
  'error.forbidden': 'You cannot do that.',
  'error.guild_not_allowed': 'This server is not allowed to use the casino.',
  'error.guild_pending': 'This server is waiting for approval.',
  'error.invalid_payload': 'That request was not valid.',
  'error.rate_limited': 'Too fast. Try again in a moment.',
  'error.insufficient_funds': 'You do not have enough Pelica.',
  'error.feature_disabled': 'This feature is turned off on this server.',
  'error.not_found': 'Not found.',
  'error.conflict': 'That changed in the meantime. Please try again.',
  'error.in_flight': 'Still working on your last request.',
  'error.expired': 'This has expired.',
  'error.game_busy': 'The table is busy. Try again in a moment.',
  'error.internal': 'Something went wrong. Please try again.',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = { readonly [K in MessageKey]: string };
