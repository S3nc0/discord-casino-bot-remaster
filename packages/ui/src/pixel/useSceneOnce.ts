import { useEffect, useRef, useState } from 'react';
import { isReducedMotionActive } from '../fx/motion.ts';
import { useTheme } from '../ThemeProvider.tsx';

export interface SceneOnceOptions {
  /** Frames to play, in order, for example `[1, 2, 3]`. */
  frames: readonly number[];
  /** Milliseconds per frame. */
  ms: number;
  /** Plays again each time this value changes. */
  trigger?: unknown;
  /** The still frame: shown before and after a play, and the only one under reduced motion. */
  rest?: number;
  /** Also play on the first render (an effect that appears with its component). */
  onMount?: boolean;
}

/**
 * The frame of a picture that plays once on demand (an answer effect, a gift opening, a letter
 * flying) and then rests on its still frame. Reduced motion shows only the still frame.
 */
export function useSceneOnce({
  frames,
  ms,
  trigger,
  rest = 0,
  onMount = false,
}: SceneOnceOptions): number {
  const { reducedMotion } = useTheme();
  const still = reducedMotion || isReducedMotionActive();
  const [frame, setFrame] = useState(onMount && !still ? (frames[0] ?? rest) : rest);
  const first = useRef(true);
  const plan = useRef({ frames, ms, rest, still });
  plan.current = { frames, ms, rest, still };
  useEffect(() => {
    const p = plan.current;
    const skip = first.current && !onMount;
    first.current = false;
    if (skip) return undefined;
    if (p.still) {
      setFrame(p.rest);
      return undefined;
    }
    const steps = [...p.frames, p.rest];
    const ids = steps.map((f, i) => setTimeout(() => setFrame(f), i * p.ms));
    return () => ids.forEach(clearTimeout);
  }, [trigger, onMount]);
  return frame;
}
