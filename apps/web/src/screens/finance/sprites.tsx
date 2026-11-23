import type { CSSProperties } from 'react';
import type { FinanceSymbol } from '@casino/shared';
import { rowsToPaths } from '@casino/ui';
import {
  BADGE_GLYPHS,
  BADGE_RAMPS,
  BADGE_SHAPE_ROWS,
  COIN_ROWS,
  GAVEL_FRAMES,
  SPIN_FRAMES,
  SPRITE_LEGEND,
  type BadgeHue,
  type BadgeShape,
} from './art/sprites.ts';
import { Sprite } from './PixelScene.tsx';

/** The coin of one market symbol (CS chip, TEIO gear, NUMA leaf, GOLD bar), 16 art pixels. */
export function SymbolCoin({ symbol, size = 2 }: { symbol: FinanceSymbol; size?: number }) {
  const rows = (COIN_ROWS as Record<string, readonly string[]>)[symbol];
  if (!rows) return null;
  return <Sprite rows={rows} legend={SPRITE_LEGEND} size={size} className="fx-coin" />;
}

const SHAPES = Object.keys(BADGE_SHAPE_ROWS) as BadgeShape[];
const HUES = Object.keys(BADGE_RAMPS) as BadgeHue[];

/** Same name, same badge: a small stable hash of the company name picks the shape and colour. */
export function badgeLook(name: string): { shape: BadgeShape; hue: BadgeHue } {
  let h = 7;
  for (const ch of name) h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) >>> 0;
  return {
    shape: SHAPES[h % SHAPES.length] as BadgeShape,
    hue: HUES[(h >>> 2) % HUES.length] as BadgeHue,
  };
}

/** Badge paths (12 by 12 art pixels): the shape in the hue's ramp, the kind glyph on top. */
export function BadgePaths({ name, kind }: { name: string; kind: 'farm' | 'mine' }) {
  const { shape, hue } = badgeLook(name);
  const ramp = BADGE_RAMPS[hue];
  const glyph = BADGE_GLYPHS[kind];
  const gy = shape === 'crest' ? 2 : 3;
  const glyphRows = Array.from({ length: 12 }, (_, y) => {
    const g = glyph[y - gy];
    return g ? `...${g}..` : '............';
  });
  return (
    <>
      {rowsToPaths(BADGE_SHAPE_ROWS[shape]).map(([k, d]) => (
        <path key={k} d={d} style={{ fill: `var(--${ramp[Number(k)] ?? ramp[2]})` }} />
      ))}
      {rowsToPaths(glyphRows).map(([k, d]) => (
        <path
          key={`g${k}`}
          d={d}
          style={{ fill: `var(--${k === 'b' ? 'paper-99' : 'paper-96'})` }}
        />
      ))}
    </>
  );
}

/** A company's logo badge, 12 art pixels at `size` CSS px each. */
export function CompanyBadge({
  name,
  kind,
  size = 2,
}: {
  name: string;
  kind: 'farm' | 'mine';
  size?: number;
}) {
  const { shape, hue } = badgeLook(name);
  return (
    <svg
      className="fx-badge"
      width={12 * size}
      height={12 * size}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      data-shape={shape}
      data-hue={hue}
    >
      <BadgePaths name={name} kind={kind} />
    </svg>
  );
}

/** Frames stacked in one SVG; CSS shows one at a time (`.fx-frames`), the first one when still. */
function Frames({
  frames,
  size,
  className,
}: {
  frames: readonly (readonly string[])[];
  size: number;
  className: string;
}) {
  const w = frames[0]?.[0]?.length ?? 0;
  const h = frames[0]?.length ?? 0;
  return (
    <svg
      className={`fx-frames ${className}`}
      width={w * size}
      height={h * size}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      style={{ '--fx-n': frames.length } as CSSProperties}
    >
      {frames.map((rows, i) => (
        <g key={i} style={{ '--fx-i': i } as CSSProperties}>
          {rowsToPaths(rows).map(([k, d]) => (
            <path key={k} d={d} style={{ fill: `var(--${SPRITE_LEGEND[k] ?? 'neutral-50'})` }} />
          ))}
        </g>
      ))}
    </svg>
  );
}

/** A gold coin spinning (four frames), for dividends and repayments. */
export function SpinCoin({ size = 3 }: { size?: number }) {
  return <Frames frames={SPIN_FRAMES} size={size} className="fx-spin" />;
}

/** The auction gavel striking its block (two frames). */
export function Gavel({ size = 1 }: { size?: number }) {
  return <Frames frames={GAVEL_FRAMES} size={size} className="fx-gavel" />;
}
