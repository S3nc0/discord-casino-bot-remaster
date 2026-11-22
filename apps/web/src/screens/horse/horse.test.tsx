// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { HorseApiError, type HorseApi } from './api.ts';
import { HorseApiProvider } from './context.tsx';
import { errorText } from './hooks.ts';
import { formatCountdown, formatOdds, formatPicks, formatSpan } from './format.ts';
import { createMockHorseApi } from './mock.ts';
import { HorseScreen } from './HorseScreen.tsx';
import { ticketKey } from './BetSlip.tsx';
import { commentary, leaderIndex, positionsAt } from './RaceTrack.tsx';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useSettingsStore } from '../../shell/stores/settings.ts';
import { useToastStore } from '../../shell/stores/toasts.ts';
import { translate } from '../../shell/i18n.ts';
import { resetStores } from '../../shell/testing/fakes.ts';
import { act, render, type Rendered } from '../../shell/testing/render.tsx';

const NOW = 1_800_000_000_000;

let mounted: Rendered | null = null;
beforeEach(() => {
  resetStores();
  useBalanceStore.getState().set(12_400);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-reduced-motion');
});

/** Let pending promises and the state updates they cause settle. */
async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function show(
  api: HorseApi = createMockHorseApi({ now: () => NOW, balance: 12_400 }),
): Promise<Rendered> {
  const ui: ReactElement = (
    <HorseApiProvider api={api}>
      <HorseScreen />
    </HorseApiProvider>
  );
  mounted = render(ui);
  await settle();
  return mounted;
}

const $ = (root: ParentNode, selector: string) => root.querySelector<HTMLElement>(selector)!;
const $$ = (root: ParentNode, selector: string) => [
  ...root.querySelectorAll<HTMLElement>(selector),
];
const button = (root: ParentNode, label: RegExp | string) =>
  $$(root, 'button').find((b) =>
    typeof label === 'string' ? b.textContent?.trim() === label : label.test(b.textContent ?? ''),
  )!;
const click = async (el: HTMLElement | undefined) => {
  expect(el, 'element to click').toBeDefined();
  act(() => el!.click());
  await settle();
};
const type = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
};
const tab = (root: ParentNode, name: string) =>
  $$(root, '[role="tab"]').find((el) => el.textContent === name)!;

describe('pure helpers', () => {
  it('formats odds, countdowns, spans and ticket picks', () => {
    expect(formatOdds(43)).toBe('4.3');
    expect(formatCountdown(61_000)).toBe('1:01');
    expect(formatCountdown(3_661_000)).toBe('1:01:01');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(formatSpan(19 * 3_600_000)).toBe('19h 0m');
    expect(formatSpan(50 * 3_600_000)).toBe('2d 2h');
    expect(formatPicks('4>2>1')).toBe('4 → 2 → 1');
    expect(formatPicks('2-4')).toBe('2 - 4');
  });

  it('builds the ticket key the server stores', () => {
    expect(ticketKey('win', [3])).toBe('3');
    expect(ticketKey('quinella', [4, 2])).toBe('2-4');
    expect(ticketKey('wide', [5, 1])).toBe('1-5');
    expect(ticketKey('exacta', [4, 2])).toBe('4>2');
    expect(ticketKey('trio', [5, 1, 3])).toBe('1-3-5');
    expect(ticketKey('trifecta', [5, 1, 3])).toBe('5>1>3');
  });

  it('reads positions and commentary from the timeline', () => {
    const timeline = {
      raceId: 1,
      track: { distance: 1600, going: '良' },
      runners: [
        { lane: 1, name: 'A', silks: '🟥', mine: false },
        { lane: 2, name: 'B', silks: '🟦', mine: true },
      ],
      frames: [
        [100, 200],
        [600, 750],
        [1000, 900],
      ],
      placings: [1, 2],
    };
    expect(positionsAt(timeline, 0)).toEqual([0, 0]);
    expect(positionsAt(timeline, 2)).toEqual([600, 750]);
    expect(positionsAt(timeline, 99)).toEqual([1000, 900]);
    expect(leaderIndex([600, 750])).toBe(1);
    expect(commentary(timeline, 0).key).toBe('screen.horse.live.start');
    expect(commentary(timeline, 1)).toEqual({ key: 'screen.horse.live.lead', name: 'B' });
    expect(commentary(timeline, 2)).toEqual({ key: 'screen.horse.live.stretch', name: 'B' });
    expect(commentary(timeline, 3)).toEqual({ key: 'screen.horse.live.goal', name: 'A' });
  });
});

