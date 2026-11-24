// Two real Activity browser contexts against a real server: Alice (streamer, desktop) and Bob
// (viewer, 390px phone) run through starting a stream, opening a round, live betting over the
// socket room, lock-before-settle (D3), settling with confirmation, and ending the stream.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSeededRng } from '../../../packages/shared/src/index.ts';
import { ALICE, BOB, GUILD_A, INSTANCE_A1, INSTANCE_A2 } from '../../../tests/e2e/support/stack.ts';
import { activityUrl, openPage, startHarness, VIEWPORTS, type Harness } from './support/harness.ts';
import { expectBalanceInSync, openFromHome } from './support/ui.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness({ rng: createSeededRng(19) });
});
afterAll(async () => {
  await h?.close();
});

describe('Stream Activity browser flow', () => {
  it('runs a live streamer + viewer round with D3 lock-before-settle and zero 390px overflow', async () => {
    const desktop = VIEWPORTS[0]!;
    const phone = VIEWPORTS[1]!;
    const streamer = await openPage(h, desktop);
    const viewer = await openPage(h, phone);

    try {
      await streamer.page.goto(activityUrl(h.base, { person: ALICE, instanceId: INSTANCE_A1 }));
      await viewer.page.goto(activityUrl(h.base, { person: BOB, instanceId: INSTANCE_A2 }));

      await expectBalanceInSync(streamer.page, h.stack, GUILD_A, ALICE.id);
      await expectBalanceInSync(viewer.page, h.stack, GUILD_A, BOB.id);

      // Streamer opens Stream screen and starts a live panel
      await openFromHome(streamer.page, 'Stream');
      await streamer.page.getByLabel('Title').fill('Boss stream');
      await streamer.page.getByRole('button', { name: 'Start stream' }).click();
      await streamer.page
        .getByRole('heading', { name: 'Boss stream' })
        .waitFor({ state: 'visible', timeout: 10_000 });

      // Streamer opens a round; settle buttons stay disabled until locked (D3)
      await streamer.page.getByLabel('Round name (optional)').fill('Round 1');
      await streamer.page.getByRole('button', { name: 'Open round' }).click();
      await streamer.page.getByText('Round 1').waitFor({ state: 'visible', timeout: 10_000 });
      expect(await streamer.page.getByRole('button', { name: 'Settle: Win' }).isDisabled()).toBe(
        true,
      );
      expect(await streamer.page.getByRole('button', { name: 'Settle: Lose' }).isDisabled()).toBe(
        true,
      );

      // Viewer (390px phone) opens Stream, sees the live panel, joins the room, and bets 500 on Win
      await openFromHome(viewer.page, 'Stream');
      await viewer.page.getByText('Boss stream').waitFor({ state: 'visible', timeout: 10_000 });
      await viewer.page.getByText('Boss stream').click();
      await viewer.page
        .getByRole('heading', { name: 'Boss stream' })
        .waitFor({ state: 'visible', timeout: 10_000 });

      // Verify zero horizontal overflow at 390px phone width
      expect(
        await viewer.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);

      await viewer.page.getByRole('textbox', { name: 'Bet amount' }).fill('500');
      await viewer.page.getByRole('button', { name: /Streamer wins/ }).click();
      await expectBalanceInSync(viewer.page, h.stack, GUILD_A, BOB.id);
      expect(await viewer.page.getByRole('button', { name: /Streamer loses/ }).isDisabled()).toBe(
        true,
      );

      // Streamer sees the 500 pool update live over the socket room, locks, then settles via confirm
      await streamer.page.getByText('1 bettors').waitFor({ state: 'visible', timeout: 10_000 });
      await streamer.page.getByRole('button', { name: 'Lock bets' }).click();
      await expect
        .poll(() => streamer.page.getByRole('button', { name: 'Settle: Win' }).isDisabled(), {
          timeout: 10_000,
        })
        .toBe(false);

      await streamer.page.getByRole('button', { name: 'Settle: Win' }).click();
      await streamer.page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();

      // One-sided round refunds Bob in full and announces the settled result on both screens
      await viewer.page
        .getByText(/Last round result: Round 1/)
        .waitFor({ state: 'visible', timeout: 10_000 });
      expect(await expectBalanceInSync(viewer.page, h.stack, GUILD_A, BOB.id)).toBe(3000);

      // Streamer ends the stream via confirmation; viewer sees ended banner live
      await streamer.page.getByRole('button', { name: 'End stream' }).click();
      await streamer.page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
      await viewer.page
        .getByText('This stream has ended.')
        .waitFor({ state: 'visible', timeout: 10_000 });

      expect(streamer.problems).toEqual({ console: [], failedRequests: [], pageErrors: [] });
      expect(viewer.problems).toEqual({ console: [], failedRequests: [], pageErrors: [] });
    } finally {
      await streamer.context.close();
      await viewer.context.close();
    }
  });
});
