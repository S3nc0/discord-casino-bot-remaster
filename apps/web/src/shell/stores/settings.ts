import { create } from 'zustand';
import type { Locale } from '@casino/shared/i18n';

export type LanguageSetting = 'auto' | Locale;
export type ThemeSetting = 'auto' | 'light' | 'dark';

/** Per-user settings, stored on the server (see api.ts: the shared contract has no endpoint yet). */
export interface Settings {
  language: LanguageSetting;
  theme: ThemeSetting;
  sound: { enabled: boolean; sfx: number; music: number };
  animations: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'auto',
  theme: 'auto',
  sound: { enabled: true, sfx: 80, music: 50 },
  animations: true,
};

const clampVolume = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

/** Merge unknown input (server JSON) into valid settings; anything invalid falls back. */
export function parseSettings(input: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (typeof input !== 'object' || input === null) return structuredClone(d);
  const o = input as Record<string, unknown>;
  const s =
    typeof o.sound === 'object' && o.sound !== null ? (o.sound as Record<string, unknown>) : {};
  const volume = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clampVolume(v) : fallback;
  return {
    language:
      o.language === 'en' || o.language === 'ja' || o.language === 'auto' ? o.language : d.language,
    theme: o.theme === 'light' || o.theme === 'dark' || o.theme === 'auto' ? o.theme : d.theme,
    sound: {
      enabled: typeof s.enabled === 'boolean' ? s.enabled : d.sound.enabled,
      sfx: volume(s.sfx, d.sound.sfx),
      music: volume(s.music, d.sound.music),
    },
    animations: typeof o.animations === 'boolean' ? o.animations : d.animations,
  };
}

export type SettingsPatch = Partial<Omit<Settings, 'sound'>> & {
  sound?: Partial<Settings['sound']>;
};

export interface SettingsState extends Settings {
  /** True once the server copy has been applied (or failed to load and defaults are kept). */
  loaded: boolean;
  /** Bumped by every local edit; the sync controller saves when it changes. */
  revision: number;
  /** Apply the server copy. Does not count as an edit. */
  hydrate: (settings: Settings) => void;
  /** Local edit. */
  update: (patch: SettingsPatch) => void;
  snapshot: () => Settings;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  ...structuredClone(DEFAULT_SETTINGS),
  loaded: false,
  revision: 0,
  hydrate: (settings) => set({ ...structuredClone(settings), loaded: true }),
  update: (patch) =>
    set((s) => {
      const next = parseSettings({ ...s, ...patch, sound: { ...s.sound, ...patch.sound } });
      return { ...next, revision: s.revision + 1 };
    }),
  snapshot: () => {
    const { language, theme, sound, animations } = get();
    return { language, theme, sound: { ...sound }, animations };
  },
}));
