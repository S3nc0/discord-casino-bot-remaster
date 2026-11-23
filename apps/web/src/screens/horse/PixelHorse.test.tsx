// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PixelHorse } from './PixelHorse.tsx';
import { coatKey, silksKey } from './format.ts';
import { HORSE_ART_HEIGHT, HORSE_ART_WIDTH, HORSE_FRAMES, HORSE_STILL_FRAME } from './horse-art.ts';
import { act, render, type Rendered } from '../../shell/testing/render.tsx';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-reduced-motion');
});

const shown = (view: Rendered) =>
  [...view.container.querySelectorAll('path')].map((p) => p.getAttribute('d')).join('|');

describe('horse art data', () => {
  it('is eight frames of 48 by 32 role characters', () => {
    expect(HORSE_FRAMES).toHaveLength(8);
    expect(HORSE_STILL_FRAME).toBeLessThan(8);
    expect(HORSE_FRAMES.some((rows) => rows.join('').includes('o'))).toBe(true);
    for (const rows of HORSE_FRAMES) {
      expect(rows).toHaveLength(HORSE_ART_HEIGHT);
      for (const row of rows) expect(row).toMatch(new RegExp(`^[.a-u]{${HORSE_ART_WIDTH}}$`));
      const all = rows.join('');
      for (const role of 'bcdpqst') expect(all, role).toContain(role);
    }
  });

  it('maps every coat and silks emoji to a class', () => {
    expect(
      ['栗毛', '鹿毛', '黒鹿毛', '青毛', '芦毛', '白毛', '栃栗毛', '月毛'].map(coatKey),
    ).toEqual(['kurige', 'kage', 'kurokage', 'aoge', 'ashige', 'shirage', 'tochiguri', 'tsukige']);
    expect(['🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫'].map(silksKey)).toEqual([
      'red',
      'orange',
      'yellow',
      'green',
      'blue',
      'violet',
      'black',
      'white',
      'brown',
    ]);
    expect(coatKey('?')).toBe('kage');
    expect(silksKey('?')).toBe('white');
  });
});

describe('PixelHorse', () => {
  it('picks its colours by class only, and stands still by default', () => {
    mounted = render(<PixelHorse coat="栗毛" silks="🟥" />);
    const svg = mounted.container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 48 32');
    expect(svg.getAttribute('class')).toContain('hr-coat-kurige');
    expect(svg.getAttribute('class')).toContain('hr-silks-red');
    expect(svg.getAttribute('class')).not.toContain('is-running');
    expect(mounted.container.innerHTML).not.toMatch(/style=|fill="|#[0-9a-f]{6}/i);
  });

  it('plays the stride while running and returns to the still frame when stopped', () => {
    vi.useFakeTimers();
    mounted = render(<PixelHorse coat="鹿毛" silks="🟦" />);
    const still = shown(mounted);
    mounted.rerender(<PixelHorse coat="鹿毛" silks="🟦" running />);
    expect(mounted.container.querySelector('.hr-horse.is-running')).not.toBeNull();
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      act(() => {
        vi.advanceTimersByTime(80);
      });
      seen.add(shown(mounted));
    }
    expect(seen.size).toBe(8);
    mounted.rerender(<PixelHorse coat="鹿毛" silks="🟦" />);
    expect(shown(mounted)).toBe(still);
  });

  it('shows one static frame and no timer when motion is reduced', () => {
    vi.useFakeTimers();
    document.documentElement.setAttribute('data-reduced-motion', 'true');
    mounted = render(<PixelHorse coat="青毛" silks="🟨" running />);
    const first = shown(mounted);
    expect(mounted.container.querySelector('.is-running')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(shown(mounted)).toBe(first);
    expect(vi.getTimerCount()).toBe(0);
  });
});
