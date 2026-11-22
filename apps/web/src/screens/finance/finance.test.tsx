// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FINANCE_ROUTES, type FinanceListingsView } from '@casino/shared';
import { dictionaries } from '@casino/shared/i18n';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { useSettingsStore } from '../../shell/stores/settings.ts';
import { useToastStore } from '../../shell/stores/toasts.ts';
import { resetStores, USER_ID } from '../../shell/testing/fakes.ts';
import { act, render, type Rendered } from '../../shell/testing/render.tsx';
import type { ReactElement } from 'react';
import BankScreen from './BankScreen.tsx';
import CompaniesScreen from './CompaniesScreen.tsx';
import KyosaiScreen from './KyosaiScreen.tsx';
import LoansScreen from './LoansScreen.tsx';
import MarketScreen from './MarketScreen.tsx';
import { PixelChart } from './PixelChart.tsx';
import { FinanceClientContext } from './client.ts';
import { createMockFinanceClient } from './mock.ts';
import { FinanceApiError, type FinanceBody, type FinanceClient } from './types.ts';

let mounted: Rendered | null = null;
beforeEach(() => {
  resetStores();
  useBalanceStore.getState().set(12_400);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

interface Spy {
  client: FinanceClient;
  posts: { route: string; body: FinanceBody }[];
  failNext: (error: FinanceApiError) => void;
}

function spy(base: FinanceClient = createMockFinanceClient()): Spy {
  const posts: Spy['posts'] = [];
  let failure: FinanceApiError | null = null;
  return {
    posts,
    failNext: (e) => {
      failure = e;
    },
    client: {
      get: (route) => base.get(route),
      post: (route, body) => {
        posts.push({ route, body });
        if (failure) {
          const e = failure;
          failure = null;
          return Promise.reject(e);
        }
        return base.post(route, body);
      },
    },
  };
}

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

async function show(ui: ReactElement, client: FinanceClient): Promise<Rendered> {
  mounted = render(
    <FinanceClientContext.Provider value={client}>{ui}</FinanceClientContext.Provider>,
  );
  await flush();
  await flush();
  return mounted;
}

const buttons = (view: Rendered) => [...view.container.querySelectorAll('button')];
const button = (view: Rendered, text: string | RegExp) => {
  const found = buttons(view).find((b) =>
    typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? ''),
  );
  if (!found)
    throw new Error(
      `no button ${String(text)} in: ${buttons(view)
        .map((b) => b.textContent)
        .join(' | ')}`,
    );
  return found;
};
async function click(el: Element): Promise<void> {
  await act(async () => (el as HTMLElement).click());
  await flush();
}
async function type(view: Rendered, label: string | RegExp, value: string, nth = 0): Promise<void> {
  const labels = [...view.container.querySelectorAll('label')].filter((l) =>
    typeof label === 'string' ? l.textContent === label : label.test(l.textContent ?? ''),
  );
  const input = view.container.querySelector<HTMLInputElement>(
    `#${CSS.escape(labels[nth]?.htmlFor ?? '')}`,
  );
  if (!input) throw new Error(`no field ${String(label)}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const text = (view: Rendered) => view.container.textContent ?? '';

describe('PixelChart', () => {
  it('draws one column per price and follows the move', () => {
    const view = render(<PixelChart points={[1, 2, 3, 4]} label="Gold up" />);
    const svg = view.container.querySelector('svg')!;
    expect(svg.getAttribute('data-tone')).toBe('up');
    expect(svg.querySelectorAll('.fin-chart__line')).toHaveLength(4);
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg.querySelector('title')!.textContent).toBe('Gold up');
    view.rerender(<PixelChart points={[4, 3, 1]} label="down" />);
    expect(view.container.querySelector('svg')!.getAttribute('data-tone')).toBe('down');
    view.rerender(<PixelChart points={[5, 5, 5]} label="flat" />);
    expect(view.container.querySelector('svg')!.getAttribute('data-tone')).toBe('flat');
    view.unmount();
  });
});

describe('Bank screen', () => {
  it('shows balance, debt, status and the way to repay', async () => {
    const view = await show(<BankScreen />, spy().client);
    expect(view.container.querySelector('h1')!.textContent).toBe('Bank');
    expect(text(view)).toContain('12,400');
    expect(text(view)).toContain('4,200');
    expect(text(view)).toContain('Underground laborer');
    expect(view.container.querySelector('.bb-progress-wrap')).not.toBeNull();
  });

  it('repays with an idempotency key, refreshes the debt and toasts', async () => {
    const s = spy();
    const view = await show(<BankScreen />, s.client);
    await type(view, /^Amount/, '1000');
    await click(button(view, 'Repay'));
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0]!.route).toBe(FINANCE_ROUTES.bankRepay);
    expect(s.posts[0]!.body).toMatchObject({ amount: 1000 });
    expect(s.posts[0]!.body.idempotencyKey.length).toBeGreaterThanOrEqual(16);
    expect(text(view)).toContain('3,200');
    expect(useBalanceStore.getState().balance).toBe(11_400);
    expect(useToastStore.getState().toasts.at(-1)?.messageKey).toBe('screen.finance.bank.repaid');
  });

  it('keeps the same key when a lost answer is retried, and a new one for a new amount', async () => {
    const s = spy();
    const view = await show(<BankScreen />, s.client);
    await type(view, /^Amount/, '500');
    s.failNext(new FinanceApiError('internal', 0));
    await click(button(view, 'Repay'));
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain(
      'Something went wrong',
    );
    await click(button(view, 'Repay'));
    expect(s.posts).toHaveLength(2);
    expect(s.posts[1]!.body.idempotencyKey).toBe(s.posts[0]!.body.idempotencyKey);
    await type(view, /^Amount/, '600');
    s.failNext(new FinanceApiError('internal', 0));
    await click(button(view, 'Repay'));
    expect(s.posts[2]!.body.idempotencyKey).not.toBe(s.posts[0]!.body.idempotencyKey);
  });

  it('turns a rule code into its own sentence', async () => {
    const s = spy();
    const view = await show(<BankScreen />, s.client);
    s.failNext(new FinanceApiError('not_found', 404, 'no_debt'));
    await click(button(view, 'Repay all I can'));
    expect(view.container.querySelector('[role="alert"]')!.textContent).toBe('You have no debt.');
  });

  it('reads in Japanese', async () => {
    useSettingsStore.setState({ language: 'ja' });
    const view = await show(<BankScreen />, spy().client);
    expect(view.container.querySelector('h1')!.textContent).toBe('銀行');
    expect(text(view)).toContain('地下労働者');
    expect(text(view)).toContain('返済する');
  });
});

describe('Loans screen', () => {
  it('lists my loans and the open requests, with the right actions', async () => {
    const view = await show(<LoansScreen />, spy().client);
    expect(view.container.querySelectorAll('[data-loan]')).toHaveLength(3);
    expect(view.container.querySelector('[data-loan="1"]')!.textContent).toContain('Repaying');
    expect(button(view, 'Accept')).toBeTruthy();
    expect(button(view, /^Lend/)).toBeTruthy();
  });

  it('accepts an offer: money arrives and the list updates', async () => {
    const s = spy();
    const view = await show(<LoansScreen />, s.client);
    await click(button(view, 'Accept'));
    expect(s.posts[0]).toMatchObject({ route: FINANCE_ROUTES.loanAccept, body: { loanId: 2 } });
    expect(useBalanceStore.getState().balance).toBe(13_400);
    expect(view.container.querySelector('[data-loan="2"]')!.getAttribute('data-status')).toBe(
      'active',
    );
  });

  it('repays part of an active loan', async () => {
    const s = spy();
    const view = await show(<LoansScreen />, s.client);
    const card = view.container.querySelector('[data-loan="1"]')!;
    const input = card.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '300');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click([...card.querySelectorAll('button')].find((b) => b.textContent === 'Repay')!);
    expect(s.posts[0]).toMatchObject({
      route: FINANCE_ROUTES.loanRepay,
      body: { loanId: 1, amount: 300 },
    });
  });

  it('posts a borrow request from the composer', async () => {
    const s = spy();
    const view = await show(<LoansScreen />, s.client);
    await click(
      [...view.container.querySelectorAll('[role="tab"]')].find(
        (tab) => tab.textContent === 'Borrow',
      )!,
    );
    const post = button(view, 'Post request');
    expect(post.hasAttribute('disabled')).toBe(true);
    await type(view, /^Principal/, '700');
    await click(button(view, /^Post request/));
    expect(s.posts[0]).toMatchObject({
      route: FINANCE_ROUTES.loanRequest,
      body: { principal: 700, rateBps: 100, termDays: 7 },
    });
  });

  it('asks for somebody to lend to when nobody else is in the Activity', async () => {
    const view = await show(<LoansScreen />, spy().client);
    expect(text(view)).toContain('Nobody else is in this Activity yet.');
  });

  it('offers to a participant', async () => {
    useSessionStore.setState({
      participants: [
        { id: '200000000000000009', username: 'taro', globalName: 'Taro', avatar: null },
      ],
      user: { id: USER_ID, username: 'me', globalName: 'Me', avatar: null },
    });
    const s = spy();
    const view = await show(<LoansScreen />, s.client);
    await click(buttons(view).find((b) => b.textContent === 'Taro')!);
    await type(view, /^Principal/, '400');
    await click(button(view, 'Send offer'));
    expect(s.posts[0]).toMatchObject({
      route: FINANCE_ROUTES.loanOffer,
      body: { borrowerId: '200000000000000009', principal: 400 },
    });
  });
});

describe('Kyosai screen', () => {
  it('shows my units, the auction and the open vote', async () => {
    const view = await show(<KyosaiScreen />, spy().client);
    expect(text(view)).toContain('120 / 10,000');
    expect(text(view)).toContain('6,400');
    expect(text(view)).toContain('Mika');
    expect(view.container.querySelector('[data-motion="4"]')).not.toBeNull();
    expect(view.container.querySelector('[data-offer="9"]')).not.toBeNull();
  });

  it('bids above the top bid only', async () => {
    const s = spy();
    const view = await show(<KyosaiScreen />, s.client);
    await type(view, 'Your bid', '6000');
    expect(button(view, 'Place bid').hasAttribute('disabled')).toBe(true);
    await type(view, 'Your bid', '7000');
    await click(button(view, 'Place bid'));
    expect(s.posts[0]).toMatchObject({ route: FINANCE_ROUTES.kyosaiBid, body: { amount: 7000 } });
    expect(text(view)).toContain('You');
  });

  it('votes and buys an offered lot', async () => {
    const s = spy();
    const view = await show(<KyosaiScreen />, s.client);
    await click(button(view, 'Vote yes'));
    await click(button(view, /^Buy for/));
    expect(s.posts.map((p) => p.route)).toEqual([
      FINANCE_ROUTES.kyosaiVote,
      FINANCE_ROUTES.kyosaiAccept,
    ]);
    expect(s.posts[0]!.body).toMatchObject({ motionId: 4, yes: true });
  });

  it('shows a locked gate and stops the bid form', async () => {
    const base = createMockFinanceClient();
    const locked: FinanceClient = {
      ...base,
      get: async (route) => {
        const data = await base.get(route);
        return route === FINANCE_ROUTES.kyosai ? ({ ...data, locked: true } as typeof data) : data;
      },
    };
    const view = await show(<KyosaiScreen />, locked);
    expect(text(view)).toContain('The gate is shut');
    expect(buttons(view).some((b) => b.textContent === 'Place bid')).toBe(false);
  });
});

describe('Market screen', () => {
  it('draws the board: four tickers, each with a pixel chart and its move', async () => {
    const view = await show(<MarketScreen />, spy().client);
    const cards = view.container.querySelectorAll('[data-symbol]');
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.querySelector('svg.fin-chart')).not.toBeNull();
      expect(card.textContent).toMatch(/[+-]?\d+\.\d\d%|0\.00%/);
    }
  });

  it('opens the trade form from a ticker and buys spot with a key', async () => {
    const s = spy();
    const view = await show(<MarketScreen />, s.client);
    await click(view.container.querySelector('[data-symbol="gold"]')!);
    expect(view.container.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe(
      'Trade',
    );
    await type(view, /^Amount/, '800');
    await click(button(view, 'Buy'));
    expect(s.posts[0]).toMatchObject({
      route: FINANCE_ROUTES.marketSpot,
      body: { symbol: 'gold', amount: 800 },
    });
    // After a buy the screen jumps to the holdings.
    expect(view.container.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe(
      'Holdings',
    );
    expect(view.container.querySelector('[data-position="spot:gold"]')).not.toBeNull();
  });

  it('sends margin, option, pair and bond orders with their own bodies', async () => {
    const s = spy();
    const view = await show(<MarketScreen initialTab="trade" />, s.client);
    const mode = async (label: string) =>
      click([...view.container.querySelectorAll('.bb-chip')].find((c) => c.textContent === label)!);
    await mode('Margin');
    await type(view, /^Margin to post/, '500');
    await click(button(view, 'Open position'));
    await click(
      [...view.container.querySelectorAll('[role="tab"]')].find((x) => x.textContent === 'Trade')!,
    );
    await mode('Pair');
    await type(view, /^Premium/, '200');
    await click(button(view, 'Buy pair'));
    await click(
      [...view.container.querySelectorAll('[role="tab"]')].find((x) => x.textContent === 'Trade')!,
    );
    await mode('Bond');
    await type(view, /^Amount/, '1500');
    await click(button(view, 'Buy bond'));
    expect(s.posts.map((p) => p.route)).toEqual([
      FINANCE_ROUTES.marketMargin,
      FINANCE_ROUTES.marketOption,
      FINANCE_ROUTES.marketBond,
    ]);
    expect(s.posts[0]!.body).toMatchObject({
      symbol: 'cs',
      side: 'long',
      leverage: 2,
      amount: 500,
    });
    expect(s.posts[1]!.body).toMatchObject({
      kind: 'pair',
      symbol: 'cs',
      symbolB: 'gold',
      premium: 200,
    });
    expect(s.posts[2]!.body).toMatchObject({ kind: 'normal', amount: 1500 });
  });

  it('settles every kind of position by its id', async () => {
    const s = spy();
    const view = await show(<MarketScreen />, s.client);
    await click(
      [...view.container.querySelectorAll('[role="tab"]')].find(
        (x) => x.textContent === 'Holdings',
      )!,
    );
    for (const id of ['spot:cs', 'long:teio', 'option:5', 'bond:6']) {
      const card = view.container.querySelector(`[data-position="${id}"]`)!;
      await click(card.querySelector('button')!);
    }
    expect(s.posts.map((p) => p.body.position)).toEqual([
      'spot:cs',
      'long:teio',
      'option:5',
      'bond:6',
    ]);
    expect(view.container.querySelector('[data-position]')).toBeNull();
  });

  it('shows the Crypto title and starts on the trade tab for the cs ticker', async () => {
    const view = await show(
      <MarketScreen screen="crypto" initialTab="trade" initialSymbol="cs" />,
      spy().client,
    );
    expect(view.container.querySelector('h1')!.textContent).toBe('Crypto');
    expect(
      view.container.querySelector('.bb-chip[aria-pressed="true"], .bb-chip--selected'),
    ).not.toBeNull();
  });
});

describe('Player market listings', () => {
  async function openListings(client: FinanceClient) {
    const view = await show(<MarketScreen />, client);
    await click(
      [...view.container.querySelectorAll('[role="tab"]')].find(
        (x) => x.textContent === 'Players',
      )!,
    );
    await flush();
    return view;
  }

  it('lists fixed and auction listings and buys a fixed one', async () => {
    const s = spy();
    const view = await openListings(s.client);
    expect(view.container.querySelectorAll('[data-listing]')).toHaveLength(3);
    await click(button(view, /^Buy for/));
    expect(s.posts[0]).toMatchObject({ route: FINANCE_ROUTES.listingBuy, body: { listingId: 22 } });
  });

  it('bids at least the minimum next bid', async () => {
    const s = spy();
    const view = await openListings(s.client);
    const card = view.container.querySelector('[data-listing="21"]')!;
    expect(card.querySelector<HTMLInputElement>('input')!.value).toBe('6510');
    await click([...card.querySelectorAll('button')].find((b) => b.textContent === 'Place bid')!);
    expect(s.posts[0]).toMatchObject({
      route: FINANCE_ROUTES.listingBid,
      body: { listingId: 21, amount: 6510 },
    });
    expect(view.container.querySelector('[data-listing="21"]')!.textContent).toContain(
      'You are the top bidder',
    );
  });

  it('warns when somebody outbids me', async () => {
    const base = createMockFinanceClient();
    let outbid = false;
    const client: FinanceClient = {
      post: base.post,
      get: async (route) => {
        const data = await base.get(route);
        if (route !== FINANCE_ROUTES.listings) return data;
        const view = data as FinanceListingsView;
        const l = view.listings.find((x) => x.id === 21)!;
        if (!outbid)
          Object.assign(l, { youAreTop: true, bid: 6_200, topBidder: { id: USER_ID, name: 'Me' } });
        else
          Object.assign(l, { youAreTop: false, bid: 6_800, topBidder: { id: 'x', name: 'Ren' } });
        return view as typeof data;
      },
    };
    const view = await openListings(client);
    expect(view.container.querySelector('[data-outbid]')).toBeNull();
    outbid = true;
    await act(async () => void useBalanceStore.getState().set(12_000));
    await flush();
    const notice = view.container.querySelector('[data-outbid="21"]')!;
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent).toContain('You were outbid');
    expect(notice.textContent).toContain('6,800');
    await click(notice.querySelector('button')!);
    expect(view.container.querySelector('[data-outbid]')).toBeNull();
  });

  it('lets me take down my own listing when it has no bid', async () => {
    const s = spy();
    const view = await openListings(s.client);
    await click(button(view, 'Take down'));
    expect(s.posts[0]).toMatchObject({
      route: FINANCE_ROUTES.listingCancel,
      body: { listingId: 23 },
    });
  });
});

describe('Companies screen', () => {
  it('founds a company and then shows it', async () => {
    const s = spy(createMockFinanceClient({ balance: 300_000 }));
    const view = await show(<CompaniesScreen />, s.client);
    expect(button(view, /^Found for/).hasAttribute('disabled')).toBe(true);
    await type(view, 'Company name', 'Pixel Farm');
    await click(button(view, /^Found for/));
    expect(s.posts[0]).toMatchObject({
      route: FINANCE_ROUTES.companyFound,
      body: { name: 'Pixel Farm', kind: 'farm' },
    });
    expect([...view.container.querySelectorAll('h2')].map((h) => h.textContent)).toContain(
      'Pixel Farm',
    );
    expect(useBalanceStore.getState().balance).toBe(100_000);
  });

  it('invests in another company within the room and the minimum', async () => {
    const s = spy();
    const view = await show(<CompaniesScreen />, s.client);
    const row = view.container.querySelector('[data-owner="200000000000000002"]')!;
    const invest = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Invest')!;
    expect(invest.hasAttribute('disabled')).toBe(true);
    const input = row.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        '2000',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(invest);
    expect(s.posts[0]).toMatchObject({
      route: FINANCE_ROUTES.companyInvest,
      body: { ownerId: '200000000000000002', amount: 2000 },
    });
    expect(text(view)).toContain('Mika Farm');
  });
});

describe('copy', () => {
  const dir = join(import.meta.dirname);
  const sources = readdirSync(dir)
    .filter((f) => /\.(tsx?)$/.test(f) && !f.endsWith('.test.tsx'))
    .map((f) => readFileSync(join(dir, f), 'utf8'));

  it('every screen.finance key the code mentions exists in English and Japanese', () => {
    const used = new Set<string>();
    for (const src of sources) {
      for (const m of src.matchAll(/screen\.finance\.[A-Za-z0-9_.]+/g)) {
        if (!m[0].endsWith('.')) used.add(m[0]);
      }
    }
    expect(used.size).toBeGreaterThan(100);
    for (const key of used) {
      expect(dictionaries.en, key).toHaveProperty([key]);
      expect(dictionaries.ja, key).toHaveProperty([key]);
    }
  });

  it('covers every dynamic key family', () => {
    const families: [string, string[]][] = [
      ['bank.status', ['katagi', 'underground', 'bankrupt']],
      ['loans.role', ['lender', 'borrower', 'open']],
      [
        'loans.status',
        [
          'offer',
          'request',
          'active',
          'overdue',
          'repaid',
          'discharged',
          'declined',
          'cancelled',
          'expired',
        ],
      ],
      ['kyosai.offer', ['incoming', 'outgoing']],
      ['listings.mode', ['fixed', 'auction']],
      ['listings.kind', ['item', 'horse']],
      ['market.mode', ['spot', 'margin', 'call', 'put', 'pair', 'bond']],
      ['market.modeHelp', ['spot', 'margin', 'call', 'put', 'pair', 'bond']],
      ['market.do', ['spot', 'margin', 'call', 'put', 'pair', 'bond']],
      ['market.bond', ['normal', 'junk']],
      ['companies.kind', ['farm', 'mine']],
    ];
    for (const [family, values] of families) {
      for (const v of values) {
        expect(dictionaries.en).toHaveProperty([`screen.finance.${family}.${v}`]);
        expect(dictionaries.ja).toHaveProperty([`screen.finance.${family}.${v}`]);
      }
    }
  });
});
