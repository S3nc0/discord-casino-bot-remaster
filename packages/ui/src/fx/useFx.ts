import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../ThemeProvider.tsx';
import {
  triggerCoinBurst,
  triggerConfetti,
  triggerStaticFlash,
  type CoinBurstOptions,
  type ConfettiOptions,
  type FlashOptions,
} from './confetti.ts';
import { isReducedMotionActive } from './motion.ts';
import { triggerScreenShake, type ScreenShakeOptions } from './shake.ts';

export interface UseFxOptions {
  /** Default container element for overlay bursts/flashes. */
  container?: HTMLElement | null;
  /** Default target element for screen shake. */
  target?: HTMLElement | null;
  /** Default canvas element for particle bursts. */
  canvas?: HTMLCanvasElement | null;
  /** Explicit reduced-motion override. */
  reducedMotion?: boolean;
}

export interface UseFxResult {
  reducedMotion: boolean;
  confetti: (options?: ConfettiOptions) => () => void;
  coinBurst: (options?: CoinBurstOptions) => () => void;
  shake: (options?: ScreenShakeOptions) => () => void;
  flash: (options?: FlashOptions) => () => void;
  clearAll: () => void;
}

function hasActiveThemeProvider(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    document.documentElement?.hasAttribute('data-theme') ||
    (typeof document.querySelector === 'function' && document.querySelector('.bb-theme') !== null)
  );
}

export function useFx(defaults: UseFxOptions = {}): UseFxResult {
  const { reducedMotion: themeReducedMotion } = useTheme();
  const cleanupsRef = useRef<Set<() => void>>(new Set());
  const [usingThemeProvider, setUsingThemeProvider] = useState<boolean>(() =>
    hasActiveThemeProvider(),
  );
  const [osReducedMotion, setOsReducedMotion] = useState<boolean>(() => isReducedMotionActive());

  useEffect(() => {
    const active = hasActiveThemeProvider();
    setUsingThemeProvider(active);
    if (active || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setOsReducedMotion(mql.matches);
    const handler = (event: MediaQueryListEvent) => {
      setOsReducedMotion(event.matches);
    };
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    return undefined;
  }, [themeReducedMotion]);

  const reducedMotion =
    defaults.reducedMotion !== undefined
      ? defaults.reducedMotion
      : usingThemeProvider
        ? themeReducedMotion
        : themeReducedMotion || osReducedMotion;

  const registerCleanup = useCallback((cleanup: () => void): (() => void) => {
    const wrapped = () => {
      cleanupsRef.current.delete(wrapped);
      cleanup();
    };
    cleanupsRef.current.add(wrapped);
    return wrapped;
  }, []);

  const clearAll = useCallback(() => {
    const active = [...cleanupsRef.current];
    cleanupsRef.current.clear();
    for (const fn of active) {
      fn();
    }
  }, []);

  useEffect(() => clearAll, [clearAll]);

  const confetti = useCallback(
    (options: ConfettiOptions = {}) => {
      const cleanup = triggerConfetti({
        container: defaults.container,
        canvas: defaults.canvas,
        reducedMotion,
        ...options,
      });
      return registerCleanup(cleanup);
    },
    [defaults.container, defaults.canvas, reducedMotion, registerCleanup],
  );

  const coinBurst = useCallback(
    (options: CoinBurstOptions = {}) => {
      const cleanup = triggerCoinBurst({
        container: defaults.container,
        canvas: defaults.canvas,
        reducedMotion,
        ...options,
      });
      return registerCleanup(cleanup);
    },
    [defaults.container, defaults.canvas, reducedMotion, registerCleanup],
  );

  const shake = useCallback(
    (options: ScreenShakeOptions = {}) => {
      const cleanup = triggerScreenShake({
        target: defaults.target,
        reducedMotion,
        ...options,
      });
      return registerCleanup(cleanup);
    },
    [defaults.target, reducedMotion, registerCleanup],
  );

  const flash = useCallback(
    (options: FlashOptions = {}) => {
      const cleanup = triggerStaticFlash({
        container: defaults.container,
        canvas: defaults.canvas,
        ...options,
      });
      return registerCleanup(cleanup);
    },
    [defaults.container, defaults.canvas, registerCleanup],
  );

  return useMemo(
    () => ({
      reducedMotion,
      confetti,
      coinBurst,
      shake,
      flash,
      clearAll,
    }),
    [reducedMotion, confetti, coinBurst, shake, flash, clearAll],
  );
}