describe('refusals read as the game rule', () => {
  const t = (locale: 'en' | 'ja') => (key: string, params?: Record<string, string | number>) =>
    translate(locale, key, params);
  it('maps a rule to its own text in both languages, with its numbers', () => {
    const error = new HorseApiError('invalid_payload', 400, 'stake_range', {
      min_stake: 100,
      max_stake: 50_000,
    });
    expect(errorText(t('en'), 'en', error)).toBe('Stake 100 to 50000.');
    expect(errorText(t('ja'), 'ja', error)).toBe('賭け金は 100〜50000 にしてください。');
  });

  it('uses the breeding texts and the stable rules for their numbers', () => {
    const rules = { breedMinRaces: 4, maxFoals: 2, maxHorses: 3, nameMax: 12 };
    expect(
      errorText(
        t('en'),
        'en',
        new HorseApiError('conflict', 409, 'min_races', { name: 'Ace' }),
        rules,
      ),
    ).toBe('Ace needs 4 races before breeding.');
    expect(errorText(t('ja'), 'ja', new HorseApiError('conflict', 409, 'stable_full'), rules)).toBe(
      '厩舎がいっぱいです（3 頭まで）。先に引退か売却をしてください。',
    );
  });

  it('falls back to the error code, then to a generic line', () => {
    expect(errorText(t('en'), 'en', new HorseApiError('rate_limited', 429))).toBe(
      translate('en', 'error.rate_limited'),
    );
    expect(errorText(t('ja'), 'ja', new HorseApiError('conflict', 409, 'unknown_rule'))).toBe(
      translate('ja', 'error.conflict'),
    );
    expect(errorText(t('en'), 'en', new Error('boom'))).toBe('That did not work. Try again.');
  });
});

describe('race card', () => {
  it('lists today’s races with their phase, runners and my entry', async () => {
    const view = await show();
    const races = $$(view.container, '.hr-race');
    expect(races).toHaveLength(4);
    expect(races[0]!.textContent).toContain('Race 1');
    expect(races[0]!.textContent).toContain('Finished');
    expect(races[0]!.textContent).toContain('Your tickets: 800');
    expect(races[1]!.textContent).toContain('Betting open');
    expect(races[2]!.textContent).toContain('Entries open');
    expect(races[2]!.textContent).toContain('3/8 entered');
    expect(races[3]!.textContent).toContain('Major');
    expect(races[3]!.textContent).toContain('Entries open');
  });

  it('follows the language setting', async () => {
    useSettingsStore.getState().update({ language: 'ja' });
    const view = await show();
    expect($$(view.container, '.hr-race')[0]!.textContent).toContain('第1競走');
    expect($$(view.container, '.hr-race')[1]!.textContent).toContain('馬券発売中');
    expect($(view.container, 'h1').textContent).toBe('競馬');
  });
});

describe('a race in the betting window', () => {
  async function openBetting() {
    const view = await show();
    await click($$(view.container, '.hr-race')[1]);
    return view;
  }

  it('shows eight runners with stats, forms and odds, and the seven ticket types', async () => {
    const view = await openBetting();
    expect($$(view.container, '.hr-runner')).toHaveLength(8);
    expect($$(view.container, '.hr-runner')[0]!.textContent).toContain('Win ×');
    const kinds = $$(view.container, '.hr-kinds .bb-chip').map((c) => c.textContent);
    expect(kinds).toEqual(['Win', 'Place', 'Quinella', 'Wide', 'Exacta', 'Trio', 'Trifecta']);
    expect($$(view.container, '.hr-cells')).toHaveLength(8);
  });

  it('buys one win ticket per picked horse with its own idempotency key', async () => {
    const calls: { lanes: number[]; key: string; stake: number }[] = [];
    const real = createMockHorseApi({ now: () => NOW, balance: 12_400 });
    const api: HorseApi = {
      ...real,
      bet: (id, intent, key) => {
        calls.push({ lanes: intent.lanes, key, stake: intent.stake });
        return real.bet(id, intent, key);
      },
    };
    const view = await show(api);
    await click($$(view.container, '.hr-race')[1]);
    const picks = $$(view.container, '.hr-picks .bb-chip');
    await click(picks[0]);
    await click(picks[2]);
    expect(view.container.textContent).toContain('Total 1,000 Pelica');
    await click(button(view.container, 'Buy 2 tickets'));
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.lanes)).toEqual([[1], [3]]);
    expect(new Set(calls.map((c) => c.key)).size).toBe(2);
    expect(calls.every((c) => c.stake === 500)).toBe(true);
    expect($$(view.container, '.hr-ticket')).toHaveLength(2);
    expect(useBalanceStore.getState().balance).toBe(11_400);
    expect(view.container.textContent).toContain('Ticket bought');
  });

  it('keeps the order of the picks for an exacta and quotes its odds', async () => {
    const calls: number[][] = [];
    const real = createMockHorseApi({ now: () => NOW, balance: 12_400 });
    const api: HorseApi = {
      ...real,
      bet: (id, intent, key) => {
        calls.push(intent.lanes);
        return real.bet(id, intent, key);
      },
    };
    const view = await show(api);
    await click($$(view.container, '.hr-race')[1]);
    await click(button(view.container, 'Exacta'));
    const picks = $$(view.container, '.hr-picks .bb-chip');
    await click(picks[3]);
    await click(picks[1]);
    expect(view.container.querySelector('.hr-quote')!.textContent).toMatch(/Odds ×\d+\.\d/);
    await click(button(view.container, 'Buy ticket'));
    expect(calls).toEqual([[4, 2]]);
    expect($$(view.container, '.hr-ticket')[0]!.textContent).toContain('4 → 2');
  });

  it('disables the buy button for a stake outside the limits and shows the rule when refused', async () => {
    const view = await show();
    await click($$(view.container, '.hr-race')[1]);
    await click($$(view.container, '.hr-picks .bb-chip')[0]);
    const input = view.container.querySelector<HTMLInputElement>('.hr-stake input')!;
    await type(input, '50');
    expect((button(view.container, 'Buy ticket') as HTMLButtonElement).disabled).toBe(true);
    await type(input, '60000');
    expect((button(view.container, 'Buy ticket') as HTMLButtonElement).disabled).toBe(true);
    await type(input, '500');
    expect((button(view.container, 'Buy ticket') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the server’s rule text when a ticket is refused', async () => {
    const real = createMockHorseApi({ now: () => NOW, balance: 12_400 });
    const api: HorseApi = {
      ...real,
      bet: () => Promise.reject(new HorseApiError('conflict', 409, 'bet_closed')),
    };
    const view = await show(api);
    await click($$(view.container, '.hr-race')[1]);
    await click($$(view.container, '.hr-picks .bb-chip')[0]);
    await click(button(view.container, 'Buy ticket'));
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain(
      'Betting has closed.',
    );
  });
});

