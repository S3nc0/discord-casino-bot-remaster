import { DEFAULT_USER_SETTINGS, type Clock, type UserSettings } from '@casino/shared';
import type { Store } from './store.ts';

interface SettingsRow {
  locale: 'en' | 'ja' | null;
  sound: number;
  sfx_volume: number;
  music_volume: number;
  motion: UserSettings['motion'];
  theme: UserSettings['theme'];
}

/** `user_settings` ↔ the `UserSettings` wire document. Global per user. */
export class SettingsRepo {
  private readonly store: Store;
  private readonly clock: Clock;

  constructor(store: Store, clock: Clock) {
    this.store = store;
    this.clock = clock;
  }

  /** The stored document, or the defaults for a user without a row. */
  get(userId: string): UserSettings {
    const row = this.store
      .stmt(
        'SELECT locale, sound, sfx_volume, music_volume, motion, theme FROM user_settings WHERE user_id = ?',
      )
      .get(userId) as SettingsRow | undefined;
    if (!row) return structuredClone(DEFAULT_USER_SETTINGS) as UserSettings;
    return {
      language: row.locale ?? 'auto',
      theme: row.theme,
      sound: {
        enabled: row.sound === 1,
        sfxVolume: row.sfx_volume,
        musicVolume: row.music_volume,
      },
      motion: row.motion,
    };
  }

  /** Replace the whole document (upsert). `dm_digest` is not part of it and is kept. */
  put(userId: string, settings: UserSettings): UserSettings {
    this.store
      .stmt(
        `INSERT INTO user_settings (user_id, locale, sound, sfx_volume, music_volume, motion, theme, updated_at)
         VALUES (@userId, @locale, @sound, @sfx, @music, @motion, @theme, @at)
         ON CONFLICT (user_id) DO UPDATE SET
           locale = excluded.locale, sound = excluded.sound, sfx_volume = excluded.sfx_volume,
           music_volume = excluded.music_volume, motion = excluded.motion, theme = excluded.theme,
           updated_at = excluded.updated_at`,
      )
      .run({
        userId,
        locale: settings.language === 'auto' ? null : settings.language,
        sound: settings.sound.enabled ? 1 : 0,
        sfx: settings.sound.sfxVolume,
        music: settings.sound.musicVolume,
        motion: settings.motion,
        theme: settings.theme,
        at: this.clock.now(),
      });
    return this.get(userId);
  }
}
