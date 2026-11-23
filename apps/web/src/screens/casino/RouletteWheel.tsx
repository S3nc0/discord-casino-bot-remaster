import type { RouletteKindView } from '@casino/shared';
import { useCycle } from './anim.ts';
import { CasinoScene, Pixels } from './art/PixelArt.tsx';
import {
  BALL_ART,
  BOARD_ART,
  BOARD_CELLS,
  NUMBER_CELL,
  POCKET_ART,
  WHEEL_ART,
  WHEEL_BLUR_ART,
  WHEEL_GEOMETRY as G,
  WHEEL_ORDER,
} from './art/roulette-art.ts';
import type { Sprite } from './art/sprite.ts';
import { ChipStack, type ChipColour } from './art/ChipStack.tsx';

/** Angle of pocket index `i` (its centre): 0 at the top, clockwise. */
const angleOf = (i: number) => -Math.PI / 2 + ((i + 0.5) / WHEEL_ORDER.length) * Math.PI * 2;

/** Top left of the 5 by 5 ball: in pocket `n`, or on the track over it while the wheel turns. */
export function ballPosition(n: number, onTrack: boolean): [number, number] {
  const a = angleOf(Math.max(0, (WHEEL_ORDER as readonly number[]).indexOf(n)));
  const r = onTrack ? (G.track + G.numOut) / 2 : (G.numIn + G.pocketIn) / 2 + 0.5;
  return [Math.round(G.cx + Math.cos(a) * r - 2.5), Math.round(G.cy + Math.sin(a) * r - 2.5)];
}

/** The ball's shadow, down and right of it. */
const SHADOW: Sprite = {
  x: 0,
  y: 0,
  w: 5,
  h: 5,
  legend: 'neutral-4',
  rows: ['.....', '.....', '....!', '...!!', '..!!.'],
};

export interface RouletteWheelProps {
  /** The pocket the ball is at (or over, while moving); null = no ball yet. */
  pocket: number | null;
  moving: boolean;
  /** The winning pocket to light up, once the ball has stopped. */
  highlight: number | null;
}

/** The wheel from above: blurred while it turns, the ball on the track, then in its pocket. */
export function RouletteWheel({ pocket, moving, highlight }: RouletteWheelProps) {
  const blur = useCycle(2, moving);
  const lit = highlight !== null && !moving ? POCKET_ART[String(highlight)] : undefined;
  const ball = pocket === null ? null : ballPosition(pocket, moving);
  return (
    <CasinoScene w={G.size} h={G.size} className="cc-wheel__art">
      <Pixels sprite={WHEEL_ART} />
      {moving ? <Pixels sprite={WHEEL_BLUR_ART[blur % 2] ?? WHEEL_ART} /> : null}
      {lit ? <Pixels sprite={lit} /> : null}
      {ball ? (
        <g className="cc-wheel__marble">
          <Pixels sprite={SHADOW} x={ball[0]} y={ball[1]} />
          <Pixels sprite={BALL_ART} x={ball[0]} y={ball[1]} />
        </g>
      ) : null}
    </CasinoScene>
  );
}

/** Where a bet sits on the board: x, y, w, h of its cell. */
function cellOf(kind: RouletteKindView, number?: number): readonly number[] | null {
  if (kind === 'number') {
    if (number === undefined) return null;
    if (number === 0) return NUMBER_CELL.zero;
    const col = Math.floor((number - 1) / 3);
    const row = 2 - ((number - 1) % 3);
    return [
      NUMBER_CELL.x0 + col * NUMBER_CELL.w,
      NUMBER_CELL.y0 + row * NUMBER_CELL.h,
      NUMBER_CELL.w,
      NUMBER_CELL.h,
    ];
  }
  return (BOARD_CELLS as Readonly<Record<string, readonly number[]>>)[kind] ?? null;
}

export interface BoardChip {
  kind: RouletteKindView;
  number?: number | undefined;
  /** Placed bets are blue chips, lines still on the slip red. */
  placed: boolean;
}

/** The betting board with a chip on every line of the slip and every bet placed. */
export function RouletteBoard({ chips }: { chips: readonly BoardChip[] }) {
  return (
    <CasinoScene w={BOARD_ART.w} h={BOARD_ART.h} className="cc-rboard">
      <Pixels sprite={BOARD_ART} />
      {chips.map((c, i) => {
        const cell = cellOf(c.kind, c.number);
        if (!cell) return null;
        const [x = 0, y = 0, w = 0, h = 0] = cell;
        const colour: ChipColour = c.placed ? 'blue' : 'red';
        return (
          <ChipStack
            key={`${c.kind}-${c.number ?? ''}-${i}`}
            colour={colour}
            count={1}
            x={Math.round(x + w / 2 - 7)}
            bottom={Math.round(y + h / 2 + 5)}
          />
        );
      })}
    </CasinoScene>
  );
}