describe('a race that has run', () => {
  async function openDone() {
    const view = await show();
    await click($$(view.container, '.hr-race')[0]);
    return view;
  }

  it('lists the placings, my prize, my tickets and their payouts', async () => {
    const view = await openDone();
    const placings = $$(view.container, '.hr-placing');
    expect(placings).toHaveLength(8);
    expect(placings[0]!.textContent).toContain('1');
    expect(view.container.textContent).toContain('Prize money: 5,000 Pelica');
    expect(view.container.textContent).toContain('Ticket payouts');
    expect($$(view.container, '.hr-ticket')).toHaveLength(2);
    expect($$(view.container, '.hr-ticket')[0]!.textContent).toContain('Paid');
  });

  it('plays the timeline in steps, shows the goal and can be skipped', async () => {
    vi.useFakeTimers();
    const view = await show();
    await click($$(view.container, '.hr-race')[0]);
    await click(button(view.container, 'Watch the race'));
    expect($$(view.container, '.hr-lane')).toHaveLength(8);
    expect(view.container.querySelector('.hr-track__line')!.textContent).toContain('off!');
    act(() => {
      vi.advanceTimersByTime(260 * 3);
    });
    const early = view.container
      .querySelector<HTMLElement>('.hr-lane__runner')!
      .style.getPropertyValue('--p');
    expect(Number(early)).toBeGreaterThan(0);
    expect(view.container.querySelectorAll('.hr-horse.is-running').length).toBeGreaterThan(0);
    await click(button(view.container, 'Skip to the result'));
    expect(view.container.querySelector('.hr-track__line')!.textContent).toContain('wins!');
    expect(view.container.querySelectorAll('.hr-horse.is-running')).toHaveLength(0);
    expect(button(view.container, 'Watch again')).toBeDefined();
  });

  it('shows the finished race at once when animations are reduced', async () => {
    document.documentElement.setAttribute('data-reduced-motion', 'true');
    const view = await openDone();
    await click(button(view.container, 'Watch the race'));
    expect(view.container.querySelector('.hr-track__line')!.textContent).toContain('wins!');
    expect(view.container.textContent).toContain('Animations are reduced');
    expect(view.container.querySelectorAll('.hr-horse.is-running')).toHaveLength(0);
  });
});

describe('entering a race', () => {
  it('enters a horse and withdraws it with a refund', async () => {
    const view = await show();
    await click($$(view.container, '.hr-race')[2]);
    expect(view.container.textContent).toContain('Entry fee 1,000 Pelica');
    await click($$(view.container, '.hr-picks .bb-chip')[0]);
    await click(button(view.container, /^Enter /));
    expect(useBalanceStore.getState().balance).toBe(11_400);
    expect(view.container.textContent).toContain('is entered.');
    await click(button(view.container, /^Withdraw /));
    expect(useBalanceStore.getState().balance).toBe(12_400);
    expect(view.container.textContent).not.toContain('is entered.');
    expect(useToastStore.getState().toasts.map((x) => x.messageKey)).toEqual([
      'screen.horse.entry.done',
      'screen.horse.entry.withdrawn',
    ]);
  });
});

