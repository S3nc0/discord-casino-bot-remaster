/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

type Buf = { w: number; h: number; px: Uint32Array };
type PixelKit = { col: (rgb: number[]) => number; load: (file: string) => Buf };

describe('app icon', async () => {
  const [{ buildIcon }, { P }, { HEX }] = (await Promise.all([
    import(pathToFileURL(join(root, 'tools/pixel-art/app-icon/build.js')).href),
    import(pathToFileURL(join(root, 'tools/pixel-art/lib/env.js')).href),
    import(pathToFileURL(join(root, 'tools/pixel-art/lib/palette.js')).href),
  ])) as [{ buildIcon: () => Buf }, { P: PixelKit }, { HEX: Record<string, string> }];

  const paletteCols = new Set<number>();
  for (const hex of Object.values(HEX)) {
    paletteCols.add(P.col([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))));
  }

  it('generates a 32x32 icon using only palette tokens', () => {
    const icon = buildIcon();
    expect(icon.w).toBe(32);
    expect(icon.h).toBe(32);
    expect(icon.px).toHaveLength(32 * 32);

    let opaque = 0;
    for (let i = 0; i < icon.px.length; i++) {
      const px = icon.px[i]!;
      if (!(px >>> 24)) continue;
      opaque++;
      expect(
        paletteCols.has(px),
        `pixel ${i % 32},${Math.floor(i / 32)} is not a palette token`,
      ).toBe(true);
    }
    expect(opaque).toBeGreaterThan(0);
  });

  it('ships matching 512, 32 and 16 PNGs and links local favicons in index.html', () => {
    const icon = buildIcon();
    const icon32 = P.load(join(root, 'apps/web/public/favicon-32.png'));
    expect([icon32.w, icon32.h]).toEqual([32, 32]);
    expect(Array.from(icon32.px)).toEqual(Array.from(icon.px));

    const icon16 = P.load(join(root, 'apps/web/public/favicon-16.png'));
    expect([icon16.w, icon16.h]).toEqual([16, 16]);
    for (const px of icon16.px) {
      if (px >>> 24) expect(paletteCols.has(px)).toBe(true);
    }

    const icon512 = P.load(join(root, 'docs/images/app-icon-512.png'));
    expect([icon512.w, icon512.h]).toEqual([512, 512]);

    const html = readFileSync(join(root, 'apps/web/index.html'), 'utf8');
    expect(html).toContain('href="/favicon-32.png"');
    expect(html).toContain('href="/favicon-16.png"');
    expect(html).not.toMatch(/https?:\/\//i);
  });
});
