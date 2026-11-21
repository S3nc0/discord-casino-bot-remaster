import { useEffect, useState } from 'react';
import type { ThemeSetting } from './stores/settings.ts';
import { useSettingsStore } from './stores/settings.ts';
import { useLocale } from './i18n.ts';

export type ResolvedTheme = 'light' | 'dark';

export function resolveTheme(setting: ThemeSetting, systemDark: boolean): ResolvedTheme {
  if (setting === 'auto') return systemDark ? 'dark' : 'light';
  return setting;
}

const QUERY = '(prefers-color-scheme: dark)';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : true;
}

/**
 * Writes theme, language and motion onto the root element. "Automatic" follows the client's
 * colour scheme (the Embedded App SDK has no theme event in this version, and the Activity
 * frame inherits the Discord client's scheme).
 */
export function useDocumentEffects(): void {
  const theme = useSettingsStore((s) => s.theme);
  const animations = useSettingsStore((s) => s.animations);
  const locale = useLocale();
  const [dark, setDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(QUERY);
    const onChange = () => setDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolveTheme(theme, dark);
    root.dataset.motion = animations ? 'full' : 'reduced';
    root.lang = locale;
  }, [theme, dark, animations, locale]);
}