describe('stable', () => {
  async function openStable() {
    const view = await show();
    await click(tab(view.container, 'Stable'));
    return view;
  }

  it('shows each horse with stats, record, style and items', async () => {
    const view = await openStable();
    expect($$(view.container, '.hr-horsecard')).toHaveLength(2);
    const first = $$(view.container, '.hr-horsecard')[0]!;
    expect(first.querySelector('.hr-horse')).not.toBeNull();
    expect(first.textContent).toContain('Speed');
    expect(first.textContent).toContain('9 runs, 3 wins, 5 top 3');
    expect($$(first, '.hr-stats__row')).toHaveLength(4);
    expect(view.container.textContent).toContain('Carrot ×2');
    expect(view.container.textContent).toContain('2/3');
  });

  it('moves points with a carrot, shows the new stats and uses one carrot', async () => {
    const view = await openStable();
    await click(button($$(view.container, '.hr-horsecard')[0]!, 'Care'));
    const dialog = $(view.container.ownerDocument.body, '[role="dialog"]');
    await click(button(dialog, 'Use carrot'));
    expect(dialog.textContent).toContain('Carrot ×1');
    const speed = $$(dialog, '.hr-stats__row')[0]!;
    expect(speed.textContent).toContain('65');
  });

  it('retires after a confirmation that names the payout', async () => {
    const view = await openStable();
    await click(button($$(view.container, '.hr-horsecard')[0]!, 'Retire'));
    const dialog = $(view.container.ownerDocument.body, '[role="alertdialog"]');
    expect(dialog.textContent).toContain('A retired horse never comes back.');
    await click(button(dialog, 'Retire'));
    expect($$(view.container, '.hr-horsecard')).toHaveLength(1);
  });

  it('welcomes a horse with a voucher', async () => {
    const view = await openStable();
    await click(button(view.container, 'Welcome a horse'));
    const dialog = $(view.container.ownerDocument.body, '[role="dialog"]');
    const create = button(dialog, 'Welcome') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await type(dialog.querySelector<HTMLInputElement>('input')!, 'Comet');
    await click(create);
    expect($$(view.container, '.hr-horsecard')).toHaveLength(3);
    expect(view.container.textContent).toContain('Horse voucher ×0');
  });
});

describe('breeding', () => {
  async function openBreed(api?: HorseApi) {
    const view = await show(api);
    await click(tab(view.container, 'Breeding'));
    return view;
  }

  it('previews the foal’s ranges, the fee and the maturity for two picked horses', async () => {
    const view = await openBreed();
    const chips = $$(view.container, '.hr-picks .bb-chip');
    await click(chips[0]);
    await click(chips[1]);
    const card = $(view.container, '.hr-preview');
    expect(card.textContent).toContain('Total 190 to 210');
    expect(card.textContent).toContain('Generation 1');
    expect($$(card, '.hr-ranges div')).toHaveLength(4);
    expect(card.textContent).toContain('Breeding fee: 15,000 Pelica');
    expect(card.textContent).toContain('Can race from 2d 0h');
    expect(card.textContent).toContain('Stats are rolled once');
  });

  it('asks for confirmation, charges the fee and lists the foal with its countdown', async () => {
    const view = await openBreed(createMockHorseApi({ now: () => NOW, balance: 40_000 }));
    const chips = $$(view.container, '.hr-picks .bb-chip');
    await click(chips[0]);
    await click(chips[1]);
    await type(view.container.querySelector<HTMLInputElement>('input')!, 'Little Comet');
    await click(button(view.container, 'Breed'));
    const dialog = $(view.container.ownerDocument.body, '[role="dialog"]');
    expect(dialog.textContent).toContain('for 15,000 Pelica');
    await click(button(dialog, 'Breed'));
    expect(useBalanceStore.getState().balance).toBe(25_000);
    expect($(view.container, '.hr-foal').textContent).toContain('Little Comet');
    expect(view.container.textContent).toContain('Can race in');
  });

  it('says why a horse cannot breed', async () => {
    const real = createMockHorseApi({ now: () => NOW, balance: 12_400 });
    const api: HorseApi = {
      ...real,
      stable: async () => {
        const s = await real.stable();
        s.horses[1]!.breed = { ok: false, rule: 'min_races' };
        return s;
      },
    };
    const view = await show(api);
    await click(tab(view.container, 'Breeding'));
    expect($(view.container, '.hr-reasons').textContent).toContain('needs 4 races before breeding');
    expect(view.container.textContent).toContain('at least 4 races');
    expect(($$(view.container, '.hr-picks .bb-chip')[1] as HTMLButtonElement).disabled).toBe(true);
  });
});
