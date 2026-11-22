/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GAME_ICON_NAMES, GAME_ICON_ROWS, SKYLINE_COLUMNS, SKYLINE_ROWS } from './art.ts';
import { GameIcon } from './GameIcon.tsx';
import { rowsToPaths } from './paths.ts';
import { Skyline } from './Skyline.tsx';
import { Sparkle } from './Sparkle.tsx';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../styles/bundle.css'),
  'utf8',
);

describe('pixel art data', () => {
  it('has the nine game icons on a 16 by 16 grid', () => {
    expect([...GAME_ICON_NAMES]).toEqual([
      'dice',
      'slots',
      'cards',
      'roulette',
      'horse',
      'stocks',
      'pickaxe',
      'sword',
      'coin',
    ]);
    for (const name of GAME_ICON_NAMES) {
      const rows = GAME_ICON_ROWS[name];
      expect(rows, name).toHaveLength(16);
      for (const row of rows) expect(row, name).toMatch(/^[.owgGyYhrRbBnNkK]{16}$/);
    }
  });

  it('has a 96 by 14 skyline with stars, a moon, buildings and lit windows', () => {
    expect(SKYLINE_ROWS).toHaveLength(14);
    for (const row of SKYLINE_ROWS)
      expect(row).toMatch(new RegExp(`^[.smfnv]{${SKYLINE_COLUMNS}}$`));
    const all = SKYLINE_ROWS.join('');
    for (const key of 'smfnv') expect(all).toContain(key);
  });

  it('stores art as compact rows: runs, not one segment per pixel', () => {
    expect(rowsToPaths(['.##.', '#..#'])).toEqual([['#', 'M1 0h2v1h-2zM0 1h1v1h-1zM3 1h1v1h-1z']]);
    const skyline = rowsToPaths(SKYLINE_ROWS).reduce((n, [, d]) => n + d.length, 0);
    expect(skyline).toBeLessThan(5000);
  });

  it('every art character has a fill rule in the stylesheet', () => {
    for (const key of 'owgGyYhrRbBnNkK') expect(css).toContain(`.bb-px-${key} {`);
    for (const key of 'smfnv') expect(css).toContain(`.bb-sky-${key} {`);
  });
});

describe('GameIcon', () => {
  it.each(GAME_ICON_NAMES)('renders %s as a decorative svg with class fills only', (name) => {
    const { container } = render(<GameIcon name={name} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(1);
    expect(container.innerHTML).not.toMatch(/style=|fill="|#[0-9a-f]{6}/i);
  });

  it('gets an accessible name when labelled', () => {
    const { getByRole } = render(<GameIcon name="coin" label="Pelica" />);
    expect(getByRole('img', { name: 'Pelica' })).toBeTruthy();
  });

  it('bobs only when asked', () => {
    const { container, rerender } = render(<GameIcon name="coin" />);
    expect(container.querySelector('.bb-px--bob')).toBeNull();
    rerender(<GameIcon name="coin" bob />);
    expect(container.querySelector('.bb-px--bob')).not.toBeNull();
  });
});

describe('Skyline and Sparkle', () => {
  it('renders a decorative, repeating strip that follows the theme unless a variant is set', () => {
    const { container, rerender } = render(<Skyline />);
    const strip = container.firstElementChild!;
    expect(strip.getAttribute('aria-hidden')).toBe('true');
    expect(strip.className).toBe('bb-skyline');
    expect(container.querySelector('pattern')!.getAttribute('width')).toBe('96');
    const id = container.querySelector('pattern')!.id;
    expect(container.querySelector('rect')!.getAttribute('fill')).toBe(`url(#${id})`);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    rerender(<Skyline variant="day" />);
    expect(container.firstElementChild!.className).toContain('bb-skyline--day');
  });

  it('gives each skyline its own pattern id', () => {
    const { container } = render(
      <>
        <Skyline />
        <Skyline />
      </>,
    );
    const ids = [...container.querySelectorAll('pattern')].map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('twinkles by default', () => {
    const { container } = render(<Sparkle />);
    expect(container.querySelector('.bb-spark--twinkle')).not.toBeNull();
  });
});

describe('pixel art motion in the stylesheet', () => {
  it('animates coin and sparkle in two steps', () => {
    expect(css).toMatch(/\.bb-px--bob\s*\{\s*animation:[^;]*steps\(2\)/);
    expect(css).toMatch(/\.bb-spark--twinkle\s*\{\s*animation:[^;]*steps\(2\)/);
  });

  it('turns both off under reduced motion, from the media query and the app flag', () => {
    const media = css.match(
      /@media \(prefers-reduced-motion: reduce\) \{[^@]*?\.bb-px--bob[^}]*\}/,
    );
    expect(media?.[0]).toMatch(/\.bb-spark--twinkle[^}]*animation:\s*none/);
    expect(css).toMatch(/\[data-reduced-motion='true'\] \.bb-px--bob,[\s\S]*?animation:\s*none/);
  });
});
