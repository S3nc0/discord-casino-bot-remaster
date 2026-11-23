// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '../../shell/testing/render.tsx';
import * as blackjack from './art/blackjack-art.ts';
import * as chinchiro from './art/chinchiro-art.ts';
import * as pachinko from './art/pachinko-art.ts';
import { digitRows } from './art/PixelDigits.tsx';
import * as roulette from './art/roulette-art.ts';
import * as shared from './art/shared-art.ts';
import * as slots from './art/slots-art.ts';
import { CHARS, squeeze, type Sprite } from './art/sprite.ts';
import { PachinkoBoard } from './PachinkoBoard.tsx';
import { PlayingCard } from './PlayingCard.tsx';
import { SlotMachine } from './SlotMachine.tsx';
import { prepare, reduceMotion } from './testing.tsx';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

const isSprite = (v: unknown): v is Sprite =>
  typeof v === 'object' && v !== null && 'rows' in v && 'legend' in v;

/** Every sprite in a module, found through objects and arrays. */
function sprites(value: unknown, name: string, out: [string, Sprite][] = []): [string, Sprite][] {
  if (isSprite(value)) out.push([name, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => sprites(v, `${name}[${i}]`, out));
  else if (typeof value === 'object' && value !== null)
    for (const [k, v] of Object.entries(value)) sprites(v, `${name}.${k}`, out);
  return out;
}

const tokensCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/ui/src/styles/tokens.css'),
  'utf8',
);

describe('casino art data', () => {
  const all = Object.entries({ blackjack, chinchiro, pachinko, roulette, shared, slots }).flatMap(
    ([name, mod]) => sprites(mod, name),
  );

  it('has well formed sprites whose colours are palette tokens', () => {
    expect(all.length).toBeGreaterThan(150);
    for (const [name, s] of all) {
      expect(s.rows, name).toHaveLength(s.h);
      const tokens = s.legend.split(' ');
      for (const row of s.rows) {
        expect(row.length, name).toBe(s.w);
        for (const ch of row.replace(/\./g, ''))
          expect(CHARS.indexOf(ch), `${name} ${ch}`).toBeLessThan(tokens.length);
      }
      for (const token of tokens) expect(tokensCss, `${name} ${token}`).toContain(`--${token}:`);
    }
  });

  it('has a face for every card and an overlay for every pocket', () => {
    expect(Object.keys(blackjack.CARD_ART)).toHaveLength(52);
    expect(Object.keys(roulette.POCKET_ART)).toHaveLength(37);
    expect(Object.keys(slots.REEL_ART)).toEqual(['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣']);
  });

  it('squeezes a card about its middle for the flip', () => {
    const half = squeeze(blackjack.CARD_BACK_ART, 15);
    expect(half.rows.every((r) => r.length === blackjack.CARD_SIZE.w)).toBe(true);
    expect(half.rows[20]?.startsWith('........')).toBe(true);
    expect(half.rows[20]?.endsWith('........')).toBe(true);
  });

  it('draws 2, 3 and 8 so they never read alike', () => {
    const glyph = (d: string) => digitRows(d).join('');
    const apart = (a: string, b: string) =>
      [...glyph(a)].filter((p, i) => p !== glyph(b)[i]).length;
    for (const [a, b] of [
      ['2', '8'],
      ['3', '8'],
      ['2', '3'],
      ['5', '6'],
      ['6', '8'],
      ['9', '8'],
      ['0', '8'],
    ] as const)
      expect(apart(a, b), `${a} vs ${b}`).toBeGreaterThanOrEqual(4);
  });
});

describe('casino scenes', () => {
  beforeEach(() => prepare());

  it('frames the paying reels in a win and shows the burst as one still frame', () => {
    mounted = render(
      <SlotMachine reels={['🍒', '🍒', '🍋']} stopped={3} spinKey="s-1" winning={[0, 1]} />,
    );
    const reels = [...mounted.container.querySelectorAll('.cc-reel')];
    expect(reels.map((r) => r.getAttribute('data-spinning'))).toEqual(['false', 'false', 'false']);
    expect(reels.map((r) => r.querySelectorAll(':scope > g').length)).toEqual([2, 2, 1]);
    expect(mounted.container.querySelectorAll('.cc-burst')).toHaveLength(1);
  });

  it('turns a fresh card over in four steps, or shows its face at once under reduced motion', () => {
    const paths = () => mounted?.container.querySelectorAll('.cc-card path').length ?? 0;
    reduceMotion(true);
    mounted = render(<PlayingCard card={{ rank: 'Q', suit: '♦' }} fresh />);
    const face = paths();
    mounted.unmount();
    reduceMotion(false);
    vi.useFakeTimers();
    mounted = render(<PlayingCard card={{ rank: 'Q', suit: '♦' }} fresh />);
    const back = paths();
    expect(back).not.toBe(face);
    act(() => {
      vi.advanceTimersByTime(70 * 4);
    });
    expect(paths()).toBe(face);
  });

  it('ends a pachinko hit on 7 7 7 and keeps the balls in the scene', () => {
    mounted = render(<PachinkoBoard falling={false} top={30} roundKey="p-1" />);
    const board = mounted.container.querySelector('.cc-board');
    expect(board?.getAttribute('data-jackpot')).toBe('true');
    expect(mounted.container.querySelectorAll('.cc-ball')).toHaveLength(7);
  });
});
