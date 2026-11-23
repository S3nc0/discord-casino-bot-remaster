import { Pixels } from './art/PixelArt.tsx';
import { DIE_ART, DIE_ONE_ART, DIE_PIPS, TUMBLE_ART } from './art/chinchiro-art.ts';

export interface DieProps {
  /** 1..6; anything else is a die not thrown yet (lying askew, no face up). */
  face: number;
  /** Tumbling: the die turns in the air (`face` picks the tumble frame). */
  rolling?: boolean;
  /** Top left corner in the seat scene. */
  x: number;
  y: number;
}

/**
 * A 17 by 17 pixel die inside the bowl scene. At rest it is the die with hand-placed pips (each
 * pip is one `cc-die__pip`; the 1 is red, as dice are in Japan); rolling, a tumble frame.
 */
export function Die({ face, rolling = false, x, y }: DieProps) {
  if (rolling || !(face >= 1 && face <= 6)) {
    const frame = TUMBLE_ART[(Math.abs(face) + x) % TUMBLE_ART.length] ?? DIE_ART;
    return (
      <g
        className={`cc-die${rolling ? ' cc-die--rolling' : ''}`}
        transform={`translate(${x} ${y})`}
      >
        <Pixels sprite={frame} />
      </g>
    );
  }
  const pips = DIE_PIPS[face] ?? [];
  return (
    <g className="cc-die" transform={`translate(${x} ${y})`}>
      <Pixels sprite={DIE_ART} />
      {face === 1 ? <Pixels sprite={DIE_ONE_ART} className="cc-die__pip" /> : null}
      {pips.map(([px, py]) => (
        <rect key={`${px}-${py}`} className="cc-die__pip" x={px} y={py} width={2} height={2} />
      ))}
    </g>
  );
}
