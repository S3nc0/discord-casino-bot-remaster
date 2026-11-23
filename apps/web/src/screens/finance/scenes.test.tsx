// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { ThemeProvider } from '@casino/ui';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { resetStores } from '../../shell/testing/fakes.ts';
import { act, render, type Rendered } from '../../shell/testing/render.tsx';
import { BANK_ART } from './art/bank.ts';
import { COMPANIES_ART, COMPANY_PLATES } from './art/companies.ts';
import { CRYPTO_ART, CRYPTO_LIGHTS } from './art/crypto.ts';
import { KYOSAI_ART } from './art/kyosai.ts';
import { LOANS_ART } from './art/loans.ts';
import { MARKET_ART, MARKET_SLOTS } from './art/market.ts';
import {
  BADGE_GLYPHS,
  BADGE_RAMPS,
  BADGE_SHAPE_ROWS,
  COIN_ROWS,
  GAVEL_FRAMES,
  SPIN_FRAMES,
  SPRITE_LEGEND,
} from './art/sprites.ts';
import { STOCKS_ART, TICKER_BOX } from './art/stocks.ts';
import BankScreen from './BankScreen.tsx';
import { FinanceClientContext } from './client.ts';
import CompaniesScreen from './CompaniesScreen.tsx';
import MarketScreen from './MarketScreen.tsx';
import { createMockFinanceClient } from './mock.ts';
import { FinanceScene, type FinanceArt } from './FinanceScene.tsx';
import { badgeLook, CompanyBadge } from './sprites.tsx';

const TOKENS = new Set(
  [
    ...readFileSync(
      join(import.meta.dirname, '../../../../../packages/ui/src/styles/tokens.css'),
      'utf8',
    ).matchAll(/--([a-z]+-\d+):/g),
  ].map((m) => m[1]),
);

const SCENES: Record<string, FinanceArt> = {
  bank: BANK_ART,
  loans: LOANS_ART,
  kyosai: KYOSAI_ART,
  stocks: STOCKS_ART,
  crypto: CRYPTO_ART,
  companies: COMPANIES_ART,
  market: MARKET_ART,
};

let mounted: Rendered | null = null;
beforeEach(() => {
  resetStores();
  useBalanceStore.getState().set(12_400);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});
const flush = () => act(async () => new Promise<void>((r) => setTimeout(r, 0)));
async function show(ui: ReactElement): Promise<Rendered> {
  mounted = render(
    <FinanceClientContext.Provider value={createMockFinanceClient()}>
      {ui}
    </FinanceClientContext.Provider>,
  );
  await flush();
  await flush();
  return mounted;
}

