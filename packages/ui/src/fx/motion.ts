export type ReducedMotionFallback = 'flash' | 'none';

/**
 * Resolve whether reduced motion is active.
 * Explicit boolean wins; otherwise honours `[data-reduced-motion="true"]`
 * (set by ThemeProvider from UserSettings.motion) and `(prefers-reduced-motion: reduce)`.
 */
export function isReducedMotionActive(explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') {
    return explicit;
  }
  if (typeof document !== 'undefined') {
    const rootAttr = document.documentElement?.getAttribute('data-reduced-motion');
    if (rootAttr === 'true') {
      return true;
    }
    if (
      typeof document.querySelector === 'function' &&
      document.querySelector('[data-reduced-motion="true"]')
    ) {
      return true;
    }
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return false;
}
