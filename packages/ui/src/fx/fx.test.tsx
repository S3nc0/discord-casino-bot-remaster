import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_FX_PARTICLES_DESKTOP,
  MAX_FX_PARTICLES_MOBILE,
  resolveParticleCount,
  resolveRolePalette,
  ThemeProvider,
  triggerCoinBurst,
  triggerConfetti,
  triggerScreenShake,
  useFx,
} from '../index.ts';

function mockMatchMedia(matchesMap: Record<string, boolean>) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: Boolean(matchesMap[query]),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function createMockCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 300;
  const fillStyles: string[] = [];
  const fillRect = vi.fn();
  const clearRect = vi.fn();
  const save = vi.fn();
  const restore = vi.fn();

  const ctx = {
    clearRect,
    fillRect,
    save,
    restore,
    globalAlpha: 1,
    get fillStyle() {
      return fillStyles[fillStyles.length - 1] ?? '#000';
    },
    set fillStyle(val: string) {
      fillStyles.push(val);
    },
  } as unknown as CanvasRenderingContext2D;

  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
  return { canvas, fillStyles, fillRect, clearRect };
}

describe('FX helpers & useFx', () => {
  const originalMatchMedia = window.matchMedia;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': false });
    globalThis.requestAnimationFrame = vi.fn(() => 42);
    globalThis.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-reduced-motion');
    document.documentElement.style.cssText = '';
  });

  it('caps particle count for mobile vs desktop viewports', () => {
    expect(resolveParticleCount(0, 390)).toBe(0);
    expect(resolveParticleCount(-5, 1280)).toBe(0);
    expect(resolveParticleCount(100, 375)).toBe(MAX_FX_PARTICLES_MOBILE);
    expect(resolveParticleCount(100, 640)).toBe(MAX_FX_PARTICLES_MOBILE);
    expect(resolveParticleCount(12, 375)).toBe(12);
    expect(resolveParticleCount(200, 1280)).toBe(MAX_FX_PARTICLES_DESKTOP);
  });

  it('reads palette colours from CSS role variables (including var() references)', () => {
    const el = document.createElement('div');
    el.style.setProperty('--teal-40', '#006a64');
    el.style.setProperty('--primary', 'var(--teal-40)');
    el.style.setProperty('--secondary', '#9e4200');
    el.style.setProperty('--tertiary', '#753ec4');
    document.body.appendChild(el);

    const palette = resolveRolePalette(['--primary', '--secondary', '--tertiary'], el);
    expect(palette).toEqual(['#006a64', '#9e4200', '#753ec4']);
    el.remove();
  });

  it('renders dithered pixel squares for confetti and coin bursts using role colours', () => {
    document.documentElement.style.setProperty('--primary', '#112233');
    document.documentElement.style.setProperty('--warning', '#aa8800');
    const mock = createMockCanvas();

    const stopConfetti = triggerConfetti({
      canvas: mock.canvas,
      count: 10,
      rng: () => 0.4,
    });

    expect(mock.fillRect).toHaveBeenCalled();
    expect(mock.fillStyles).toContain('#112233');
    expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
    stopConfetti();
    expect(mock.clearRect).toHaveBeenCalled();

    const coinMock = createMockCanvas();
    const stopCoins = triggerCoinBurst({
      canvas: coinMock.canvas,
      count: 6,
      rng: () => 0.5,
    });
    expect(coinMock.fillRect).toHaveBeenCalled();
    expect(coinMock.fillStyles).toContain('#aa8800');
    stopCoins();
  });

  it('applies stepped pixel offsets for screen shake and restores transform', () => {
    const target = document.createElement('div');
    target.style.transform = 'scale(1)';

    const cancel = triggerScreenShake({
      target,
      intensityPx: 4,
      durationMs: 120,
      stepMs: 40,
    });

    expect(target.style.transform).toContain('scale(1) translate(');

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(target.style.transform).toBe('scale(1)');
    cancel();
  });

  it('uses a single static flash (or nothing) and skips RAF/shake under reduced motion', () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': true });
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Default reduced-motion fallback for confetti/coinBurst is a single static flash
    const stopConfetti = triggerConfetti({ container });
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
    expect(container.querySelector('[data-bb-fx="flash"]')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelector('[data-bb-fx="flash"]')).toBeNull();
    stopConfetti();

    // Reduced-motion fallback 'none' renders nothing
    triggerCoinBurst({ container, reducedFallback: 'none' });
    expect(container.querySelector('[data-bb-fx="flash"]')).toBeNull();

    // Screen shake does not move target under reduced motion
    container.style.transform = 'none';
    triggerScreenShake({ target: container });
    expect(container.style.transform).toBe('none');

    container.remove();
  });

  it('honours ThemeProvider reducedMotion setting in useFx() and cleans up on unmount', () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': true });
    let capturedFx: ReturnType<typeof useFx> | null = null;

    function FxProbe() {
      const fx = useFx();
      capturedFx = fx;
      return <div data-testid="motion">{String(fx.reducedMotion)}</div>;
    }

    // User selected 'full' motion ('no-preference') overrides OS reduce
    const { rerender, unmount } = render(
      <ThemeProvider reducedMotion="no-preference">
        <FxProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('motion').textContent).toBe('false');

    // User selected 'reduce' forces reduced motion
    rerender(
      <ThemeProvider reducedMotion="reduce">
        <FxProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('motion').textContent).toBe('true');

    act(() => {
      capturedFx?.confetti();
    });
    expect(document.querySelector('[data-bb-fx="flash"]')).not.toBeNull();

    unmount();
    expect(document.querySelector('[data-bb-fx="flash"]')).toBeNull();
  });
});
