// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeScreen } from '../../shell/HomeScreen.tsx';
import { ApiError } from '../../shell/api.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useNavStore } from '../../shell/stores/nav.ts';
import { render, type Rendered } from '../../shell/testing/render.tsx';
import { featuredFor, pipsFor } from './home.tsx';
import { button, click, fakeApi, prepare, settle, text, withServices } from './testing.tsx';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

async function show(api = fakeApi()) {
  const { element } = withServices(<HomeScreen />, { api });
  mounted = render(element);
  await settle();
  return { view: mounted, api };
}

describe('Home: daily bonus', () => {
  beforeEach(() => prepare());

  it('fills the streak pips and offers Claim bonus and History', async () => {
    const { view } = await show();
    const pips = view.container.querySelectorAll('.daily__pip');
    expect(pips).toHaveLength(7);
    expect([...pips].filter((p) => p.getAttribute('data-filled') === 'true')).toHaveLength(3);
    expect(view.container.querySelector('.daily__pips')?.getAttribute('aria-label')).toBe(
      'Streak progress: day 3 of 7',
    );
    expect(text(view.container)).toContain('Streak: 3 days');
    button(view.container, 'Claim bonus');
    button(view.container, 'History');
  });

  it('claims once with an idempotency key, shows the amount and the wait, and updates the balance', async () => {
    const { view, api } = await show();
    await click(button(view.container, 'Claim bonus'));
    expect(api.claims).toHaveLength(1);
    expect(api.claims[0]).toBe('');
    expect(text(view.container)).toContain('Claimed 1,300 Pelica');
    expect(text(view.container)).toMatch(/Next bonus in \d+h \d+m/);
    expect(text(view.container)).toContain('Streak: 4 days');
    expect(useBalanceStore.getState().balance).toBe(5_300);
    expect(view.container.textContent).not.toContain('Claim bonus');
  });

  it('shows the wait when the slot is closed, with no claim button', async () => {
    const { view } = await show(
      fakeApi({
        daily: () =>
          Promise.resolve({
            claimable: false,
            nextSlotAt: Date.now() + 2 * 3_600_000 + 5 * 60_000,
            streak: 9,
          }),
      }),
    );
    expect(text(view.container)).toMatch(/Next bonus in 2h \d+m/);
    expect(text(view.container)).toContain('Streak: 9 days');
    expect(view.container.textContent).not.toContain('Claim bonus');
  });

  it('a second pip row starts over after seven days', () => {
    expect(pipsFor(0)).toBe(0);
    expect(pipsFor(1)).toBe(1);
    expect(pipsFor(7)).toBe(7);
    expect(pipsFor(8)).toBe(1);
    expect(pipsFor(15)).toBe(1);
  });

  it('names the failure when a claim is refused and reloads the status', async () => {
    let calls = 0;
    const { view } = await show(
      fakeApi({
        daily: () => {
          calls += 1;
          return Promise.resolve({
            claimable: calls === 1,
            nextSlotAt: Date.now() + 3_600_000,
            streak: 2,
          });
        },
        claimDaily: () => Promise.reject(new ApiError('conflict', 409)),
      }),
    );
    await click(button(view.container, 'Claim bonus'));
    expect(calls).toBe(2);
    expect(text(view.container)).toMatch(/Next bonus in/);
  });

  it('opens the history from the History button', async () => {
    const { view } = await show();
    await click(button(view.container, 'History'));
    expect(useNavStore.getState().screen).toBe('history');
  });

  it('reads in Japanese', async () => {
    prepare({ language: 'ja' });
    const { view } = await show();
    expect(text(view.container)).toContain('デイリーボーナス');
    expect(text(view.container)).toContain('連続ログイン：3日');
    button(view.container, 'ボーナスを受け取る');
    button(view.container, '取引履歴');
    expect(view.container.querySelector('.home__games h2')?.textContent).toBe('ゲーム');
  });
});

describe('Home: featured game', () => {
  beforeEach(() => prepare());

  it('rotates by day over the five casino games', () => {
    const day = 86_400_000;
    const seen = new Set(Array.from({ length: 5 }, (_, i) => featuredFor(i * day).game));
    expect(seen.size).toBe(5);
    expect(featuredFor(0).game).toBe(featuredFor(5 * day).game);
  });

  it('shows the game, its blurb and the jackpot pool, and opens it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1 * 86_400_000); // day 1 → chinchiro
    const { view } = await show();
    const card = view.container.querySelector('.featured') as HTMLElement;
    expect(card.textContent).toContain('Chinchiro');
    expect(card.textContent).toContain('Beat the dealer in up to three rolls.');
    expect(card.textContent).toContain('Jackpot pool 48,200');
    expect(card.querySelector('svg.bb-px')).not.toBeNull();
    await click(button(card, 'Play'));
    expect(useNavStore.getState().screen).toBe('chinchiro');
    vi.restoreAllMocks();
  });

  it('keeps Play off for a game the owner switched off', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1 * 86_400_000);
    const { view } = await show(
      fakeApi({
        overview: () =>
          Promise.resolve({ minBet: 10, jackpotPool: 0, disabled: ['chinchiro'], recent: [] }),
      }),
    );
    expect(button(view.container.querySelector('.featured') as HTMLElement, 'Play').disabled).toBe(
      true,
    );
    vi.restoreAllMocks();
  });
});