describe('scene art data', () => {
  for (const [name, art] of Object.entries(SCENES)) {
    it(`${name}: full rows, every pixel named, every token in the palette`, () => {
      expect(art.rows).toHaveLength(art.h);
      for (const row of art.rows) {
        expect(row).toHaveLength(art.w);
        // a scene has no holes: the page never shows through it
        expect(row).not.toContain('.');
        for (const ch of row) expect(art.legend[ch], `${name} ${ch}`).toBeDefined();
      }
      for (const pair of Object.values(art.legend)) {
        expect(pair).toHaveLength(2);
        for (const token of pair) expect(TOKENS.has(token), token).toBe(true);
      }
      if (art.anim) {
        const { x, y, w, h, frames } = art.anim;
        expect(x + w).toBeLessThanOrEqual(art.w);
        expect(y + h).toBeLessThanOrEqual(art.h);
        expect(frames.length).toBeGreaterThan(1);
        for (const f of frames) {
          expect(f).toHaveLength(h);
          for (const row of f) {
            expect(row).toHaveLength(w);
            for (const ch of row) expect(ch === '.' || art.legend[ch] !== undefined).toBe(true);
          }
        }
      }
    });
  }

  it('places overlays inside their scenes', () => {
    const [tx, ty, tw, th] = TICKER_BOX;
    expect(tx + tw).toBeLessThanOrEqual(STOCKS_ART.w);
    expect(ty + th).toBeLessThanOrEqual(STOCKS_ART.h);
    for (const [x, y] of MARKET_SLOTS) {
      expect(x + 16).toBeLessThanOrEqual(MARKET_ART.w);
      expect(y + 16).toBeLessThanOrEqual(MARKET_ART.h);
    }
    for (const [x, y] of COMPANY_PLATES) {
      expect(x + 12).toBeLessThanOrEqual(COMPANIES_ART.w);
      expect(y + 12).toBeLessThanOrEqual(COMPANIES_ART.h);
    }
    for (const [x, y, phase] of CRYPTO_LIGHTS) {
      expect(x).toBeLessThan(CRYPTO_ART.w);
      expect(y).toBeLessThan(CRYPTO_ART.h);
      expect(phase).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps every sprite inside the palette and its size', () => {
    for (const token of Object.values(SPRITE_LEGEND)) expect(TOKENS.has(token), token).toBe(true);
    const sized = (rows: readonly string[], w: number, h: number) => {
      expect(rows).toHaveLength(h);
      for (const row of rows) {
        expect(row).toHaveLength(w);
        for (const ch of row) expect(ch === '.' || SPRITE_LEGEND[ch] !== undefined).toBe(true);
      }
    };
    for (const rows of Object.values(COIN_ROWS)) sized(rows, 16, 16);
    for (const rows of GAVEL_FRAMES) sized(rows, 16, 16);
    for (const rows of SPIN_FRAMES) sized(rows, 9, 9);
    for (const rows of Object.values(BADGE_SHAPE_ROWS)) {
      expect(rows).toHaveLength(12);
      for (const row of rows) expect(row).toMatch(/^[.0-4]{12}$/);
    }
    for (const ramp of Object.values(BADGE_RAMPS))
      for (const token of ramp) expect(TOKENS.has(token), token).toBe(true);
    for (const g of Object.values(BADGE_GLYPHS)) for (const row of g) expect(row).toHaveLength(7);
  });
});

describe('FinanceScene', () => {
  it('draws a light set and a dark set of the same art, hidden from screen readers', () => {
    const view = render(<FinanceScene art={BANK_ART} name="bank" />);
    const scene = view.container.querySelector('.fx-scene')!;
    expect(scene.getAttribute('aria-hidden')).toBe('true');
    const day = scene.querySelector('.fx-day')!;
    const night = scene.querySelector('.fx-night')!;
    expect(day.querySelectorAll('path').length).toBeGreaterThan(5);
    expect(night.querySelectorAll('path').length).toBeGreaterThan(5);
    // colours are palette variables, never raw values
    for (const p of scene.querySelectorAll('path'))
      expect((p as SVGElement).style.fill).toMatch(/^var\(--[a-z]+-\d+\)$/);
    expect(scene.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 128 48');
    view.unmount();
  });

  it('gives each company a stable badge from its name', () => {
    expect(badgeLook('Mika Farm')).toEqual(badgeLook('Mika Farm'));
    const looks = new Set(
      ['Mika Farm', 'Ren Mine', 'Sora Works', 'Teiai', 'Numa Labs', 'Gold Rush'].map((n) => {
        const l = badgeLook(n);
        return `${l.shape}/${l.hue}`;
      }),
    );
    expect(looks.size).toBeGreaterThan(2);
    const view = render(<CompanyBadge name="Ren Mine" kind="mine" />);
    expect(view.container.querySelector('svg.fx-badge')!.getAttribute('width')).toBe('24');
    view.unmount();
  });
});

describe('finance scenes on the screens', () => {
  it('bank: the hall heads the screen and a repayment sends coins to the vault', async () => {
    const view = await show(<BankScreen />);
    const scene = view.container.querySelector('[data-scene="bank"]')!;
    expect(scene).not.toBeNull();
    expect(view.container.querySelector('.fin__badge')).toBeNull();
    expect(scene.querySelector('.fx-hop')).toBeNull();
    const all = [...view.container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Repay all I can',
    )!;
    await act(async () => all.click());
    await flush();
    expect(scene.querySelectorAll('.fx-hop')).toHaveLength(2);
  });

  it('bank: no coins and no wheel turn under reduced motion', async () => {
    const view = await show(
      <ThemeProvider reducedMotion="reduce" syncDocument={false}>
        <BankScreen />
      </ThemeProvider>,
    );
    const all = [...view.container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Repay all I can',
    )!;
    await act(async () => all.click());
    await flush();
    expect(view.container.querySelector('.fx-hop')).toBeNull();
  });

  it('stocks: the LED board scrolls the four live prices', async () => {
    const view = await show(<MarketScreen screen="stocks" initialTab="board" />);
    const sets = view.container.querySelectorAll('[data-scene="stocks"] .fx-ticker__set');
    expect(sets).toHaveLength(2);
    expect(sets[0]!.querySelectorAll('.fx-ticker__item')).toHaveLength(4);
    expect(sets[0]!.textContent).toMatch(/CS [\d,]+\.\d\d/);
    // every board card shows its symbol's coin and a candle chart with its high and low
    for (const card of view.container.querySelectorAll('[data-symbol]')) {
      expect(card.querySelector('.fx-coin')).not.toBeNull();
      expect(card.querySelectorAll('[data-candle]').length).toBeGreaterThan(5);
      expect(card.textContent).toMatch(/High [\d,]+\.\d\d/);
      expect(card.querySelector('title')!.textContent).toMatch(/now [\d,]+\.\d\d/);
    }
  });

  it('market: listings stand on the stalls and the lead is about the player market', async () => {
    const view = await show(<MarketScreen />);
    expect(view.container.querySelectorAll('[data-scene="market"] [data-slot]').length).toBe(3);
    expect(view.container.querySelector('.fin__lead')!.textContent).toMatch(/auction/);
  });

  it('crypto: the mining room, with its own lead', async () => {
    const view = await show(<MarketScreen screen="crypto" initialTab="trade" initialSymbol="cs" />);
    expect(view.container.querySelectorAll('[data-scene="crypto"] .fx-leds rect')).toHaveLength(
      CRYPTO_LIGHTS.length,
    );
    expect(view.container.querySelector('.fin__lead')!.textContent).toMatch(/CS token/);
  });

  it('companies: each company has its badge on the skyline and on its row', async () => {
    const view = await show(<CompaniesScreen />);
    const names = [
      ...view.container.querySelectorAll('[data-scene="companies"] [data-company]'),
    ].map((g) => g.getAttribute('data-company'));
    expect(names).toEqual(['Mika Farm', 'Ren Mine']);
    expect(view.container.querySelectorAll('[data-owner] .fx-badge').length).toBe(2);
    // a holding pays dividends: coins drop from the first tower
    expect(view.container.querySelectorAll('.fx-drop')).toHaveLength(3);
  });
});
