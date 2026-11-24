// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { en, ja } from '@casino/shared/i18n';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useNavStore } from '../../shell/stores/nav.ts';
import { useSettingsStore } from '../../shell/stores/settings.ts';
import { useToastStore } from '../../shell/stores/toasts.ts';
import { resetStores } from '../../shell/testing/fakes.ts';
import { act, render, type Rendered } from '../../shell/testing/render.tsx';
import { LifeApiContext } from './api.tsx';
import { LifeApiError, type LifeApi } from './client.ts';
import { createMockLifeApi } from './mock.ts';
import InventoryScreen from './InventoryScreen.tsx';
import LaborScreen from './LaborScreen.tsx';
import LotteryScreen from './LotteryScreen.tsx';
import MissionsScreen from './MissionsScreen.tsx';
import PollScreen from './PollScreen.tsx';
import QuizScreen from './QuizScreen.tsx';
import RankingScreen from './RankingScreen.tsx';
import RelicsScreen, { bestStars } from './RelicsScreen.tsx';
import ShopScreen from './ShopScreen.tsx';
import TransferScreen, { parseAmount } from './TransferScreen.tsx';
import { errorMessage } from './hooks.ts';

let mounted: Rendered | null = null;
let api: LifeApi;
beforeEach(() => {
  resetStores();
  useBalanceStore.getState().set(12_400);
  api = createMockLifeApi();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function show(ui: ReactElement, provided: LifeApi = api): Promise<HTMLElement> {
  mounted = render(<LifeApiContext.Provider value={provided}>{ui}</LifeApiContext.Provider>);
  await flush();
  await flush();
  return mounted.container;
}

const text = (el: Element | null | undefined) => el?.textContent ?? '';
const button = (root: ParentNode, label: string | RegExp): HTMLButtonElement => {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    label instanceof RegExp ? label.test(text(b)) : text(b).includes(label),
  );
  if (!found)
    throw new Error(
      `no button "${label}" in: ${[...root.querySelectorAll('button')].map(text).join(' | ')}`,
    );
  return found;
};
const click = async (el: Element) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
};
const tab = (root: ParentNode, label: string) =>
  [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find((b) => text(b).includes(label))!;
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const toasts = () => useToastStore.getState().toasts.map((t) => t.messageKey);

describe('frame', () => {
  it('shows the title, a pixel icon and a link strip to the other life screens', async () => {
    const root = await show(<MissionsScreen />);
    expect(text(root.querySelector('h1'))).toBe('Missions');
    expect(root.querySelector('.life__icon.bb-px')).not.toBeNull();
    const chips = [...root.querySelectorAll('.life__nav .bb-chip')].map(text);
    expect(chips).toEqual([
      'Work',
      'Relics',
      'Shop',
      'Inventory',
      'Missions',
      'Ranking',
      'Transfer',
      'Quiz',
      'Lottery',
      'Poll',
    ]);
    expect(root.querySelector('.life__nav .bb-chip[aria-pressed="true"]')?.textContent).toBe(
      'Missions',
    );
    await click(button(root, 'Shop'));
    expect(useNavStore.getState().screen).toBe('shop');
  });

  it('follows the language setting', async () => {
    useSettingsStore.getState().update({ language: 'ja' });
    const root = await show(<MissionsScreen />);
    expect(text(root.querySelector('h1'))).toBe('ミッション');
    expect(text(root)).toContain('ゲームを5回遊ぶ');
    expect(text(root)).toContain('達成・受取済み');
  });

  it('offers a retry when a screen cannot load', async () => {
    let calls = 0;
    const flaky: LifeApi = {
      ...api,
      missions: () =>
        ++calls === 1 ? Promise.reject(new LifeApiError('internal', 500)) : api.missions(),
    };
    const root = await show(<MissionsScreen />, flaky);
    expect(text(root)).toContain("Couldn't load this screen.");
    await click(button(root, 'Try again'));
    expect(text(root)).toContain('Play 5 games');
  });
});

describe('missions', () => {
  it('lists the three missions with progress, the bonus and the reset time', async () => {
    const root = await show(<MissionsScreen />);
    const items = root.querySelectorAll('.life-mission');
    expect(items).toHaveLength(3);
    expect(text(items[0])).toContain('Play 5 games');
    expect(text(items[0])).toContain('Done · paid');
    expect(text(items[1])).toContain('Play Blackjack 3 times');
    expect(items[1]!.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      '2',
    );
    expect(text(items[2])).toContain('Win 3× your bet or more in one round');
    expect(text(root)).toContain('All three done: +500 Pelica more');
    expect(text(root)).toContain('paid the moment you finish');
    expect(text(root)).toContain('New missions in 9h');
  });
});

describe('ranking', () => {
  it('shows the week, the champion, your rank and the leaderboard', async () => {
    const root = await show(<RankingScreen />);
    expect(text(root)).toContain('Weekly ranking · 11/16–11/22');
    expect(text(root)).toContain('Reigning champion: Sora (3 wins)');
    expect(text(root)).toContain('Your rank: 2 of 9 · +6,200');
    const rows = root.querySelectorAll('li.bb-list__item, .bb-list li');
    expect(rows.length).toBe(5);
    expect(text(rows[0])).toContain('Aki');
    expect(text(rows[0])).toContain('+18,400');
    expect(text(rows[3])).toContain('−900');
    expect(text(rows[1])).toContain('Title contender');
    expect(text(rows[2])).not.toContain('Title contender');
  });

  it('keeps weekly as the first tab and adds net and current assets', async () => {
    const root = await show(<RankingScreen />);
    const tabs = [...root.querySelectorAll('[role="tab"]')].map(text);
    expect(tabs).toEqual(['Weekly', 'Net assets', 'Current assets']);
    expect(tab(root, 'Weekly').getAttribute('aria-selected')).toBe('true');
  });

  it('net assets: ranks with subtotals, then opens my balance sheet', async () => {
    const root = await show(<RankingScreen />);
    await click(tab(root, 'Net assets'));
    expect(text(root)).toContain('Net assets ranking');
    expect(text(root)).toContain('Your rank: 2 of 9');
    const rows = root.querySelectorAll('.bb-list li');
    expect(text(rows[0])).toContain('Aki');
    expect(text(rows[0])).toContain('(current 84,000 · fixed 62,000)');
    expect(text(rows[1])).toContain('liabilities 3,000');
    expect(text(rows[2])).toContain('(current 52,300)');
    expect(text(root)).toContain('Net assets = total assets − liabilities');
    await click(button(root, 'My breakdown'));
    const dialog = document.querySelector('[role="dialog"]');
    expect(text(dialog)).toContain('Your balance sheet');
    expect(text(dialog)).toContain('💴 Cash');
    expect(text(dialog)).toContain('🐎 Racehorses');
    expect(text(dialog)).toContain('💳 Borrowings (debt to Teiai)');
    expect(text(dialog)).not.toContain('Options');
  });

  it('current assets: horses and belongings drop out, so the order changes', async () => {
    const root = await show(<RankingScreen />);
    await click(tab(root, 'Current assets'));
    const rows = [...root.querySelectorAll('.bb-list li')].map(text);
    expect(rows[0]).toContain('Aki');
    expect(rows[1]).toContain('Sora');
    expect(text(root)).toContain('Your rank: 3 of 9');
  });
});

describe('labor', () => {
  it('digs: pays through the balance and counts the click', async () => {
    const root = await show(<LaborScreen />);
    expect(text(root)).toContain('Waiting to collect');
    expect(text(root)).toContain('1,240 Pelica');
    const before = useBalanceStore.getState().balance!;
    const dig = () => root.querySelector('.life-dig__button')!;
    await click(dig());
    expect(useBalanceStore.getState().balance!).toBeGreaterThan(before);
    expect(text(root.querySelector('.life__feedback'))).toMatch(/\+\d+|Vein hit/);
    // A second dig inside the cooldown pays nothing.
    await click(dig());
    expect(text(root.querySelector('.life__feedback'))).toBe('Too fast.');
  });

  it('collects the pot with the Teiai skim shown in the toast', async () => {
    const root = await show(<LaborScreen />);
    await click(button(root, 'Collect'));
    expect(toasts()).toContain('screen.life.work.collected');
    expect(useToastStore.getState().toasts[0]?.params).toMatchObject({
      net: '1,203',
      skimmed: '37',
    });
    expect(text(root)).toContain('0 Pelica');
  });

  it('upgrades a tool and refuses what the player cannot afford', async () => {
    useBalanceStore.getState().set(100);
    api = createMockLifeApi();
    const root = await show(<LaborScreen />);
    const up = button(root, 'Upgrade · 900');
    expect(up.disabled).toBe(true);
  });

  it('hires from the crew tab and fills the dorm', async () => {
    const root = await show(<LaborScreen />);
    await click(tab(root, 'Crew'));
    expect(text(root)).toContain('Crew 2 / 5');
    await click(button(root, 'Hire · 520'));
    expect(toasts()).toContain('screen.life.work.hired');
    expect(text(root)).toContain('Crew 3 / 5');
    await click(button(root, 'Hire · 1,160'));
    await click(button(root, 'Hire · 150'));
    expect(text(root)).toContain('Crew 5 / 5');
    expect(button(root, 'Hire · 640').disabled).toBe(true);
  });

  it('merges ten relics into the next star', async () => {
    const root = await show(<LaborScreen />);
    await click(tab(root, 'Relics'));
    expect(text(root)).toContain('Trilobite fossil  ×12');
    await click(button(root, 'Merge 10 → Trilobite fossil★'));
    expect(toasts()).toContain('screen.life.relic.merged');
    expect(text(root)).toContain('Trilobite fossil  ×2');
    expect(text(root)).toContain('Trilobite fossil★  ×1');
  });

  it('ranks today and all time', async () => {
    const root = await show(<LaborScreen />);
    await click(tab(root, 'Ranking'));
    expect(text(root)).toContain('Aki');
    expect(text(root)).toContain('5,400 Pelica');
    await click(button(root, 'All time'));
    expect(text(root)).toContain('91,200 Pelica');
    expect(text(root)).toContain('Your rank: 2 of 7');
  });
});

describe('labor: layout and routes', () => {
  it('keeps the daily progress and the rock layer inside the dig card', async () => {
    const root = await show(<LaborScreen />);
    const card = root.querySelector('.life-dig')!;
    expect(text(card)).toContain('Today:');
    expect(text(card)).toContain("Today's rock layer");
    expect(root.querySelector('.life-dig + .bb-progress-wrap')).toBeNull();
  });

  it('shows the mine above the dig card and a sprite on every find', async () => {
    const root = await show(<LaborScreen />);
    expect(root.querySelector('.life-mine + .life-dig')).not.toBeNull();
    expect(root.querySelector('.life-mine svg')!.getAttribute('aria-hidden')).toBe('true');
    const finds = [...root.querySelectorAll('.life__tags .bb-tag')];
    expect(finds.length).toBeGreaterThan(0);
    for (const tag of finds) expect(tag.querySelector('svg.life-find')).not.toBeNull();
  });

  it('opens the relics screen id on the relics tab', async () => {
    const root = await show(<RelicsScreen />);
    expect(text(root.querySelector('h1'))).toBe('Relics');
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Relics');
  });
});

describe('inventory', () => {
  it('lists what the shop says is owned, with a pixel icon and a count', async () => {
    const root = await show(<InventoryScreen />);
    expect(text(root.querySelector('h1'))).toBe('Inventory');
    const rows = [...root.querySelectorAll('.bb-list li')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.querySelector('svg.bb-px.life-item__icon')).not.toBeNull();
      expect(row.querySelector('.life-slot--box .life-slot__bg')).not.toBeNull();
    }
    expect(root.querySelector('.life-banner svg')).not.toBeNull();
    expect(text(rows.find((r) => text(r).includes('Rookie Gambler')))).toContain('×1');
  });
});

