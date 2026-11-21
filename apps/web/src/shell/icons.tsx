import type { ScreenId } from '@casino/shared';

/** 12×12 pixel art, one string per row, `#` = filled. Same grid as the kit's own icons. */
const ART: Partial<Record<ScreenId, readonly string[]>> = {
  home: [
    '............',
    '.....##.....',
    '....####....',
    '...######...',
    '..########..',
    '.##########.',
    '.##########.',
    '.####..####.',
    '.####..####.',
    '.####..####.',
  ],
  missions: [
    '............',
    '.##..#####..',
    '.##..#####..',
    '............',
    '.##..#####..',
    '.##..#####..',
    '............',
    '.##..#####..',
    '.##..#####..',
  ],
  ranking: [
    '....####....',
    '....####....',
    '.####.##.###',
    '.####.##.###',
    '.####.##.###',
    '.####.##.###',
    '.####.##.###',
    '.####.##.###',
    '.####.##.###',
  ],
  inbox: [
    '............',
    '.##########.',
    '.###....###.',
    '.##.####.##.',
    '.##..##..##.',
    '.##.#..#.##.',
    '.##########.',
    '.##########.',
  ],
  settings: [
    '............',
    '.##########.',
    '......##....',
    '............',
    '.##########.',
    '.........##.',
    '............',
    '.##########.',
    '...##.......',
  ],
};

/** `M x y h1 v1 h-1 z` for every filled pixel. */
export function pixelPath(rows: readonly string[]): string {
  const parts: string[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === '#') parts.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return parts.join('');
}

export function NavIcon({ screen }: { screen: ScreenId }) {
  const rows = ART[screen] ?? [];
  return (
    <svg className="bb-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path fill="currentColor" d={pixelPath(rows)} />
    </svg>
  );
}

export const ICON_SCREENS = Object.keys(ART) as ScreenId[];
