// Numbers read correctly on a 390 px phone: Home, Profile, Ranking and Stocks in both themes.
// The display font (Pixelify Sans) draws 2 like 8 and 5 like S, so no digit may be set in it
// unless the digit-safe family (`Bitbloom Numerals`) comes first. Screenshots go to
// `NUMBERS_SHOTS_DIR` (default: the system temp folder) for a visual check.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSeededRng } from '../../../packages/shared/src/index.ts';
import { ALICE, GUILD_A, INSTANCE_A1 } from '../../../tests/e2e/support/stack.ts';
import { activityUrl, openPage, startHarness, VIEWPORTS, type Harness } from './support/harness.ts';
import { expectBalanceInSync } from './support/ui.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness({ rng: createSeededRng(11) });
});
afterAll(async () => {
  await h?.close();
});

const phone = VIEWPORTS.find((v) => v.name === '390px')!;
const shots = process.env['NUMBERS_SHOTS_DIR'] ?? join(tmpdir(), 'numbers-shots');

/** Every text node with a digit whose font would draw it with Pixelify Sans's own digits. */
function ambiguousDigits(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.nodeValue ?? '';
      const el = n.parentElement;
      if (!el || !/\d/.test(text)) continue;
      if (el.closest('script, style, svg')) continue;
      const family = getComputedStyle(el).fontFamily;
      const first = family.split(',')[0]?.replace(/["']/g, '').trim();
      if (family.includes('Pixelify') && first !== 'Bitbloom Numerals') {
        found.push(`${el.className || el.tagName}: "${text.trim().slice(0, 30)}" in ${first}`);
      }
    }
    return found;
  });
}

async function open(page: Page, name: RegExp): Promise<void> {
  await page
    .getByRole('button', { name: /^Home$/ })
    .first()
    .click();
  await page.getByRole('button', { name }).first().click();
}

describe.each(['light', 'dark'] as const)('numbers at 390 px, %s theme', (colorScheme) => {
  it('Home, Profile, Ranking and Stocks never set a digit in Pixelify Sans', async () => {
    mkdirSync(shots, { recursive: true });
    const { page, context, problems } = await openPage(h, phone, { colorScheme });
    try {
      await page.goto(activityUrl(h.base, { person: ALICE, instanceId: INSTANCE_A1 }));
      await expectBalanceInSync(page, h.stack, GUILD_A, ALICE.id);
      await page.locator('.home__amount').waitFor({ state: 'visible' });
      await page.evaluate(() => document.fonts.ready);

      // The balance is the one number the owner misread (12,400 as 18,400): it must be Atkinson.
      const amount = await page.locator('.home__amount').evaluate((el) => {
        const cs = getComputedStyle(el);
        return { family: cs.fontFamily, nums: cs.fontVariantNumeric };
      });
      expect(amount.family).not.toContain('Pixelify');
      expect(amount.family).toContain('Atkinson Hyperlegible');
      expect(amount.nums).toContain('tabular-nums');
      expect(
        await page.evaluate(() => document.fonts.check('700 16px "Bitbloom Numerals"', '25')),
      ).toBe(true);

      const screens: { id: string; go: () => Promise<void> }[] = [
        { id: 'home', go: async () => {} },
        { id: 'profile', go: () => open(page, /^Profile$/) },
        {
          id: 'ranking',
          go: () =>
            page
              .getByRole('button', { name: /^Ranking$/ })
              .first()
              .click(),
        },
        { id: 'stocks', go: () => open(page, /^Stocks$/) },
      ];
      for (const screen of screens) {
        await screen.go();
        await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
        await page.waitForTimeout(400);
        expect(await ambiguousDigits(page), `${screen.id} digits`).toEqual([]);
        await page.screenshot({
          path: join(shots, `${screen.id}.${colorScheme}.png`),
          fullPage: true,
        });
      }
      expect(problems.pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
