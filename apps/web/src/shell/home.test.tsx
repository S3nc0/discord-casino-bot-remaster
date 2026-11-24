// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCREEN_IDS } from '@casino/shared';
import { HOME_SECTIONS, HomeScreen } from './HomeScreen.tsx';
import { NAV_SCREENS } from './NavigationBar.tsx';
import { useBalanceStore } from './stores/balance.ts';
import { useNavStore } from './stores/nav.ts';
import { useSettingsStore } from './stores/settings.ts';
import { resetStores } from './testing/fakes.ts';
import { act, render, type Rendered } from './testing/render.tsx';

let mounted: Rendered | null = null;
beforeEach(resetStores);
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const show = () => (mounted = render(<HomeScreen />));

describe('Home', () => {
  it('puts a skyline strip on the balance hero, with the balance and the coin', () => {
    useBalanceStore.getState().set(3000);
    const view = show();
    const hero = view.container.querySelector('.home__hero')!;
    expect(hero.querySelector('.bb-card__media .bb-skyline')).not.toBeNull();
    expect(hero.querySelector('.home__amount')!.textContent).toBe('3,000');
    expect(hero.querySelector('.home__unit')!.textContent).toBe('Pelica');
    expect(hero.querySelector('h1')!.textContent).toBe('Balance');
    expect(hero.querySelector('.bb-px--bob')).not.toBeNull();
    expect(hero.querySelectorAll('.bb-spark--twinkle')).toHaveLength(2);
  });

  it('shows a dash until the balance is known', () => {
    expect(show().container.querySelector('.home__amount')!.textContent).toBe('—');
  });

  it('gives every Home tile its own pixel icon (none is reused)', () => {
    const icons = HOME_SECTIONS.flatMap((s) => s.tiles.map((t) => t.icon));
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('shows the game tiles first, each a labelled button with a pixel icon', () => {
    const view = show();
    const tiles = [
      ...view.container.querySelectorAll<HTMLButtonElement>('.home__games:first-of-type button'),
    ];
    const games = [
      'Chinchiro',
      'Slots',
      'Blackjack',
      'Roulette',
      'Pachinko',
      'Horse racing',
      'Arena',
    ];
    const first = view.container.querySelector('.home__games')!;
    expect([...first.querySelectorAll('button')].map((t) => t.textContent)).toEqual(games);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of view.container.querySelectorAll<HTMLButtonElement>('.home__tiles button')) {
      expect(tile.className).toContain('bb-game');
      expect(tile.querySelector('svg.bb-px[viewBox="0 0 16 16"]')).not.toBeNull();
    }
  });

  it('opens the game a tile names', () => {
    const view = show();
    const tiles = view.container.querySelectorAll<HTMLButtonElement>('.home__tiles button');
    act(() => tiles[1]!.click());
    expect(useNavStore.getState().screen).toBe('slots');
  });

  it('reaches every screen from Home or the navigation bar, nothing only by a deep link', () => {
    const onHome = new Set(HOME_SECTIONS.flatMap((section) => section.tiles.map((t) => t.screen)));
    const reachable = new Set<string>([...onHome, ...NAV_SCREENS, 'home']);
    expect(SCREEN_IDS.filter((id) => !reachable.has(id))).toEqual([]);
  });

  it('follows the language setting', () => {
    useSettingsStore.getState().update({ language: 'ja' });
    const view = show();
    expect(view.container.querySelector('.home__games h2')!.textContent).toBe('ゲーム');
    expect(view.container.querySelector('.home__tiles button')!.textContent).toBe('チンチロ');
  });
});
