import { isReducedMotionActive, type ReducedMotionFallback } from './motion.ts';
import {
  COIN_ROLE_VARS,
  CONFETTI_ROLE_VARS,
  resolveCssRoleColor,
  resolveRolePalette,
} from './palette.ts';

export const MOBILE_BREAKPOINT_PX = 640;
export const MAX_FX_PARTICLES_MOBILE = 28;
export const MAX_FX_PARTICLES_DESKTOP = 64;
export const DEFAULT_CONFETTI_COUNT = 48;
export const DEFAULT_COIN_BURST_COUNT = 24;

export type FxParticleKind = 'confetti' | 'coin';

export interface FlashOptions {
  /** CSS role variable name or CSS color. Defaults to '--primary'. */
  color?: string;
  /** Duration of the single static flash in ms. Defaults to 180. */
  durationMs?: number;
  /** Optional canvas to draw the static flash on instead of creating an overlay element. */
  canvas?: HTMLCanvasElement | null;
  /** Container for the overlay element when no canvas is provided. Defaults to document.body. */
  container?: HTMLElement | null;
  /** Element used for resolving CSS role variables. Defaults to container or documentElement. */
  roleElement?: Element | null;
}

export interface BurstOptions {
  /** Requested particle count (capped for mobile/desktop budgets). */
  count?: number;
  /** Origin X in CSS pixels relative to canvas/viewport (defaults to horizontal center). */
  originX?: number;
  /** Origin Y in CSS pixels relative to canvas/viewport (defaults to 40% height). */
  originY?: number;
  /** Burst duration in ms. Defaults to 1100 for confetti, 950 for coins. */
  durationMs?: number;
  /** CSS role variables to sample palette from. */
  roleVars?: readonly string[];
  /** Explicit canvas target; if omitted, creates and cleans up a fixed overlay canvas. */
  canvas?: HTMLCanvasElement | null;
  /** Container for overlay canvas/flash when no canvas is passed. Defaults to document.body. */
  container?: HTMLElement | null;
  /** Element used for reading CSS role variables. */
  roleElement?: Element | null;
  /** Override reduced motion check (defaults to ThemeProvider/DOM/OS preference). */
  reducedMotion?: boolean;
  /** Behaviour when reduced motion is active: 'flash' (default) or 'none'. */
  reducedFallback?: ReducedMotionFallback;
  /** Override viewport width for responsive particle cap calculation. */
  viewportWidth?: number;
  /** Deterministic RNG for tests. */
  rng?: () => number;
}

export type ConfettiOptions = BurstOptions;
export type CoinBurstOptions = BurstOptions;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  shadeColor: string;
  phase: number;
  spinSpeed: number;
  kind: FxParticleKind;
}

export function resolveParticleCount(requested: number, viewportWidth?: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  const width =
    viewportWidth ??
    (typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0
      ? window.innerWidth
      : 1024);
  const cap = width <= MOBILE_BREAKPOINT_PX ? MAX_FX_PARTICLES_MOBILE : MAX_FX_PARTICLES_DESKTOP;
  return Math.min(Math.floor(requested), cap);
}

function quantizePixel(value: number, step = 2): number {
  return Math.round(value / step) * step;
}

/**
 * Draw a dithered 2x2 or 3x3 pixel-art confetti square snapped to the 2px art grid.
 * As progress increases, cells drop out in a Bayer checkerboard pattern.
 */
function drawDitheredSquare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  progress: number,
  phase: number,
): void {
  const cell = Math.max(2, quantizePixel(size / 2));
  const gx = quantizePixel(x);
  const gy = quantizePixel(y);
  const blink = Math.floor(phase + progress * 6) % 2;

  ctx.fillStyle = color;
  if (progress < 0.45) {
    // Full notched/checker 2x2 pixel block
    ctx.fillRect(gx, gy, cell, cell);
    ctx.fillRect(gx + cell, gy, cell, cell);
    ctx.fillRect(gx, gy + cell, cell, cell);
    if (blink === 0) {
      ctx.fillRect(gx + cell, gy + cell, cell, cell);
    }
  } else if (progress < 0.78) {
    // 50% checkerboard dither
    if (blink === 0) {
      ctx.fillRect(gx, gy, cell, cell);
      ctx.fillRect(gx + cell, gy + cell, cell, cell);
    } else {
      ctx.fillRect(gx + cell, gy, cell, cell);
      ctx.fillRect(gx, gy + cell, cell, cell);
    }
  } else {
    // Sparse 25% tail dither
    ctx.fillRect(gx + (blink === 0 ? 0 : cell), gy, cell, cell);
  }
}

