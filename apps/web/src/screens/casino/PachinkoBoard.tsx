import { useEffect, useState } from 'react';
import { isReducedMotionActive } from '@casino/ui';
import { useCycle, useReveal } from './anim.ts';
import { PixelScene, Pixels } from './art/PixelArt.tsx';
import {
  BALL_ART,
  BALL_PATHS,
  DIGIT_ART,
  DIGIT_XS,
  LAMP_ART,
  MACHINE_ART,
  MILL_ART,
  PACHINKO_SIZE,
  SCREEN_ART,
  TULIP_ART,
} from './art/pachinko-art.ts';
import { WinBurst } from './art/WinBurst.tsx';

/** One step of the falling balls (two physics frames). */
const BALL_MS = 60;
/** Steps a ball waits after reaching the floor before it is launched again. */
const GAP = 6;
/** Jackpot show: steps of the lamp turning and the LEDs blinking, then it holds still. */
const SHOW_STEPS = 16;
const SHOW_MS = 140;
const BALLS = 7;

/** Steps since `running` turned on, one every `ms`; 0 when off or under reduced motion. */
function useTicks(running: boolean, ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running || isReducedMotionActive()) {
      setTick(0);
      return undefined;
    }
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [running, ms]);
  return tick;
}

/** Where ball `i` is at `tick`: each loops along its path, the balls spread out in time. */
function ballAt(i: number, tick: number): [number, number] | null {
  const path = BALL_PATHS[i % BALL_PATHS.length] ?? [];
  const len = path.length / 2;
  if (len === 0) return null;
  const k = (tick * 2 + i * 9) % (len + GAP * 2);
  if (k >= len) return null;
  return [path[k * 2] ?? 0, path[k * 2 + 1] ?? 0];
}

export interface PachinkoBoardProps {
  /** Balls are flying: they fall through the pins and the reels in the display turn. */
  falling: boolean;
  /** The finished round's best hit (0 = none); null before the end of a round. */
  top: number | null;
  /** Changes with every round. */
  roundKey: string;
}

/**
 * The machine face: pins, tulips, windmills, the centre display with three digit reels, the lamp,
 * and balls falling. A hit ends on 7 7 7 with the lamp turning, the tulips open and the screen
 * flashing.
 */
export function PachinkoBoard({ falling, top, roundKey }: PachinkoBoardProps) {
  const jackpot = top !== null && top > 0;
  const tick = useTicks(falling, BALL_MS);
  const reel = useCycle(10, falling);
  const show = useReveal(jackpot ? SHOW_STEPS : null, SHOW_MS, roundKey);
  const still = show >= SHOW_STEPS;
  const lamp = jackpot ? (still ? 1 : 1 + (show % 4)) : 0;
  const flash = jackpot && (still || show % 2 === 0);
  const digits = jackpot
    ? '777'
    : falling
      ? [reel, reel + 3, reel + 7].map((d) => String(d % 10)).join('')
      : top !== null
        ? '713'
        : '735';
  const mill = falling || (jackpot && !still) ? (falling ? tick : show) % 2 : 0;
  return (
    <div className="cc-board" data-falling={falling} data-jackpot={jackpot} aria-hidden="true">
      <PixelScene w={PACHINKO_SIZE.w} h={PACHINKO_SIZE.h} className="cc-board__art">
        <Pixels sprite={MACHINE_ART} />
        <Pixels sprite={LAMP_ART[lamp] ?? MACHINE_ART} />
        {TULIP_ART.map((states, i) => {
          const s = states[jackpot ? 1 : 0];
          return s ? <Pixels key={i} sprite={s} /> : null;
        })}
        <Pixels sprite={MILL_ART[mill] ?? MACHINE_ART} />
        <Pixels sprite={SCREEN_ART[flash ? 1 : 0] ?? MACHINE_ART} />
        {[...digits].map((d, i) => {
          const art = DIGIT_ART[d];
          return art ? (
            <Pixels key={i} sprite={art} x={DIGIT_XS.xs[i] ?? 0} y={DIGIT_XS.y} />
          ) : null;
        })}
        {Array.from({ length: BALLS }, (_, i) => {
          const at = falling ? ballAt(i, tick) : null;
          return (
            <g key={i} className="cc-ball">
              {at ? <Pixels sprite={BALL_ART} x={at[0]} y={at[1]} /> : null}
            </g>
          );
        })}
        <WinBurst playKey={jackpot ? roundKey : null} x={2} y={0} />
      </PixelScene>
    </div>
  );
}
