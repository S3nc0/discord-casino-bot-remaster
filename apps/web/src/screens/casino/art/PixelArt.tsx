import { memo, type CSSProperties, type ReactNode } from 'react';
import { spritePaths, type Sprite } from './sprite.ts';

/*
 * Casino scenes are SVGs on an art-pixel grid: one path per colour, filled from the palette
 * variables. The scene is drawn at a whole number of device pixels per art pixel (`--cc-px` in
 * games.css), so pixels stay crisp. Scenes are decoration: the screen states the game in words.
 */

export interface PixelsProps {
  sprite: Sprite;
  /** Where to draw it; defaults to the sprite's own place in its scene. */
  x?: number;
  y?: number;
  className?: string;
}

/** One sprite as a group of paths. */
export const Pixels = memo(function Pixels({ sprite, x, y, className }: PixelsProps) {
  const tx = x ?? sprite.x;
  const ty = y ?? sprite.y;
  return (
    <g
      className={className}
      transform={tx !== 0 || ty !== 0 ? `translate(${tx} ${ty})` : undefined}
    >
      {spritePaths(sprite).map(({ token, d }) => (
        <path key={token} d={d} style={{ fill: `var(--${token})` }} />
      ))}
    </g>
  );
});

export interface CasinoSceneProps {
  w: number;
  h: number;
  className?: string;
  children: ReactNode;
}

/** An SVG of `w` by `h` art pixels, sized by `--cc-px`. Hidden from assistive technology. */
export function CasinoScene({ w, h, className, children }: CasinoSceneProps) {
  return (
    <svg
      className={`cc-art${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${w} ${h}`}
      style={{ '--art-w': w, '--art-h': h } as CSSProperties}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
