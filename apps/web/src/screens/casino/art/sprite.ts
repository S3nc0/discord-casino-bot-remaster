import { rowsToPaths } from '@casino/ui';

/**
 * A piece of casino art: row strings, one character per art pixel, `.` = empty. `legend` names
 * the palette token of each character in CHARS order, so the colours come from the theme's
 * variables and nothing here carries a colour value. `x` and `y` place it in its scene.
 */
export interface Sprite {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly legend: string;
  readonly rows: readonly string[];
}

/** The characters a legend counts through (printable ASCII without space, `.`, quotes, `\`). */
export const CHARS = [...Array(95).keys()]
  .map((i) => String.fromCharCode(32 + i))
  .filter((c) => !' .\'"\\`'.includes(c))
  .join('');

export interface SpritePath {
  token: string;
  d: string;
}

const PATHS = new WeakMap<Sprite, SpritePath[]>();

/** One SVG path per colour of the sprite, cached. */
export function spritePaths(sprite: Sprite): SpritePath[] {
  let paths = PATHS.get(sprite);
  if (!paths) {
    const tokens = sprite.legend.split(' ');
    paths = rowsToPaths(sprite.rows).map(([key, d]) => ({
      token: tokens[CHARS.indexOf(key)] ?? 'neutral-50',
      d,
    }));
    PATHS.set(sprite, paths);
  }
  return paths;
}

/** The sprite squeezed to `w` columns about its middle (nearest column), for a card turning. */
export function squeeze(sprite: Sprite, w: number): Sprite {
  const x0 = Math.round((sprite.w - w) / 2);
  const rows = sprite.rows.map((row) => {
    let out = '.'.repeat(x0);
    for (let x = 0; x < w; x++)
      out += row[Math.min(sprite.w - 1, Math.floor(((x + 0.5) / w) * sprite.w))] ?? '.';
    return out.padEnd(sprite.w, '.');
  });
  return { ...sprite, rows };
}
