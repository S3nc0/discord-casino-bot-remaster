import { useEffect, useRef, useState } from 'react';
import { isReducedMotionActive } from '@casino/ui';

/** Frame length of the tumbling dice and spinning reels (stepped, never eased). */
export const STEP_MS = 90;

const hop = (sides: number) => 1 + Math.floor(Math.random() * sides);

/**
 * Shows stand-in faces in steps, then the real ones. `key` changes with every new throw so
 * identical dice roll again. Under reduced motion the real faces show at once.
 */
export function useTumble(
  finals: readonly number[] | null,
  key: string,
  options: { steps?: number; ms?: number; sides?: number } = {},
): { faces: number[]; rolling: boolean } {
  const { steps = 7, ms = STEP_MS, sides = 6 } = options;
  const [faces, setFaces] = useState<number[]>(() => (finals ? [...finals] : []));
  const [rolling, setRolling] = useState(false);
  const latest = useRef(finals);
  latest.current = finals;
  useEffect(() => {
    const target = latest.current;
    if (!target) {
      setFaces([]);
      setRolling(false);
      return undefined;
    }
    if (isReducedMotionActive()) {
      setFaces([...target]);
      setRolling(false);
      return undefined;
    }
    let step = 0;
    setRolling(true);
    setFaces(target.map(() => hop(sides)));
    const id = setInterval(() => {
      step += 1;
      if (step >= steps) {
        clearInterval(id);
        setFaces([...target]);
        setRolling(false);
        return;
      }
      setFaces(target.map(() => hop(sides)));
    }, ms);
    return () => clearInterval(id);
  }, [key, steps, ms, sides]);
  return { faces, rolling };
}

/**
 * Counts 0..total in steps of `ms` from when `key` changes, for reveals that play one item at a
 * time. Reduced motion jumps to the end. `total === null` resets to 0.
 */
export function useReveal(total: number | null, ms: number, key: string): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (total === null || total <= 0) {
      setStep(0);
      return undefined;
    }
    if (isReducedMotionActive()) {
      setStep(total);
      return undefined;
    }
    setStep(0);
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setStep(n);
      if (n >= total) clearInterval(id);
    }, ms);
    return () => clearInterval(id);
  }, [total, ms, key]);
  return step;
}

/** The index of the item currently shown while `running`: one step every `STEP_MS`. */
export function useCycle(length: number, running: boolean): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!running || length <= 1 || isReducedMotionActive()) return undefined;
    setIndex(Math.floor(Math.random() * length));
    const id = setInterval(() => setIndex((i) => (i + 1) % length), STEP_MS);
    return () => clearInterval(id);
  }, [running, length]);
  return index;
}