/**
 * Draw a crisp retro pixel coin (notched square with rim and center glint).
 */
function drawPixelCoin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  unit: number,
  color: string,
  glintColor: string,
  progress: number,
  phase: number,
): void {
  const u = Math.max(2, quantizePixel(unit));
  const gx = quantizePixel(x);
  const gy = quantizePixel(y);
  const flip = Math.floor(phase + progress * 8) % 2 === 0;

  ctx.fillStyle = color;
  if (flip) {
    // 3x3 notched pixel coin
    ctx.fillRect(gx + u, gy, u, u);
    ctx.fillRect(gx, gy + u, u * 3, u);
    ctx.fillRect(gx + u, gy + u * 2, u, u);
    ctx.fillStyle = glintColor;
    ctx.fillRect(gx + u, gy + u, u, u);
  } else {
    // Edge-on coin spin frame (1x3 dithered bar)
    ctx.fillRect(gx + u, gy, u, u * 3);
    ctx.fillStyle = glintColor;
    ctx.fillRect(gx + u, gy + u, u, u);
  }
}

/**
 * Render a single static flash (no continuous motion) for reduced-motion fallback.
 */
export function triggerStaticFlash(options: FlashOptions = {}): () => void {
  const durationMs = options.durationMs ?? 180;
  const rawColor = options.color ?? '--primary';
  const color = rawColor.startsWith('--')
    ? resolveCssRoleColor(rawColor, options.roleElement ?? options.container)
    : rawColor;

  if (options.canvas) {
    const canvas = options.canvas;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width || 300, canvas.height || 150);
      ctx.restore();
    }
    const timer = setTimeout(() => {
      ctx?.clearRect(0, 0, canvas.width || 300, canvas.height || 150);
    }, durationMs);
    return () => {
      clearTimeout(timer);
      ctx?.clearRect(0, 0, canvas.width || 300, canvas.height || 150);
    };
  }

  if (typeof document === 'undefined') {
    return () => {};
  }

  const host = options.container ?? document.body;
  if (!host) {
    return () => {};
  }

  const flashEl = document.createElement('div');
  flashEl.setAttribute('data-bb-fx', 'flash');
  flashEl.setAttribute('aria-hidden', 'true');
  flashEl.style.position = options.container ? 'absolute' : 'fixed';
  flashEl.style.inset = '0';
  flashEl.style.pointerEvents = 'none';
  flashEl.style.zIndex = '1100';
  flashEl.style.backgroundColor = color;
  flashEl.style.opacity = '0.22';
  host.appendChild(flashEl);

  const timer = setTimeout(() => {
    flashEl.remove();
  }, durationMs);

  return () => {
    clearTimeout(timer);
    flashEl.remove();
  };
}

