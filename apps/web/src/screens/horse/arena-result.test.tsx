// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArenaToday } from '@casino/shared';
import type { HorseApi } from './api.ts';
import { ArenaScreen } from './ArenaScreen.tsx';
import { HorseApiProvider } from './context.tsx';
import { createMockHorseApi } from './mock.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useSettingsStore } from '../../shell/stores/settings.ts';
import { resetStores } from '../../shell/testing/fakes.ts';
import { act, render, type Rendered } from '../../shell/testing/render.tsx';

let mounted: Rendered | null = null;
beforeEach(() => {
  resetStores();
  useBalanceStore.getState().set(12_400);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

/** The mock's duel, finished: first finalist champion, the other one runner-up (or not stored). */
function finished(runnerUp: 'second' | 'none'): HorseApi {
  const real = createMockHorseApi({ now: () => 1_800_000_000_000, balance: 12_400 });
  return {
    ...real,
    arena: async (): Promise<ArenaToday> => {
      const today = await real.arena();
      const duel = today.tournaments.find((t) => t.format === 'duel')!;
      const [first, second] = duel.fighters.filter((f) => f.stage === 'final');
      duel.status = 'done';
      duel.championId = first!.id;
      duel.runnerUpId = runnerUp === 'second' ? second!.id : null;
      first!.result = 'won';
      second!.result = 'lost';
      return today;
    },
  };
}

async function show(api: HorseApi): Promise<Rendered> {
  mounted = render(
    <HorseApiProvider api={api}>
      <ArenaScreen />
    </HorseApiProvider>,
  );
  for (let i = 0; i < 6; i++) await act(async () => void (await Promise.resolve()));
  return mounted;
}

const resultLine = (view: Rendered) => view.container.querySelector('.hr-ok')?.textContent ?? '';
const nameOf = (view: Rendered, index: number) =>
  view.container.querySelectorAll('.hr-fighter')[index]?.textContent ?? '';

describe('arena result', () => {
  it('names the champion and the runner-up', async () => {
    const view = await show(finished('second'));
    const line = resultLine(view);
    expect(line).toMatch(/^Champion: .+ · Runner-up: .+$/);
    const [champion, runnerUp] = line.replace('Champion: ', '').split(' · Runner-up: ');
    expect(champion).not.toBe(runnerUp);
    // Both names are fighters of the final list below.
    const finalists = [...view.container.querySelectorAll('.hr-fighter')]
      .slice(0, 2)
      .map((f) => f.textContent ?? '');
    expect(finalists.some((f) => f.includes(champion!))).toBe(true);
    expect(finalists.some((f) => f.includes(runnerUp!))).toBe(true);
    expect(nameOf(view, 0)).not.toBe('');
  });

  it('shows only the champion for a day finished before the runner-up was stored', async () => {
    const view = await show(finished('none'));
    expect(resultLine(view)).toMatch(/^Champion: [^·]+$/);
    expect(resultLine(view)).not.toContain('Runner-up');
  });

  it('is in Japanese too', async () => {
    useSettingsStore.getState().update({ language: 'ja' });
    const view = await show(finished('second'));
    expect(resultLine(view)).toMatch(/^優勝: .+ · 準優勝: .+$/);
  });

  it('shows no result line while the tournament is open', async () => {
    const view = await show(createMockHorseApi({ now: () => 1_800_000_000_000, balance: 12_400 }));
    expect(resultLine(view)).toBe('');
  });
});