describe('quiz', () => {
  it('answers once, shows the result and the reward, then moves on', async () => {
    const root = await show(<QuizScreen />);
    expect(text(root)).toContain('Which planet has the most moons?');
    expect(text(root)).toContain('150 Pelica for a right answer');
    const before = useBalanceStore.getState().balance!;
    await click(button(root, 'Saturn'));
    expect(text(root)).toContain('Correct!');
    expect(text(root)).toContain('Reward: 150 Pelica');
    expect(text(root)).toContain('Saturn has more than 140');
    expect(useBalanceStore.getState().balance).toBe(before + 150);
    await click(button(root, 'Next quiz'));
    expect(text(root)).toContain('How many sides does a hexagon have?');
    expect(text(root)).toContain('Official quiz');
  });

  it('shows a wrong answer with the right one', async () => {
    const root = await show(<QuizScreen />);
    await click(button(root, 'Mars'));
    expect(text(root)).toContain('Wrong… The answer was “Saturn”.');
  });

  it('posts a quiz with four distinct choices and lists it under mine', async () => {
    const root = await show(<QuizScreen />);
    await click(tab(root, 'Post a quiz'));
    const fields = [...root.querySelectorAll<HTMLInputElement>('input')];
    const submit = button(root, /^Post quiz$/);
    expect(submit.disabled).toBe(true);
    await type(fields[0]!, 'Capital of Japan?');
    await type(fields[1]!, 'Tokyo');
    await type(fields[2]!, 'Osaka');
    await type(fields[3]!, 'Kyoto');
    await type(fields[4]!, 'Nagoya');
    expect(button(root, /^Post quiz$/).disabled).toBe(false);
    await click(button(root, /^Post quiz$/));
    expect(toasts()).toContain('screen.life.quiz.posted');
    await click(tab(root, 'My quizzes'));
    expect(text(root)).toContain('Capital of Japan?');
  });

  it('asks before withdrawing', async () => {
    const root = await show(<QuizScreen />);
    await click(tab(root, 'My quizzes'));
    expect(text(root)).toContain('4 answered · 2 right · earned 310 Pelica');
    await click(button(root, 'Withdraw'));
    expect(text(document.body)).toContain('Withdraw this quiz?');
    const confirm = [...document.body.querySelectorAll('[role="alertdialog"] button')].find(
      (b) => text(b) === 'Withdraw',
    )!;
    await click(confirm);
    expect(toasts()).toContain('screen.life.quiz.withdrawn');
    expect(text(root)).toContain('You have no open quizzes.');
  });
});

