import { useEffect } from 'react';
import type { MotionSetting } from '@casino/shared';
import type { ReducedMotionPreference } from '@casino/ui';
import { useLocale } from './i18n.ts';

/**
 * Settings → ThemeProvider. `system` follows `prefers-reduced-motion`; the in-app choice
 * forces full or reduced motion.
 */
export function motionToReducedMotion(motion: MotionSetting): ReducedMotionPreference {
  switch (motion) {
    case 'full':
      return 'no-preference';
    case 'reduced':
      return 'reduce';
    case 'system':
      return 'system';
  }
}

/** Keeps `<html lang>` in step with the active language. */
export function useDocumentLang(): void {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
}