function runParticleBurst(kind: FxParticleKind, options: BurstOptions): () => void {
  const reducedFallback = options.reducedFallback ?? 'flash';
  if (isReducedMotionActive(options.reducedMotion)) {
    if (reducedFallback === 'none') {
      return () => {};
    }
    const flashColorVar = kind === 'coin' ? '--warning' : '--primary';
    return triggerStaticFlash({
      color: flashColorVar,
      canvas: options.canvas,
      container: options.container,
      roleElement: options.roleElement,
    });
  }

  if (typeof document === 'undefined' && !options.canvas) {
    return () => {};
  }

  const requested =
    options.count ?? (kind === 'coin' ? DEFAULT_COIN_BURST_COUNT : DEFAULT_CONFETTI_COUNT);
  const count = resolveParticleCount(requested, options.viewportWidth);
  if (count <= 0) {
    return () => {};
  }

  let canvas = options.canvas ?? null;
  let ownsCanvas = false;

  if (!canvas) {
    const host = options.container ?? document.body;
    if (!host) return () => {};
    canvas = document.createElement('canvas');
    canvas.className = 'bb-fx-canvas';
    canvas.setAttribute('data-bb-fx', kind);
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = options.container ? 'absolute' : 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '1100';
    canvas.style.imageRendering = 'pixelated';

    const width = options.container
      ? Math.max(1, options.container.clientWidth || 320)
      : Math.max(1, typeof window !== 'undefined' ? window.innerWidth || 800 : 800);
    const height = options.container
      ? Math.max(1, options.container.clientHeight || 240)
      : Math.max(1, typeof window !== 'undefined' ? window.innerHeight || 600 : 600);
    canvas.width = width;
    canvas.height = height;

    host.appendChild(canvas);
    ownsCanvas = true;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    if (ownsCanvas) canvas.remove();
    return () => {};
  }

  const roleVars = options.roleVars ?? (kind === 'coin' ? COIN_ROLE_VARS : CONFETTI_ROLE_VARS);
  const palette = resolveRolePalette(roleVars, options.roleElement ?? options.container ?? canvas);
  const glintColor = resolveCssRoleColor(
    '--surface-container-lowest',
    options.roleElement ?? options.container ?? canvas,
  );

  const width = canvas.width || 800;
  const height = canvas.height || 600;
  const originX = options.originX ?? width / 2;
  const originY = options.originY ?? (kind === 'coin' ? height * 0.55 : height * 0.35);
  const rng = options.rng ?? Math.random;
  const durationMs = options.durationMs ?? (kind === 'coin' ? 950 : 1100);

  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = kind === 'coin' ? -Math.PI / 2 + (rng() - 0.5) * 1.4 : rng() * Math.PI * 2;
    const speed = kind === 'coin' ? 180 + rng() * 260 : 120 + rng() * 300;
    const color = palette[i % palette.length] ?? '#006a64';
    particles.push({
      x: originX + (rng() - 0.5) * 16,
      y: originY + (rng() - 0.5) * 16,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (kind === 'coin' ? 90 : 60),
      size: kind === 'coin' ? 4 : rng() > 0.5 ? 6 : 4,
      color,
      shadeColor: glintColor,
      phase: rng() * 4,
      spinSpeed: 2 + rng() * 4,
      kind,
    });
  }

  let rafId = 0;
  let cancelled = false;
  let startTime: number | null = null;
  let lastTime: number | null = null;
  const gravity = kind === 'coin' ? 760 : 540;

  const drawFrame = (now: number) => {
    if (cancelled) return;
    if (startTime === null) {
      startTime = now;
      lastTime = now;
    }
    const dt = Math.min(0.05, Math.max(0.008, (now - (lastTime ?? now)) / 1000));
    lastTime = now;
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / durationMs);

    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      p.vy += gravity * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.phase += p.spinSpeed * dt;

      if (p.kind === 'coin') {
        drawPixelCoin(ctx, p.x, p.y, p.size, p.color, p.shadeColor, progress, p.phase);
      } else {
        drawDitheredSquare(ctx, p.x, p.y, p.size, p.color, progress, p.phase);
      }
    }

    if (elapsed < durationMs) {
      rafId = requestAnimationFrame(drawFrame);
    } else {
      cleanup();
    }
  };

  const cleanup = () => {
    if (cancelled) return;
    cancelled = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    ctx.clearRect(0, 0, width, height);
    if (ownsCanvas) {
      canvas.remove();
    }
  };

  // Render an immediate first stepped frame so short tests / immediate snapshots see particles.
  drawFrame(typeof performance !== 'undefined' ? performance.now() : 0);
  if (!cancelled && typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(drawFrame);
  }

  return cleanup;
}

export function triggerConfetti(options: ConfettiOptions = {}): () => void {
  return runParticleBurst('confetti', options);
}

export function triggerCoinBurst(options: CoinBurstOptions = {}): () => void {
  return runParticleBurst('coin', options);
}