describe('lottery', () => {
  it('shows the pool and buys a ticket once', async () => {
    const root = await show(<LotteryScreen />);
    expect(text(root)).toContain('5,000 Pelica');
    expect(text(root)).toContain('Hosted by Aki');
    expect(text(root)).toContain('Draws in 25m');
    const before = useBalanceStore.getState().balance!;
    await click(button(root, 'Buy a ticket · 1,000 Pelica'));
    expect(useBalanceStore.getState().balance).toBe(before - 1000);
    expect(text(root)).toContain("You're in");
    expect(text(root)).toContain('6,000 Pelica');
    expect(toasts()).toContain('screen.life.lottery.joined');
    expect(
      [...root.querySelectorAll('button')].some((b) => text(b).startsWith('Buy a ticket')),
    ).toBe(false);
  });

  it('reports the last draw', async () => {
    const root = await show(<LotteryScreen />);
    expect(text(root)).toContain('Sora won 4,000 Pelica (8 entrants).');
  });

  it('says so when no lottery is open', async () => {
    const empty: LifeApi = {
      ...api,
      lottery: () =>
        Promise.resolve({ now: 1, balance: 1, current: null, last: null, minEntrants: 2 }),
    };
    const root = await show(<LotteryScreen />, empty);
    expect(text(root)).toContain('No lottery is open right now.');
    expect(text(root)).toContain('No lottery has been drawn yet.');
  });
});

