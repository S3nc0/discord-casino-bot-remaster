import { Type, type Static } from 'typebox';
import { LOCALES } from '../i18n/locale.ts';

/**
 * User settings. **Global per user, not per guild**: they describe the person and their device
 * (language, theme, audio, motion), not their account in one guild's economy, and a player in
 * two guilds expects the same app in both. Stored in `user_settings` (keyed by `user_id`; see
 * DB_SCHEMA.md for the column mapping).
 */

/** `auto` = no explicit choice: the locale resolver falls through to client, guild, `en`. */
export const LANGUAGE_SETTINGS = ['auto', ...LOCALES] as const;
export const LanguageSetting = Type.Enum(LANGUAGE_SETTINGS);
export type LanguageSetting = (typeof LANGUAGE_SETTINGS)[number];

/** `discord` follows the Discord client theme; `light` and `dark` override it. */
export const THEME_SETTINGS = ['discord', 'light', 'dark'] as const;
export const ThemeSetting = Type.Enum(THEME_SETTINGS);
export type ThemeSetting = (typeof THEME_SETTINGS)[number];

/** Volume in percent. Integer, 0 = silent. */
export const Volume = Type.Integer({ minimum: 0, maximum: 100 });
export type Volume = Static<typeof Volume>;

export const DEFAULT_VOLUME = 30;

const closed = { additionalProperties: false } as const;

export const SoundSettings = Type.Object(
  {
    /**
     * Master switch. Even when `true`, the client keeps audio muted until the first user
     * gesture in the Activity (browser autoplay rules), then plays at the volumes below.
     */
    enabled: Type.Boolean(),
    sfxVolume: Volume,
    musicVolume: Volume,
  },
  closed,
);
export type SoundSettings = Static<typeof SoundSettings>;

/**
 * `system` follows the OS `prefers-reduced-motion`; the in-app toggle picks `full` or `reduced`
 * (non-essential animation off).
 */
export const MOTION_SETTINGS = ['system', 'full', 'reduced'] as const;
export const MotionSetting = Type.Enum(MOTION_SETTINGS);
export type MotionSetting = (typeof MOTION_SETTINGS)[number];

/** The full settings document. `GET /api/settings` returns it; `PUT /api/settings` replaces it. */
export const UserSettings = Type.Object(
  {
    language: LanguageSetting,
    theme: ThemeSetting,
    sound: SoundSettings,
    motion: MotionSetting,
  },
  closed,
);
export type UserSettings = Static<typeof UserSettings>;

/** What a user without a `user_settings` row gets. */
export const DEFAULT_USER_SETTINGS: Readonly<UserSettings> = Object.freeze({
  language: 'auto',
  theme: 'discord',
  sound: Object.freeze({ enabled: true, sfxVolume: DEFAULT_VOLUME, musicVolume: DEFAULT_VOLUME }),
  motion: 'system',
});

/** `GET /api/settings` response. */
export const SettingsResponse = UserSettings;
export type SettingsResponse = UserSettings;

/**
 * `PUT /api/settings` body: the whole document (replace, not patch; unknown keys are rejected).
 * The response is the stored document (`SettingsResponse`). The client re-resolves its locale
 * with `resolveLocale({ user: settings.language, client, guild: me.localeHints.guild })`; the
 * session token's `loc` claim keeps the old value until the next silent token refresh.
 */
export const SettingsUpdateRequest = UserSettings;
export type SettingsUpdateRequest = UserSettings;
