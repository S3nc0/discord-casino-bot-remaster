import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cx } from './utils.ts';

export type ThemePreference = 'light' | 'dark' | 'discord';
export type ResolvedTheme = 'light' | 'dark';
export type ReducedMotionPreference = boolean | 'system' | 'reduce' | 'no-preference';

export interface ThemeContextValue {
  /** Requested theme mode: 'light', 'dark', or 'discord' (follow Discord / OS). */
  theme: ThemePreference;
  /** Effective resolved theme ('light' or 'dark'). */
  resolvedTheme: ResolvedTheme;
  /** Effective reduced-motion flag. */
  reducedMotion: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'discord',
  resolvedTheme: 'light',
  reducedMotion: false,
});

function readMediaQuery(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(query).matches;
}

function subscribeMediaQuery(query: string, onChange: (matches: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia(query);
  const handler = (event: MediaQueryListEvent) => {
    onChange(event.matches);
  };
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }
  return () => {};
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** Theme mode. Defaults to 'discord' (follow Discord / system color scheme). */
  theme?: ThemePreference;
  /** Optional explicit theme reported by Discord Embedded App SDK when theme === 'discord'. */
  discordTheme?: ResolvedTheme;
  /** App-level reduced-motion flag. True or 'reduce' forces reduced motion; false/'system'/undefined honours prefers-reduced-motion; 'no-preference' forces motion on. */
  reducedMotion?: ReducedMotionPreference;
  /** Sync data-theme and data-reduced-motion attributes onto document.documentElement (default: true). */
  syncDocument?: boolean;
  className?: string;
}

export function ThemeProvider({
  children,
  theme = 'discord',
  discordTheme,
  reducedMotion: reducedMotionProp,
  syncDocument = true,
  className,
}: ThemeProviderProps) {
  const [osDark, setOsDark] = useState<boolean>(() =>
    readMediaQuery('(prefers-color-scheme: dark)'),
  );
  const [osReducedMotion, setOsReducedMotion] = useState<boolean>(() =>
    readMediaQuery('(prefers-reduced-motion: reduce)'),
  );

  useEffect(() => {
    return subscribeMediaQuery('(prefers-color-scheme: dark)', setOsDark);
  }, []);

  useEffect(() => {
    return subscribeMediaQuery('(prefers-reduced-motion: reduce)', setOsReducedMotion);
  }, []);

  const resolvedTheme: ResolvedTheme =
    theme === 'light' || theme === 'dark' ? theme : (discordTheme ?? (osDark ? 'dark' : 'light'));

  let effectiveReducedMotion: boolean;
  if (reducedMotionProp === true || reducedMotionProp === 'reduce') {
    effectiveReducedMotion = true;
  } else if (reducedMotionProp === 'no-preference') {
    effectiveReducedMotion = false;
  } else {
    effectiveReducedMotion = osReducedMotion;
  }

  useEffect(() => {
    if (!syncDocument || typeof document === 'undefined') return;
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    const prevMotion = root.getAttribute('data-reduced-motion');

    root.setAttribute('data-theme', resolvedTheme);
    if (effectiveReducedMotion) {
      root.setAttribute('data-reduced-motion', 'true');
    } else {
      root.removeAttribute('data-reduced-motion');
    }

    return () => {
      if (prevTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', prevTheme);

      if (prevMotion === null) root.removeAttribute('data-reduced-motion');
      else root.setAttribute('data-reduced-motion', prevMotion);
    };
  }, [syncDocument, resolvedTheme, effectiveReducedMotion]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      reducedMotion: effectiveReducedMotion,
    }),
    [theme, resolvedTheme, effectiveReducedMotion],
  );

  return (
    <ThemeContext.Provider value={value}>
      <div
        className={cx('bb-theme', className)}
        data-theme={resolvedTheme}
        data-reduced-motion={effectiveReducedMotion ? 'true' : undefined}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
