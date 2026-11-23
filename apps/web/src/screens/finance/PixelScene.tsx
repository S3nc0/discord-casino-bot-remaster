import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { rowsToPaths, useTheme } from '@casino/ui';

/** A few frames that replace one rectangle of a scene (art pixels). */
export interface FrameSet {
  x: number;
  y: number;
  w: number;
  h: number;
  frames: readonly (readonly string[])[];
}

/** Scene art: rows of characters, each naming a [light theme, dark theme] pair of palette tokens. */
export interface SceneArt {
  w: number;
  h: number;
  rows: readonly string[];
  legend: Readonly<Record<string, readonly string[]>>;
  anim?: FrameSet;
}

type Paths = Array<[token: string, d: string]>;
const CACHE = new WeakMap<readonly string[], [Paths, Paths]>();

/** Path data per palette token for the light set and the dark set of one block of rows. */
function themed(rows: readonly string[], legend: SceneArt['legend']): [Paths, Paths] {
  const hit = CACHE.get(rows);
  if (hit) return hit;
  const sets: [Map<string, string>, Map<string, string>] = [new Map(), new Map()];
  for (const [key, d] of rowsToPaths(rows)) {
    const pair = legend[key];
    if (!pair) continue;
    pair.forEach((token, i) => {
      const set = sets[i as 0 | 1];
      set.set(token, (set.get(token) ?? '') + d);
    });
  }
  const out: [Paths, Paths] = [[...sets[0]], [...sets[1]]];
  CACHE.set(rows, out);
  return out;
}

/** One block of scene rows, drawn twice: the light set and the dark set (CSS shows one). */
export function ArtLayer({
  rows,
  legend,
  x = 0,
  y = 0,
}: {
  rows: readonly string[];
  legend: SceneArt['legend'];
  x?: number;
  y?: number;
}) {
  const [day, night] = themed(rows, legend);
  return (
    <g transform={x || y ? `translate(${x} ${y})` : undefined}>
      <g className="fx-day">
        {day.map(([token, d]) => (
          <path key={token} d={d} style={{ fill: `var(--${token})` }} />
        ))}
      </g>
      <g className="fx-night">
        {night.map(([token, d]) => (
          <path key={token} d={d} style={{ fill: `var(--${token})` }} />
        ))}
      </g>
    </g>
  );
}

/** Sprite rows with one palette token per character (the same in both themes). */
export function Sprite({
  rows,
  legend,
  size,
  className,
  style,
}: {
  rows: readonly string[];
  legend: Readonly<Record<string, string>>;
  /** CSS size of one art pixel, e.g. 2 for a 16 by 16 sprite at 32 px. */
  size: number;
  className?: string;
  style?: CSSProperties;
}) {
  const w = rows[0]?.length ?? 0;
  const h = rows.length;
  return (
    <svg
      className={['fx-sprite', className].filter(Boolean).join(' ')}
      width={w * size}
      height={h * size}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      {rowsToPaths(rows).map(([key, d]) => (
        <path key={key} d={d} style={{ fill: `var(--${legend[key] ?? 'neutral-50'})` }} />
      ))}
    </svg>
  );
}

/** True when motion should stop: the player's setting or the system's. */
export function useStill(): boolean {
  const { reducedMotion } = useTheme();
  return reducedMotion;
}

/**
 * Steps through `seq` (frame indexes, -1 = the still scene) every `ms`. `trigger` starts a play:
 * 'loop' repeats forever, a number plays once each time it changes (0 = not yet). Under reduced
 * motion the still scene stays.
 */
export function usePlayback(seq: readonly number[], ms: number, trigger: number | 'loop'): number {
  const still = useStill();
  const [frame, setFrame] = useState(-1);
  useEffect(() => {
    if (still || trigger === 0) {
      setFrame(-1);
      return;
    }
    let i = 0;
    setFrame(seq[0] ?? -1);
    const timer = setInterval(() => {
      i += 1;
      if (i >= seq.length) {
        if (trigger !== 'loop') {
          clearInterval(timer);
          setFrame(-1);
          return;
        }
        i = 0;
      }
      setFrame(seq[i] ?? -1);
    }, ms);
    return () => clearInterval(timer);
    // seq is a module constant at every call site
  }, [trigger, still, ms]);
  return frame;
}

/**
 * A pixel-art scene across the top of a screen: 3 CSS px per art pixel (4 on wide screens),
 * centred and cropped at the sides on narrow phones. `frame` shows one of the art's animation
 * frames over the still scene; `children` are more SVG layers in art pixels; `overlay` is HTML
 * placed with `artBox`. Decorative: the same facts are in the text below it.
 */
export function PixelScene({
  art,
  name,
  frame = -1,
  children,
  overlay,
  flash,
}: {
  art: SceneArt;
  name: string;
  frame?: number;
  children?: ReactNode;
  overlay?: ReactNode;
  /** Flash the frame once each time `n` goes up: green after a buy, gold after a sale. */
  flash?: { n: number; tone: 'buy' | 'sell' } | undefined;
}) {
  const anim = art.anim;
  const rows = anim && frame >= 0 ? anim.frames[frame] : undefined;
  return (
    <div
      className="fx-scene"
      data-scene={name}
      aria-hidden="true"
      style={{ '--fx-w': art.w, '--fx-h': art.h } as CSSProperties}
    >
      <div className="fx-scene__stage">
        <svg
          className="fx-scene__art"
          viewBox={`0 0 ${art.w} ${art.h}`}
          shapeRendering="crispEdges"
          focusable="false"
        >
          <ArtLayer rows={art.rows} legend={art.legend} />
          {anim && rows ? <ArtLayer rows={rows} legend={art.legend} x={anim.x} y={anim.y} /> : null}
          {children}
        </svg>
        {overlay}
      </div>
      {flash && flash.n > 0 ? (
        <span key={flash.n} className="fx-flash" data-tone={flash.tone} />
      ) : null}
    </div>
  );
}

/** Position HTML over a scene in art pixels. */
export function artBox(x: number, y: number, w?: number, h?: number): CSSProperties {
  const u = (n: number) => `calc(${n} * var(--fx-px))`;
  return {
    left: u(x),
    top: u(y),
    ...(w === undefined ? {} : { width: u(w) }),
    ...(h === undefined ? {} : { height: u(h) }),
  };
}