describe('polls', () => {
  it('lists open and closed polls and moves a vote', async () => {
    const root = await show(<PollScreen />);
    const cards = root.querySelectorAll('.life-poll');
    expect(cards).toHaveLength(3);
    expect(text(cards[0])).toContain('Should the weekly ranking pay a bonus?');
    expect(text(cards[0])).toContain('8 votes');
    await click(button(cards[0]!, 'No'));
    expect(toasts()).toContain('screen.life.poll.voted');
    const after = root.querySelectorAll('.life-poll')[0]!;
    expect(text(after)).toContain('You voted No');
    expect(text(root.querySelectorAll('.life-poll')[2])).toContain('Result: No wins');
    expect(root.querySelectorAll('.life-poll')[2]!.querySelector('button')).toBeNull();
  });

  it('starts a poll', async () => {
    const root = await show(<PollScreen />);
    const submit = button(root, 'Start poll');
    expect(submit.disabled).toBe(true);
    await type(root.querySelector<HTMLInputElement>('input')!, 'Tea or coffee?');
    await click(button(root, 'Start poll'));
    expect(toasts()).toContain('screen.life.poll.created');
    expect(text(root)).toContain('Tea or coffee?');
  });
});

describe('shop', () => {
  it('lists a category, buys a cheap item straight away and skips owned titles', async () => {
    const root = await show(<ShopScreen />);
    expect(text(root)).toContain('Titles');
    const owned = [...root.querySelectorAll('.bb-list li')].find((li) =>
      text(li).includes('Rookie Gambler'),
    )!;
    expect(text(owned)).toContain('Owned');
    expect(owned.querySelector('button')).toBeNull();
    await click(button(root, 'Consumables'));
    const before = useBalanceStore.getState().balance!;
    const row = [...root.querySelectorAll('.bb-list li')].find((li) =>
      text(li).includes('Insurance Ticket'),
    )!;
    await click(row.querySelector('button')!);
    expect(useBalanceStore.getState().balance).toBe(before - 2000);
    expect(toasts()).toContain('screen.life.shop.bought');
  });

  it('shows pixel icons and no emoji on the shelf', async () => {
    const root = await show(<ShopScreen />);
    expect(root.querySelector('.life-banner svg')).not.toBeNull();
    for (const row of root.querySelectorAll('.bb-list li')) {
      expect(row.querySelector('svg.bb-px.life-item__icon')).not.toBeNull();
      expect(row.querySelector('.life-slot--shelf .life-slot__bg')).not.toBeNull();
      expect(text(row)).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('asks before an expensive purchase', async () => {
    useBalanceStore.getState().set(50_000);
    api = createMockLifeApi();
    const root = await show(<ShopScreen />);
    const row = [...root.querySelectorAll('.bb-list li')].find((li) =>
      text(li).includes('Lucky Soul'),
    )!;
    await click(row.querySelector('button')!);
    expect(text(document.body)).toContain('Buy Lucky Soul for 20,000 Pelica?');
  });

  it('sells black-market lots blind, with a warning, then reveals the item', async () => {
    const root = await show(<ShopScreen />);
    await click(tab(root, 'Teiai market'));
    expect(text(root)).toContain('Black market open');
    expect(text(root)).toContain('Mystery item');
    await click(
      [...root.querySelectorAll('.bb-list li')]
        .find((li) => text(li).includes('Mystery item'))!
        .querySelector('button')!,
    );
    expect(text(document.body)).toContain("You won't know what it is until you buy it");
    const confirm = [...document.body.querySelectorAll('[role="dialog"] button')].find(
      (b) => text(b) === 'Buy',
    )!;
    await click(confirm);
    expect(text(document.body)).toContain('Better than it looked!');
  });

  it('buys seized goods', async () => {
    const root = await show(<ShopScreen />);
    await click(tab(root, 'Seized goods'));
    expect(text(root)).toContain('Goods seized from bankrupt players');
    const before = useBalanceStore.getState().balance!;
    await click(root.querySelector('.bb-list li button')!);
    expect(useBalanceStore.getState().balance).toBe(before - 2700);
    expect(text(root)).not.toContain('2,700 Pelica');
  });

  it('blocks debtors', async () => {
    const debtor: LifeApi = { ...api, shop: async () => ({ ...(await api.shop()), debt: 4000 }) };
    const root = await show(<ShopScreen />, debtor);
    expect(text(root)).toContain('You owe Teiai 4,000 Pelica. Debtors cannot shop.');
    expect(
      [...root.querySelectorAll('.bb-list button')].every((b) => (b as HTMLButtonElement).disabled),
    ).toBe(true);
  });
});

describe('transfer', () => {
  it('previews the fee, sends, and updates the day total', async () => {
    const root = await show(<TransferScreen />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 260));
    });
    await click(
      [...root.querySelectorAll('.bb-list [role="option"], .bb-list li')].find((li) =>
        text(li).includes('Ren'),
      )!,
    );
    const input = [...root.querySelectorAll<HTMLInputElement>('input')].find(
      (i) => i.inputMode === 'numeric',
    )!;
    await type(input, '1,000');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(text(root.querySelector('.life__sum'))).toContain('100 Pelica');
    expect(text(root.querySelector('.life__sum'))).toContain('1,100 Pelica');
    const before = useBalanceStore.getState().balance!;
    await click(button(root, /^Send$/));
    expect(useBalanceStore.getState().balance).toBe(before - 1100);
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      messageKey: 'screen.life.transfer.sent',
      params: { amount: '1,000', name: 'Ren', fee: '100' },
    });
    expect(text(root)).toContain('Sent today: 3,000');
  });

  it('shows the limit as a rule and keeps Send off', async () => {
    const root = await show(<TransferScreen />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 260));
    });
    await click([...root.querySelectorAll('.bb-list li')].find((li) => text(li).includes('Aki'))!);
    const input = [...root.querySelectorAll<HTMLInputElement>('input')].find(
      (i) => i.inputMode === 'numeric',
    )!;
    await type(input, '19000');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(text(root.querySelector('[role="alert"]'))).toContain(
      'You can send up to 20,000 Pelica a day (2,000 sent today).',
    );
    expect(button(root, /^Send$/).disabled).toBe(true);
  });

  it('parses typed amounts', () => {
    expect(parseAmount('1,000')).toBe(1000);
    expect(parseAmount(' 25 ')).toBe(25);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('12.5')).toBe(0);
    expect(parseAmount('-4')).toBe(0);
    expect(parseAmount('99999999')).toBe(0);
  });
});

