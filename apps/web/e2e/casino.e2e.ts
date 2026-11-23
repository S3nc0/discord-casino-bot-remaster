// The whole Activity in a browser, against a real server: launch, sign in, see the balance,
// claim the daily bonus, play slots and roulette, read the history, switch language and theme.
// Desktop and a 390 px phone, each as its own player in its own Activity instance.
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSeededRng } from '../../../packages/shared/src/index.ts';
import {
  ALICE,
  BOB,
  GUILD_A,
  INSTANCE_A1,
  INSTANCE_A2,
  type Person,
} from '../../../tests/e2e/support/stack.ts';
import { activityUrl, openPage, startHarness, VIEWPORTS, type Harness } from './support/harness.ts';
import { expectBalanceInSync, openFromHome } from './support/ui.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness({ rng: createSeededRng(7) });
});
afterAll(async () => {
  await h?.close();
});

const players: Record<string, { person: Person; instanceId: string }> = {
  desktop: { person: ALICE, instanceId: INSTANCE_A1 },
  '390px': { person: BOB, instanceId: INSTANCE_A2 },
};

const luminance = (rgb: string): number => {
  const [r = 0, g = 0, b = 0] = (rgb.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Background colour of the app's root surface (the body itself is transparent). */
const surfaceColor = (page: Page): Promise<string> =>
  page.evaluate(
    () => getComputedStyle(document.querySelector('.app-root') ?? document.body).backgroundColor,
  );

describe.each(VIEWPORTS)('Activity flow at $name', (viewport) => {
  const { person, instanceId } = players[viewport.name] as (typeof players)[string];
  const ledger = () => h.stack.economy.history(GUILD_A, person.id, 100).reverse();
  const reasons = () => ledger().map((e) => e.reason);
  const sync = (page: Page) => expectBalanceInSync(page, h.stack, GUILD_A, person.id);

  it('signs in, claims, plays slots and roulette, and the history shows it', async () => {
    const { page, context, problems } = await openPage(h, viewport);
    try {
      await page.goto(activityUrl(h.base, { person, instanceId }));

      // Launch → auth → Home with the balance from the server's ledger.
      expect(await sync(page)).toBe(3000);
      expect(reasons()).toEqual(['initial_grant']);
      await page
        .getByRole('button', { name: 'Claim bonus' })
        .waitFor({ state: 'visible', timeout: 10_000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);

      // Daily bonus: one click, one ledger row, the balance follows.
      await page.getByRole('button', { name: 'Claim bonus' }).click();
      await expect.poll(() => reasons()).toContain('daily_bonus');
      const afterDaily = await sync(page);
      expect(afterDaily).toBeGreaterThan(3000);
      await page
        .getByRole('button', { name: 'Claim bonus' })
        .waitFor({ state: 'detached', timeout: 10_000 });

      // Slots: stake 100 at the default bet, then the payout, both in the ledger and on screen.
      await openFromHome(page, 'Slots');
      await page.getByRole('button', { name: 'Spin' }).click();
      await page
        .getByRole('button', { name: 'Play again' })
        .waitFor({ state: 'visible', timeout: 15_000 });
      const slotRows = ledger().filter((e) => e.refType === 'game' || e.reason.startsWith('game_'));
      expect(slotRows.map((e) => e.reason)).toContain('game_stake');
      const afterSlots = await sync(page);
      expect(afterSlots).toBeLessThanOrEqual(afterDaily + 49_900);
      await page.getByText('Stake 100').first().waitFor({ state: 'visible', timeout: 10_000 });

      // A player waits a few seconds between two rounds; the server's clock is ours to move.
      h.stack.timers.advance(10_000);

      // Roulette: a shared table. Bet on red, let the server close the window and spin.
      await openFromHome(page, 'Roulette');
      await page.getByRole('button', { name: 'Red (×2)' }).click();
      await page.getByRole('button', { name: 'Place bets' }).click();
      await page.getByText(/Betting is open/).waitFor({ state: 'visible', timeout: 10_000 });
      expect(await sync(page)).toBe(afterSlots - 100);
      h.stack.timers.advance(20_000);
      await page.getByText(/No more bets/).waitFor({ state: 'visible', timeout: 10_000 });
      const table = h.stack.casino.roulette.snapshot(GUILD_A, instanceId);
      const timeline = (table.data as { timeline: { atMs: number }[] }).timeline;
      h.stack.timers.advance(timeline.at(-1)?.atMs ?? 0);
      await page.getByText(/The ball stopped on/).waitFor({ state: 'visible', timeout: 10_000 });
      const afterRoulette = await sync(page);
      const rouletteWon = /You won/.test(await page.innerText('body'));
      expect(afterRoulette).toBe(afterSlots - 100 + (rouletteWon ? 200 : 0));
      h.stack.timers.advance(6_000); // the result window closes: the table is free for the next player

      // History: every ledger row of the player is listed, newest first.
      await openFromHome(page, 'History');
      const rows = page.getByRole('list', { name: 'Ledger entries' }).getByRole('listitem');
      await expect.poll(() => rows.count()).toBe(ledger().length);
      const label: Record<string, string> = {
        game_payout: 'Game payout',
        game_stake: 'Game stake',
        daily_bonus: 'Daily bonus',
        initial_grant: 'Starting balance',
      };
      const newest = ledger().at(-1)?.reason ?? '';
      expect(await rows.first().innerText()).toContain(label[newest] ?? newest);
      expect(await rows.last().innerText()).toContain(label['initial_grant']);

      expect(problems).toEqual({ console: [], failedRequests: [], pageErrors: [] });
    } finally {
      await context.close();
    }
  });

  it('switches to Japanese and back, and between light and dark', async () => {
    const { page, context, problems } = await openPage(h, viewport);
    try {
      await page.goto(activityUrl(h.base, { person, instanceId }));
      await sync(page);
      await page.getByRole('button', { name: 'Settings' }).first().click();

      // Japanese: the document language, the navigation and the home screen all follow.
      await page.getByRole('radio', { name: '日本語' }).check({ force: true });
      await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ja');
      await page
        .getByRole('button', { name: '設定' })
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 });
      await expect
        .poll(async () => (await page.innerText('body')).includes('Settings'))
        .toBe(false);
      await page.getByRole('button', { name: 'ホーム' }).first().click();
      const home = await page.innerText('body');
      expect(home).not.toMatch(/Claim bonus|Balance|Daily bonus/);
      expect(home).not.toMatch(/\b[a-z]+_[a-z_]+\b/); // no raw ids
      expect(home).toMatch(/ペリカ/);
      // The choice is stored on the server, per user.
      await expect.poll(() => h.stack.settings.get(person.id).language).toBe('ja');

      // Back to English.
      await page.getByRole('button', { name: '設定' }).first().click();
      await page.getByRole('radio', { name: 'English' }).check({ force: true });
      await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en');
      await page
        .getByRole('button', { name: 'Home' })
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 });
      await expect.poll(() => h.stack.settings.get(person.id).language).toBe('en');

      // Light and dark: the root attribute and the colour of the surface change together.
      await page.getByRole('radio', { name: 'Dark' }).check({ force: true });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset['theme']))
        .toBe('dark');
      const dark = luminance(await surfaceColor(page));
      await page.getByRole('radio', { name: 'Light' }).check({ force: true });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset['theme']))
        .toBe('light');
      const light = luminance(await surfaceColor(page));
      expect(light).toBeGreaterThan(dark + 100);
      await expect.poll(() => h.stack.settings.get(person.id).theme).toBe('light');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);

      expect(problems).toEqual({ console: [], failedRequests: [], pageErrors: [] });
    } finally {
      await context.close();
    }
  });

  it('opens in Japanese when the Discord client is Japanese', async () => {
    const { page, context } = await openPage(h, viewport, { locale: 'ja-JP' });
    try {
      // A new player: no stored language, so the client's locale decides.
      await page.goto(
        activityUrl(h.base, { person: { id: '123456789012345604', username: 'dave' }, instanceId }),
      );
      await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ja');
    } finally {
      await context.close();
    }
  });
});

// F-T2-03 (low): the sound switch in Settings prints its state as "On"/"Off" in every language
// (`Switch` in packages/ui defaults to English labels and `SettingsScreen` passes none), so the
// Japanese settings screen still shows an English word. Kept as an expected failure: it starts
// failing (and should become a plain `it`) when the screen passes translated labels.
describe('Japanese settings screen', () => {
  it.fails('F-T2-03: shows no English state word on the sound switch', async () => {
    const { page, context } = await openPage(h, VIEWPORTS[0] as (typeof VIEWPORTS)[number], {
      locale: 'ja-JP',
    });
    try {
      await page.goto(activityUrl(h.base, { person: ALICE, instanceId: INSTANCE_A1 }));
      await page.getByRole('button', { name: '設定' }).first().click();
      await page
        .getByText('サウンド', { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 });
      expect(await page.innerText('body')).not.toMatch(/\b(On|Off)\b/);
    } finally {
      await context.close();
    }
  });
});
