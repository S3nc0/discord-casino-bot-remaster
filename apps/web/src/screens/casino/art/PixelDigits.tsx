import { rowsToPaths } from '@casino/ui';

/*
 * A 5 by 7 pixel font for numbers on badges (the roulette result and recent numbers). Each digit
 * keeps its own shape at one device pixel per art pixel: 2 has a flat base and a diagonal, 3 is
 * open on the left, 8 is two closed loops, so 2, 3 and 8 never read alike.
 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
};

/** Rows of `text` in the font, one blank column between characters. */
export function digitRows(text: string): string[] {
  const glyphs = [...text].map((c) => GLYPHS[c] ?? GLYPHS['-'] ?? []);
  return Array.from({ length: 7 }, (_, y) => glyphs.map((g) => g[y] ?? '').join('.'));
}

const CACHE = new Map<string, string>();

/** A number in the pixel font, filled with the text colour. Decoration: the reader gets words. */
export function PixelDigits({ text, className }: { text: string; className?: string }) {
  let d = CACHE.get(text);
  if (d === undefined) {
    d = rowsToPaths(digitRows(text))
      .map(([, path]) => path)
      .join('');
    CACHE.set(text, d);
  }
  const w = text.length * 6 - 1;
  return (
    <svg
      className={`cc-digits${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${w} 7`}
      style={{ ['--art-w' as string]: w, ['--art-h' as string]: 7 }}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}