describe('errors and keys', () => {
  it('maps a rule to its own text and an unknown one to the generic code text', () => {
    useBalanceStore.getState().set(1);
    expect(errorMessage(new LifeApiError('conflict', 409, { rule: 'labor_not_tired' }))).toEqual({
      key: 'screen.life.rule.labor_not_tired',
      params: {},
    });
    expect(
      errorMessage(
        new LifeApiError('conflict', 409, {
          rule: 'transfer_daily_limit',
          params: { daily_limit: 20000, sent_today: 5 },
        }),
      ),
    ).toEqual({
      key: 'screen.life.rule.transfer_daily_limit',
      params: { daily_limit: '20,000', sent_today: '5' },
    });
    expect(errorMessage(new LifeApiError('conflict', 409, { rule: 'brand_new_rule' })).key).toBe(
      'error.conflict',
    );
    expect(errorMessage(new LifeApiError('rate_limited', 429)).key).toBe('error.rate_limited');
    expect(errorMessage(new Error('x')).key).toBe('error.internal');
  });

  it('has a rule text for every rule the server can name, in both languages', () => {
    const server = readFileSync(
      join(__dirname, '../../../../server/src/http/activity/life.ts'),
      'utf8',
    );
    const named = [...server.matchAll(/'([a-z_]+)'(?:, \{\}, 'not_found')/g)].map((m) => m[1]!);
    const rules = [
      ...named,
      'labor_not_tired',
      'labor_no_drink',
      'labor_max_level',
      'labor_dorm_full',
      'labor_no_worker',
      'labor_nothing_to_collect',
      'insufficient_balance',
      'relic_not_relic',
      'relic_max_star',
      'relic_need_more',
      'quiz_not_found',
      'quiz_question_invalid',
      'choices_need_four',
      'choice_empty',
      'choice_duplicate',
      'choice_too_long',
      'quiz_explanation_long',
      'quiz_minutes',
      'quiz_reward_invalid',
      'debt_blocks',
      'open_limit',
      'daily_limit',
      'quiz_ended',
      'quiz_wrong_guild',
      'quiz_self_answer',
      'quiz_already_answered',
      'forbidden',
      'raffle_closed',
      'raffle_already_joined',
      'poll_title_invalid',
      'poll_duration_invalid',
      'poll_open_limit',
      'poll_closed',
      'invalid_quantity',
      'unknown_item',
      'not_for_sale',
      'already_owned',
      'out_of_stock',
      'auction_katagi_only',
      'lot_gone',
      'not_owned',
      'transfer_self',
      'amount_must_be_positive',
      'transfer_min_games',
      'transfer_daily_limit',
      'transfer_insufficient_balance',
      'transfer_unknown_member',
    ];
    for (const rule of new Set(rules)) {
      expect(en, rule).toHaveProperty(`screen.life.rule.${rule}`);
      expect(ja, rule).toHaveProperty(`screen.life.rule.${rule}`);
    }
  });

  it('only uses message keys that exist', () => {
    const dir = __dirname;
    const keys = new Set<string>();
    for (const file of readdirSync(dir).filter(
      (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.tsx'),
    )) {
      for (const m of readFileSync(join(dir, file), 'utf8').matchAll(
        /'(screen\.life\.[A-Za-z0-9_.]+)'/g,
      )) {
        keys.add(m[1]!);
      }
    }
    expect(keys.size).toBeGreaterThan(100);
    for (const key of keys) {
      expect(en, key).toHaveProperty(key);
      expect(ja, key).toHaveProperty(key);
    }
  });

  it('has text for every dynamic key family', () => {
    const families: [string, string[]][] = [
      ['screen.life.work.worker.', ['apprentice', 'miner', 'craftsman', 'foreman']],
      ['screen.life.work.terrain.', ['hit', 'fatigue', 'silver', 'none']],
      ['screen.life.work.tool.', ['pick', 'glove', 'dorm']],
      ['screen.life.work.ore.', ['coal', 'copper', 'silver', 'gold', 'diamond', 'legend']],
      [
        'screen.life.relic.',
        ['relic_fossil', 'relic_bone', 'relic_meteor', 'relic_vase', 'relic_crown', 'relic_tear'],
      ],
      ['screen.life.relic.buff.', ['click', 'wage', 'luck', 'recovery', 'daily', 'prize']],
      [
        'screen.life.missions.kind.',
        ['play', 'win', 'wager', 'streak', 'play_game', 'game_win', 'big_win'],
      ],
      ['screen.life.missions.tag.', ['natural', 'double_win']],
      [
        'screen.life.shop.kind.',
        [
          'title',
          'card_color',
          'card_icon',
          'consumable',
          'racing',
          'skin_dice',
          'skin_table',
          'collection',
          'color_role',
        ],
      ],
      ['screen.life.shop.mode.', ['auction', 'fixed']],
      ['screen.life.shop.revealed.', ['same', 'worse', 'better']],
      ['screen.life.poll.result.', ['yes', 'no', 'tie']],
      ['screen.life.unit.', ['d', 'h', 'm', 's']],
    ];
    for (const [prefix, names] of families) {
      for (const name of names) {
        expect(en, prefix + name).toHaveProperty(prefix + name);
        expect(ja, prefix + name).toHaveProperty(prefix + name);
      }
    }
  });
});

describe('social scenes', () => {
  const scene = (root: ParentNode) => root.querySelector('.sc-scene > svg.bb-scene');

  it('draws the quiz stage and letters the answers without changing their names', async () => {
    const root = await show(<QuizScreen />);
    expect(scene(root)?.getAttribute('aria-hidden')).toBe('true');
    const choices = [...root.querySelectorAll<HTMLButtonElement>('.life__choice')];
    expect(choices.map((b) => b.querySelector('.sc-letter')?.textContent)).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);
    for (const b of choices)
      expect(b.querySelector('.sc-letter')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('.sc-fx')).toBeNull();
    await click(button(root, 'Mars'));
    // a cross on the wrong pick, a ring on the right answer
    expect(root.querySelectorAll('.sc-fx')).toHaveLength(2);
    expect(text(root)).toContain('Wrong… The answer was “Saturn”.');
  });

  it('shows the answer effects on their still frame under reduced motion', async () => {
    document.documentElement.setAttribute('data-reduced-motion', 'true');
    try {
      const root = await show(<QuizScreen />);
      await click(button(root, 'Saturn'));
      expect(root.querySelectorAll('.sc-fx')).toHaveLength(1);
      expect(text(root)).toContain('Correct!');
    } finally {
      document.documentElement.removeAttribute('data-reduced-motion');
    }
  });

  it('pins every mission note and stamps the done ones', async () => {
    const root = await show(<MissionsScreen />);
    expect(scene(root)).not.toBeNull();
    const notes = [...root.querySelectorAll('.life-mission')];
    expect(notes).toHaveLength(3);
    for (const note of notes) expect(note.querySelector('.sc-pin')).not.toBeNull();
    expect(notes.map((n) => !!n.querySelector('.sc-stamp'))).toEqual(
      notes.map((n) => n.getAttribute('data-done') === 'true'),
    );
  });

  it('gives places 1 to 3 a medal named by its place', async () => {
    const root = await show(<RankingScreen />);
    expect(scene(root)).not.toBeNull();
    const rows = [...root.querySelectorAll('.bb-list li')];
    const medals = rows.map((r) => r.querySelector('.sc-medal svg')?.getAttribute('aria-label'));
    expect(medals.slice(0, 3)).toEqual(['1', '2', '3']);
    expect(medals[3]).toBeUndefined();
    expect(text(rows[3]?.querySelector('.bb-avatar'))).toBe('4');
  });

  it('puts the counter over the lottery and a ticket on the buy button', async () => {
    const root = await show(<LotteryScreen />);
    expect(scene(root)).not.toBeNull();
    expect(button(root, 'Buy a ticket').querySelector('svg.sc-ticket')).not.toBeNull();
  });

  it('draws the voting corner and a ballot by each poll title', async () => {
    const root = await show(<PollScreen />);
    expect(scene(root)).not.toBeNull();
    for (const card of root.querySelectorAll('.life-poll'))
      expect(card.querySelector('.bb-card__title svg.sc-ballot')).not.toBeNull();
  });

  it('draws the street above the transfer form', async () => {
    const root = await show(<TransferScreen />);
    expect(scene(root)).not.toBeNull();
  });

  it('shows the museum over the relics, naming what is on display', async () => {
    const root = await show(<RelicsScreen />);
    const hall = scene(root);
    expect(hall?.getAttribute('role')).toBe('img');
    expect(hall?.getAttribute('aria-label')).toBe('Trilobite fossil, Dinosaur bone, Ancient vase★');
    // the museum sits above the tabs, inside the screen
    expect(root.querySelector('.life .sc-scene + div > [role="tablist"]')).not.toBeNull();
  });

  it('keeps the labor screen as it was: no museum without a hero', async () => {
    const root = await show(<LaborScreen />);
    expect(root.querySelector('.sc-scene')).toBeNull();
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Dig');
  });

  it('reads the best star level held of each relic kind', () => {
    expect(
      bestStars({ relic_vase: 3, relic_vase_s2: 1, relic_bone_s1: 0, relic_tear_s3: 2, coal: 4 }),
    ).toEqual({ relic_vase: 2, relic_tear: 3 });
  });
});
