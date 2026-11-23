import { isReducedMotionActive } from '@casino/ui';
import { useReveal } from '../anim.ts';
import { BURST_ART } from './shared-art.ts';
import { Pixels } from './PixelArt.tsx';

/** Burst frame length; it plays once. */
const BURST_MS = 70;
/** The frame shown still under reduced motion. */
const STILL = 3;

export interface WinBurstProps {
  /** Changes for each win; null = nothing to show. */
  playKey: string | null;
  /** Top left corner in the scene (the burst is 48 by 48). */
  x: number;
  y: number;
}

/**
 * The win burst, inside a CasinoScene: eight frames once, then gone. Under reduced motion one
 * still frame stays while the win is shown.
 */
export function WinBurst({ playKey, x, y }: WinBurstProps) {
  const frames = BURST_ART.length;
  const step = useReveal(playKey === null ? null : frames, BURST_MS, playKey ?? 'none');
  if (playKey === null) return null;
  const sprite = isReducedMotionActive() ? BURST_ART[STILL] : BURST_ART[step];
  return sprite ? <Pixels sprite={sprite} x={x} y={y} className="cc-burst" /> : null;
}
