import { triggerStaticFlash } from './confetti.ts';
import { isReducedMotionActive, type ReducedMotionFallback } from './motion.ts';

export interface ScreenShakeOptions {
  /** Maximum offset in CSS pixels (quantized to 2px art pixels). Defaults to 4. */
  intensityPx?: number;
  /** Total duration in ms. Defaults to 240. */
  durationMs?: number;
  /** Discrete step interval in ms. Defaults to 40. */
  stepMs?: number;
  /** Target element to shake. Defaults to `.bb-theme` or `document.body`. */
  target?: HTMLElement | null;
  /** Override reduced-motion detection. */
  reducedMotion?: boolean;
  /** Behaviour when reduced motion is active: 'none' (default) or 'flash'. */
  reducedFallback?: ReducedMotionFallback;
  /** Deterministic RNG for tests. */
  rng?: () => number;
}

const SHAKE_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 1],
  [1, -1],
  [-1, 0],
  [1, 1],
  [0, -1],
  [-1, -1],
];

function resolveShakeTarget(explicit?: HTMLElement | null): HTMLElement | null {
  if (explicit !== undefined) return explicit;
  if (typeof document === 'undefined') return null;
  const themed = document.querySelector('.bb-theme');
  if (themed && 'style' in themed) return themed as HTMLElement;
  return document.body ?? null;
}

function quantizeTwo(value: number): number {
  return Math.round(value / 2) * 2;
}

export function triggerScreenShake(options: ScreenShakeOptions = {}): () => void {
  const target = resolveShakeTarget(options.target);
  const reducedFallback = options.reducedFallback ?? 'none';

  if (isReducedMotionActive(options.reducedMotion)) {
    if (reducedFallback === 'flash') {
      return triggerStaticFlash({
        color: '--error',
        container: target,
        roleElement: target,
      });
    }
    return () => {};
  }

  if (!target) {
    return () => {};
  }

  const intensity = Math.max(2, quantizeTwo(options.intensityPx ?? 4));
  const durationMs = Math.max(40, options.durationMs ?? 240);
  const stepMs = Math.max(16, options.stepMs ?? 40);
  const totalSteps = Math.max(1, Math.floor(durationMs / stepMs));
  const prevTransform = target.style.transform;
  const rng = options.rng;

  let step = 0;
  let cleaned = false;

  const applyStep = () => {
    if (cleaned) return;
    if (step >= totalSteps) {
      cleanup();
      return;
    }
    const decay = 1 - step / totalSteps;
    const mag = Math.max(2, quantizeTwo(intensity * decay));
    let dx: number;
    let dy: number;
    if (rng) {
      dx = rng() >= 0.5 ? mag : -mag;
      dy = rng() >= 0.5 ? mag : -mag;
    } else {
      const pair = SHAKE_OFFSETS[step % SHAKE_OFFSETS.length] ?? [1, -1];
      dx = pair[0] * mag;
      dy = pair[1] * mag;
    }
    const base = prevTransform ? `${prevTransform} ` : '';
    target.style.transform = `${base}translate(${dx}px, ${dy}px)`;
    step++;
  };

  applyStep();

  const timer = setInterval(applyStep, stepMs);

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(timer);
    target.style.transform = prevTransform;
  };

  return cleanup;
}
