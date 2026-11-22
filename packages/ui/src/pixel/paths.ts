/**
 * SVG path data per art character. Horizontal runs of one character become one `M x y h<n> v1 h-<n> z`,
 * so a 96 by 14 skyline stays a few hundred short segments instead of one per pixel.
 */
export function rowsToPaths(rows: readonly string[]): Array<[key: string, d: string]> {
  const byKey = new Map<string, string[]>();
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x] as string;
      let end = x + 1;
      while (end < row.length && row[end] === key) end += 1;
      if (key !== '.') {
        const run = end - x;
        const list = byKey.get(key) ?? [];
        list.push(`M${x} ${y}h${run}v1h-${run}z`);
        byKey.set(key, list);
      }
      x = end;
    }
  });
  return [...byKey].map(([key, parts]) => [key, parts.join('')]);
}
