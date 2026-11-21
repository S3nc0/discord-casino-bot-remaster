import { create } from 'zustand';
import {
  DEFAULT_USER_SETTINGS,
  LANGUAGE_SETTINGS,
  MOTION_SETTINGS,
  THEME_SETTINGS,
  type SoundSettings,
  type UserSettings,
} from '@casino/shared';

const clampVolume = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

const pick = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

/** Merge unknown input (server JSON) into a valid settings document; invalid fields fall back. */
export function parseSettings(input: unknown): UserSettings {
  const d = DEFAULT_USER_SETTINGS;
  const o = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const s =
    typeof o.sound === 'object' && o.sound !== null ? (o.sound as Record<string, unknown>) : {};
  const volume = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clampVolume(v) : fallback;
  return {
    language: pick(LANGUAGE_SETTINGS, o.language, d.language),
    theme: pick(THEME_SETTINGS, o.theme, d.theme),
    sound: {
      enabled: typeof s.enabled === 'boolean' ? s.enabled : d.sound.enabled,
      sfxVolume: volume(s.sfxVolume, d.sound.sfxVolume),
      musicVolume: volume(s.musicVolume, d.sound.musicVolume),
    },
    motion: pick(MOTION_SETTINGS, o.motion, d.motion),
  };
}

export const defaultSettings = (): UserSettings => parseSettings(DEFAULT_USER_SETTINGS);

export type SettingsPatch = Partial<Omit<UserSettings, 'sound'>> & {
  sound?: Partial<SoundSettings>;
};

export interface SettingsState extends UserSettings {
  /** True once the server copy has been applied (or failed to load and defaults are kept). */
  loaded: boolean;
  /** Bumped by every local edit; the sync controller saves when it changes. */
  revision: number;
  /** Apply the server copy. Does not count as an edit. */
  hydrate: (settings: UserSettings) => void;
  /** Local edit. */
  update: (patch: SettingsPatch) => void;
  snapshot: () => UserSettings;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  ...defaultSettings(),
  loaded: false,
  revision: 0,
  hydrate: (settings) => set({ ...parseSettings(settings), loaded: true }),
  update: (patch) =>
    set((s) => {
      const next = parseSettings({ ...s, ...patch, sound: { ...s.sound, ...patch.sound } });
      return { ...next, revision: s.revision + 1 };
    }),
  snapshot: () => {
    const { language, theme, sound, motion } = get();
    return { language, theme, sound: { ...sound }, motion };
  },
}));
