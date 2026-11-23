import { PixelScene, rowsToPaths, SceneLayer } from '@casino/ui';
import { coatKey, silksKey } from './format.ts';
import {
  PADDOCK_BACK,
  PADDOCK_FRONT,
  PADDOCK_HEADS,
  PORTRAIT_HEIGHT,
  PORTRAIT_ROWS,
  PORTRAIT_WIDTH,
  STALL_BACK,
  STALL_FRONT,
  STALL_HEAD,
} from './stable-art.ts';

/*
 * Horse head portraits in a stall (stable) and over a paddock fence (breeding). The portrait uses
 * the roles of the race sprite, so the coat and silks classes of horse.css colour it; the scenery
 * follows the theme (day in light, night in dark). Decorative: the card text names the horse.
 */
const PATHS = rowsToPaths(PORTRAIT_ROWS);

interface Horse {
  coat: string;
  silks: string;
}

function Portrait({ coat, silks, x = 0, y = 0 }: Horse & { x?: number; y?: number }) {
  return (
    <g
      className={`hr-portrait hr-coat-${coatKey(coat)} hr-silks-${silksKey(silks)}`}
      transform={x || y ? `translate(${x} ${y})` : undefined}
    >
      {PATHS.map(([key, d]) => (
        <path key={key} className={`hr-px-${key}`} d={d} />
      ))}
    </g>
  );
}

/** The horse looking out over the door of its stall, 2 CSS px per art pixel. */
export function StallScene({ coat, silks }: Horse) {
  return (
    <PixelScene art={STALL_BACK} scale={2} className="hr-stall">
      <Portrait coat={coat} silks={silks} x={STALL_HEAD.x} y={STALL_HEAD.y} />
      <SceneLayer art={STALL_FRONT} />
    </PixelScene>
  );
}

/** Two horses side by side over the paddock fence, 2 CSS px per art pixel. */
export function PaddockScene({ a, b }: { a: Horse; b: Horse }) {
  return (
    <PixelScene art={PADDOCK_BACK} scale={2} className="hr-paddock">
      <Portrait {...a} x={PADDOCK_HEADS.left.x} y={PADDOCK_HEADS.left.y} />
      <Portrait {...b} x={PADDOCK_HEADS.right.x} y={PADDOCK_HEADS.right.y} />
      <SceneLayer art={PADDOCK_FRONT} />
    </PixelScene>
  );
}

/** The head portrait alone, 1 CSS px per art pixel (foal list). */
export function HorsePortrait({ coat, silks }: Horse) {
  return (
    <svg
      className="hr-portrait-icon"
      viewBox={`0 0 ${PORTRAIT_WIDTH} ${PORTRAIT_HEIGHT}`}
      width={PORTRAIT_WIDTH}
      height={PORTRAIT_HEIGHT}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <Portrait coat={coat} silks={silks} />
    </svg>
  );
}
