import { Pixels } from './PixelArt.tsx';
import { CHIP_ART } from './shared-art.ts';

export type ChipColour = 'white' | 'red' | 'green' | 'blue' | 'black' | 'violet';

/** A chip colour and count for a stake, so a bigger bet stands taller and darker. */
export function chipsFor(stake: number): { colour: ChipColour; count: number } {
  const colour: ChipColour =
    stake >= 5_000
      ? 'black'
      : stake >= 1_000
        ? 'blue'
        : stake >= 500
          ? 'green'
          : stake >= 100
            ? 'red'
            : 'white';
  const count = Math.min(6, 1 + Math.floor(Math.log2(Math.max(1, stake / 50))));
  return { colour, count };
}

/** Height in art pixels of a stack of `count` chips (each chip 10 tall, 2 apart). */
export const stackHeight = (count: number) => 10 + (Math.max(1, count) - 1) * 2;

export interface ChipStackProps {
  colour: ChipColour;
  count: number;
  /** Bottom left corner of the stack in the scene. */
  x: number;
  bottom: number;
}

/** A stack of chips inside a PixelScene; the stripes turn from chip to chip. */
export function ChipStack({ colour, count, x, bottom }: ChipStackProps) {
  const frames = CHIP_ART[colour] ?? [];
  const turn = [0, 1, 2, 1, 0, 2, 1];
  return (
    <g className="cc-chips" data-count={count}>
      {Array.from({ length: count }, (_, i) => {
        const chip = frames[i === 0 ? 0 : (turn[i % turn.length] ?? 0)];
        return chip ? <Pixels key={i} sprite={chip} x={x} y={bottom - chip.h - i * 2} /> : null;
      })}
    </g>
  );
}
