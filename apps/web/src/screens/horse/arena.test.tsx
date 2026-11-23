// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dictionaries } from '@casino/shared/i18n';
import type { HorseApi } from './api.ts';
import { ArenaScreen } from './ArenaScreen.tsx';
import { fighterSprite } from './ArenaScene.tsx';
import { FIGHTER_ART } from './arena-art.ts';
import { HorseApiProvider } from './context.tsx';
import { createMockHorseApi } from './mock.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useSettingsStore } from '../../shell/stores/settings.ts';
import { resetStores } from '../../shell/testing/fakes.ts';
import { act, render, type Rendered } from '../../shell/testing/render.tsx';
import { screenRoutes } from '../routes.tsx';

let mounted: Rendered | null = null;
beforeEach(() => {
  resetStores();
  useBalanceStore.getState().set(12_400);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function show(
  api: HorseApi = createMockHorseApi({ now: () => 1_800_000_000_000, balance: 12_400 }),
) {
  mounted = render(
    <HorseApiProvider api={api}>
      <ArenaScreen />
    </HorseApiProvider>,
  );
  await settle();
  return mounted;
}

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

describe('arena screen', () => {
  it('shows both formats as tabs and the open stage of the duel', async () => {
    const view = await show();
    expect($$(view.container, '[role="tab"]').map((t) => t.textContent)).toEqual([
      '🥊 1-on-1',
      '⚔️ Battle royale',
    ]);
    expect(view.container.textContent).toContain('Final · betting open');
    expect(view.container.textContent).toContain('Odds are not locked');
    const fighters = $$(view.container, '.hr-fighter');
    expect(fighters).toHaveLength(2 + 4);
    expect(view.container.textContent).toContain('Finalist');
    expect(view.container.textContent).toContain('Out');
    expect(view.container.textContent).toContain('Power');
    expect(view.container.textContent).toContain('Weapon +');
    expect($$(view.container, '.hr-fighter').some((f) => f.textContent?.includes('Win ×'))).toBe(
      true,
    );
  });

  it('shows the pit with the final pair and a sprite on every fighter card', async () => {
    const view = await show();
    expect($$(view.container, '.hr-pit svg')).toHaveLength(1);
    const fighters = $$(view.container, '.hr-fighter');
    for (const f of fighters) expect(f.querySelector('.hr-fighter__art')).not.toBeNull();
    // decorative: the names are in the text
    expect(view.container.querySelector('.hr-pit svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('gives each roster fighter their own sprite and any other name a stable one', () => {
    expect(fighterSprite('鉄拳のゴウ')).toBe(0);
    expect(fighterSprite('影帝のシャドウキング')).toBe(15);
    expect(FIGHTER_ART).toHaveLength(16);
    const other = fighterSprite('Someone New');
    expect(other).toBe(fighterSprite('Someone New'));
    expect(other).toBeGreaterThanOrEqual(0);
    expect(other).toBeLessThan(16);
  });

  it('lists the 16 royale fighters in four groups', async () => {
    const view = await show();
    await click($$(view.container, '[role="tab"]')[1]);
    expect($$(view.container, '.hr-group')).toHaveLength(4);
    expect($$(view.container, '.hr-fighter')).toHaveLength(16);
    expect(view.container.textContent).toContain('Semifinals · betting open');
    expect(view.container.textContent).toContain('The finalists are decided');
  });

  it('bets on a fighter inside the limits, once, and shows the stake and the new balance', async () => {
    const calls: { key: string; amount: number; fighterId: number }[] = [];
    const real = createMockHorseApi({ now: () => 1_800_000_000_000, balance: 12_400 });
    const api: HorseApi = {
      ...real,
      arenaBet: (intent, key) => {
        calls.push({ key, amount: intent.amount, fighterId: intent.fighterId });
        return real.arenaBet(intent, key);
      },
    };
    const view = await show(api);
    await click(button(view.container, /^Bet on /));
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    const confirm = button(dialog, 'Place bet') as HTMLButtonElement;
    const input = dialog.querySelector<HTMLInputElement>('input')!;
    await type(input, '50');
    expect(confirm.disabled).toBe(true);
    await type(input, '30000');
    expect(confirm.disabled).toBe(true);
    await type(input, '1000');
    expect(confirm.disabled).toBe(false);
    await click(confirm);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.amount).toBe(1000);
    expect(useBalanceStore.getState().balance).toBe(11_400);
    expect(view.container.textContent).toContain('Your stake 1,000');
    expect(view.container.textContent).toContain('Your bets');
  });

  it('follows the language setting', async () => {
    useSettingsStore.getState().update({ language: 'ja' });
    const view = await show();
    expect(view.container.querySelector('h1')!.textContent).toBe('地下闘技場');
    expect(view.container.textContent).toContain('決勝・受付中');
    expect(view.container.textContent).toContain('決勝進出');
    expect(view.container.textContent).toContain('単勝');
  });

  it('is registered as the arena and horse screens, loaded on demand', () => {
    expect(typeof screenRoutes.arena).toBe('function');
    expect(typeof screenRoutes.horse).toBe('function');
  });
});

describe('screen.horse strings', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const used = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!/\.(ts|tsx)$/.test(file) || file.includes('.test.')) continue;
    const source = readFileSync(join(dir, file), 'utf8');
    for (const m of source.matchAll(/'(screen\.horse\.[A-Za-z0-9_.-]+)'/g)) used.add(m[1]!);
  }

  it('every literal key the screens use exists in English and Japanese', () => {
    expect(used.size).toBeGreaterThan(80);
    for (const key of used) {
      expect(dictionaries.en, key).toHaveProperty([key]);
      expect(dictionaries.ja, key).toHaveProperty([key]);
    }
  });

  it('has a text for every dynamic key family', () => {
    const families: [string, readonly (string | number)[]][] = [
      ['phase', ['upcoming', 'entry_open', 'entry_closed', 'betting', 'bet_closed', 'done']],
      ['going', ['良', '稍重', '重', '不良']],
      ['form', [1, 0, -1]],
      ['stat', ['speed', 'stamina', 'power', 'guts']],
      ['style', ['nige', 'senko', 'sashi', 'oikomi', 'auto']],
      ['bet.kind', ['win', 'place', 'quinella', 'wide', 'exacta', 'trio', 'trifecta']],
      ['bet.hint', ['win', 'place', 'quinella', 'wide', 'exacta', 'trio', 'trifecta']],
      ['coat', [0, 1, 2, 3, 4, 5, 6, 7]],
      ['silks', [0, 1, 2, 3, 4, 5, 6, 7, 8]],
      ['arena.format', ['duel', 'royale']],
      ['arena.status', ['semi_betting', 'final_betting', 'done']],
      ['arena.state', ['champion', 'finalist', 'out']],
    ];
    for (const [family, names] of families)
      for (const name of names) {
        expect(dictionaries.en, `${family}.${name}`).toHaveProperty([
          `screen.horse.${family}.${name}`,
        ]);
        expect(dictionaries.ja, `${family}.${name}`).toHaveProperty([
          `screen.horse.${family}.${name}`,
        ]);
      }
  });
});
