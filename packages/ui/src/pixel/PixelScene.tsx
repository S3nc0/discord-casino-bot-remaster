import { useEffect, useId, useState } from 'react';
import type { ReactNode, SVGProps } from 'react';
import { useTheme } from '../ThemeProvider.tsx';
import { cx } from '../utils.ts';
import { rowsToPaths } from './paths.ts';

/**
 * A picture as row strings, one character per art pixel, `.` = empty. The legend gives every
 * character a palette token for the light theme and one for the dark theme (`neutral-10`, filled
 * as `var(--neutral-10)`), so scene data carries no colour values and follows the theme.
 */
export interface SceneArt {
  readonly w: number;
  readonly h: number;
  readonly legend: Readonly<Record<string, readonly [light: string, dark: string]>>;
  readonly frames: readonly (readonly string[])[];
}

const CACHE = new WeakMap<SceneArt, Array<ReturnType<typeof rowsToPaths>>>();

/** Path data per legend character of one frame (cached per picture). */
export function scenePaths(art: SceneArt, frame = 0): ReturnType<typeof rowsToPaths> {
  let list = CACHE.get(art);
  if (!list) {
    list = [];
    CACHE.set(art, list);
  }
  const i = Math.max(0, Math.min(art.frames.length - 1, frame));
  return (list[i] ??= rowsToPaths(art.frames[i] as readonly string[]));
}

export interface SceneLayerProps {
  art: SceneArt;
  frame?: number;
  /** Top left in the parent's art pixels. */
  x?: number;
  y?: number;
  /** Mirror left to right in place. */
  flip?: boolean;
  className?: string;
}

/** One picture as an SVG group, to stack layers inside a PixelScene. */
export function SceneLayer({ art, frame = 0, x = 0, y = 0, flip, className }: SceneLayerProps) {
  const dark = useTheme().resolvedTheme === 'dark' ? 1 : 0;
  const transform = flip
    ? `translate(${x + art.w} ${y}) scale(-1 1)`
    : x || y
      ? `translate(${x} ${y})`
      : undefined;
  return (
    <g className={className} transform={transform}>
      {scenePaths(art, frame).map(([key, d]) => (
        <path key={key} fill={`var(--${art.legend[key]?.[dark] ?? 'neutral-50'})`} d={d} />
      ))}
    </g>
  );
}

export interface PixelSceneProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> {
  art: SceneArt;
  frame?: number;
  /** CSS pixels per art pixel; whole numbers only, so pixels stay crisp. */
  scale?: number;
  /** Accessible name. Leave out for decoration. */
  label?: string;
  /** More layers on top, in art pixels (SceneLayer, or any SVG). */
  children?: ReactNode;
}

/** A pixel-art picture at a whole-number scale, with optional layers on top. */
export function PixelScene({
  art,
  frame = 0,
  scale = 1,
  label,
  className,
  children,
  ...props
}: PixelSceneProps) {
  const s = Math.max(1, Math.round(scale));
  return (
    <svg
      className={cx('bb-scene', className)}
      viewBox={`0 0 ${art.w} ${art.h}`}
      width={art.w * s}
      height={art.h * s}
      shapeRendering="crispEdges"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      focusable="false"
      {...props}
    >
      <SceneLayer art={art} frame={frame} />
      {children}
    </svg>
  );
}

export interface PixelTileProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  art: SceneArt;
  scale?: number;
}

/** A picture repeated over the whole box (turf, wallpaper). Decorative. */
export function PixelTile({ art, scale = 1, className, ...props }: PixelTileProps) {
  const id = `bb-tile-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const s = Math.max(1, Math.round(scale));
  return (
    <svg
      className={cx('bb-scene', className)}
      width="100%"
      height="100%"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <defs>
        <pattern
          id={id}
          width={art.w}
          height={art.h}
          patternUnits="userSpaceOnUse"
          patternTransform={`scale(${s})`}
        >
          <SceneLayer art={art} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** Reduced motion from the document (app setting) or the system; inline so the first bundle stays as it was. */
function reducedByDocument(): boolean {
  if (typeof document !== 'undefined') {
    if (document.documentElement?.getAttribute('data-reduced-motion') === 'true') return true;
  }
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Frame counter for a looping picture: steps every `ms` while `play` is on, and stays at 0 when
 * it is off or reduced motion is on (the still frame).
 */
export function useSceneFrame(count: number, ms: number, play = true): number {
  const { reducedMotion } = useTheme();
  const animate = play && count > 1 && !reducedMotion && !reducedByDocument();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!animate) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [animate, ms]);
  return animate ? tick % count : 0;
}
