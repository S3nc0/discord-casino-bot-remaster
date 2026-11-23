import type { Page } from 'playwright-core';
import { expect } from 'vitest';
import type { Stack } from '../../../../tests/e2e/support/stack.ts';

/** The balance the top bar shows, as a number (every language prints digits with separators). */
export async function shownBalance(page: Page): Promise<number> {
  const text = await page.locator('.topbar__balance').first().innerText();
  return Number(text.replace(/[^0-9]/g, ''));
}

/**
 * Wait until the top bar shows what the server's ledger says (both are read again on every
 * poll: the page may be ahead of or behind the server for a moment) and return that balance.
 */
export async function expectBalanceInSync(
  page: Page,
  stack: Stack,
  guildId: string,
  userId: string,
): Promise<number> {
  await expect
    .poll(
      async () => ({
        shown: await shownBalance(page).catch(() => -1),
        server: stack.economy.getBalance(guildId, userId),
      }),
      { timeout: 10_000, message: 'top bar balance matches the ledger' },
    )
    .toSatisfy((b: { shown: number; server: number }) => b.server > 0 && b.shown === b.server);
  return stack.economy.getBalance(guildId, userId);
}

/** Open a game from the Home tiles. */
export async function openFromHome(page: Page, name: string | RegExp): Promise<void> {
  await page
    .getByRole('button', { name: /^(Home|ホーム)$/ })
    .first()
    .click();
  await page.getByRole('button', { name }).first().click();
}
