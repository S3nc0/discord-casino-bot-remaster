// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry, HistoryPage } from '@casino/shared';
import { ApiError } from '../../shell/api.ts';
import { render, type Rendered } from '../../shell/testing/render.tsx';
import HistoryScreen from './HistoryScreen.tsx';
import { button, click, fakeApi, prepare, settle, text, withServices } from './testing.tsx';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const entry = (id: number, reason: HistoryEntry['reason'], delta: number): HistoryEntry => ({
  id,
  delta,
  balanceAfter: 5_000 + delta,
  reason,
  refType: null,
  createdAt: Date.UTC(2026, 10, 22, 3, 0, 0),
});

async function show(history: (q?: { before?: number; limit?: number }) => Promise<HistoryPage>) {
  const calls: ({ before?: number; limit?: number } | undefined)[] = [];
  const api = fakeApi({
    history: (q) => {
      calls.push(q);
      return history(q);
    },
  });
  const { element } = withServices(<HistoryScreen />, { api });
  mounted = render(element);
  await settle();
  return { view: mounted, calls };
}

describe('History', () => {
  beforeEach(() => prepare());

  it('lists the newest entries with the reason, the signed change and the balance after', async () => {
    const { view, calls } = await show(() =>
      Promise.resolve({
        items: [
          entry(9, 'game_payout', 440),
          entry(8, 'game_stake', -200),
          entry(7, 'daily_bonus', 1_100),
        ],
        nextBefore: null,
      }),
    );
    expect(calls).toEqual([{ limit: 20 }]);
    expect(view.container.querySelector('h1')?.textContent).toBe('History');
    const rows = [...view.container.querySelectorAll('.bb-list__item, li')].map(
      (li) => li.textContent,
    );
    expect(rows.join('|')).toContain('Game payout');
    expect(text(view.container)).toContain('+440');
    expect(text(view.container)).toContain('−200');
    expect(text(view.container)).toContain('Daily bonus');
    expect(text(view.container)).toContain('Balance 5,440');
    expect(buttonsText(view.container)).not.toContain('Load more');
  });

  it('pages with a cursor and appends the older entries', async () => {
    const pages = new Map<number | undefined, HistoryPage>([
      [undefined, { items: [entry(30, 'game_stake', -10)], nextBefore: 30 }],
      [30, { items: [entry(29, 'initial_grant', 3_000)], nextBefore: null }],
    ]);
    const { view, calls } = await show((q) => Promise.resolve(pages.get(q?.before) as HistoryPage));
    await click(button(view.container, 'Load more'));
    expect(calls).toEqual([{ limit: 20 }, { limit: 20, before: 30 }]);
    expect(text(view.container)).toContain('Game stake');
    expect(text(view.container)).toContain('Starting balance');
    expect(buttonsText(view.container)).not.toContain('Load more');
  });

  it('says when there is nothing yet', async () => {
    const { view } = await show(() => Promise.resolve({ items: [], nextBefore: null }));
    expect(text(view.container)).toContain('No entries yet.');
  });

  it('shows a retry when loading fails, then recovers', async () => {
    let fail = true;
    const { view } = await show(() =>
      fail
        ? Promise.reject(new ApiError('internal', 500))
        : Promise.resolve({ items: [entry(1, 'admin_grant', 50)], nextBefore: null }),
    );
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not load your history.',
    );
    fail = false;
    await click(button(view.container, 'Try again'));
    expect(text(view.container)).toContain('Granted by an admin');
  });

  it('names the reasons in Japanese', async () => {
    prepare({ language: 'ja' });
    const { view } = await show(() =>
      Promise.resolve({
        items: [entry(3, 'game_insurance_refund', 500), entry(2, 'teiai_skim', -200)],
        nextBefore: null,
      }),
    );
    expect(view.container.querySelector('h1')?.textContent).toBe('履歴');
    expect(text(view.container)).toContain('保険券の返金');
    expect(text(view.container)).toContain('帝愛のピンハネ');
    expect(text(view.container)).toContain('残高');
  });
});

const buttonsText = (root: ParentNode) =>
  [...root.querySelectorAll('button')].map((b) => b.textContent).join('|');

describe('History scene', () => {
  beforeEach(() => prepare());

  it('draws the ledger desk above the list and keeps the list a ruled light page', async () => {
    const { view } = await show(() =>
      Promise.resolve({ items: [entry(1, 'daily_bonus', 1_300)], nextBefore: null }),
    );
    const scene = view.container.querySelector('.cc-head + .sc-scene svg.bb-scene');
    expect(scene?.getAttribute('aria-hidden')).toBe('true');
    expect(view.container.querySelector('.cc-ledger')?.getAttribute('data-theme')).toBe('light');
  });
});
