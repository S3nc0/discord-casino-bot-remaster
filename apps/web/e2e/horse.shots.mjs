// Screenshots of the horse racing and arena screens against the in-memory mock API.
//   node apps/web/e2e/horse.shots.mjs
// Needs the dev server in mock mode (`VITE_MOCK_DISCORD=1 pnpm --filter @casino/web exec vite --port 5361`)
// and Playwright (`PLAYWRIGHT_DIR` = a folder whose node_modules has playwright-core, `CHROME` = a
// Chrome executable). Nothing here is part of the app bundle or the lockfile.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), 'noop.js'));
const { chromium } = require('playwright-core');

const BASE = process.env.BASE_URL ?? 'http://localhost:5361';
const OUT = process.env.OUT_DIR ?? join(process.cwd(), 'screens', 'horse');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const shots = [];

async function session(scheme, locale, run) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  const open = async (screen) => {
    await page.goto(`${BASE}/?screen=${screen}&locale=${locale}`);
    await page.waitForSelector(`[data-screen="${screen}"]`, { timeout: 15000 });
  };
  const shot = async (name) => {
    const file = join(OUT, `${name}-${scheme}${locale === 'ja' ? '-ja' : ''}.png`);
    await page.screenshot({ path: file, fullPage: false });
    shots.push(file);
  };
  await run({ page, open, shot });
  await context.close();
}

const text = (page, re) => page.getByText(re).first();

async function horseFlow({ page, open, shot }, ja) {
  await open('horse');
  await page.waitForSelector('.hr-race');
  await shot('horse-card');
  // Race 2 is in the betting window.
  await page.locator('.hr-race').nth(1).click();
  await page.waitForSelector('.hr-runner');
  await shot('horse-race-betting');
  await page.getByRole('button', { name: /^1 /, exact: false }).first().click();
  await page.locator('.hr-quote').scrollIntoViewIfNeeded();
  await shot('horse-bet-slip');
  // Race 1 is done: result and live replay.
  await page.getByRole('button', { name: ja ? /出馬表へ戻る/ : /All races/ }).click();
  await page.waitForSelector('.hr-race');
  await page.locator('.hr-race').nth(0).click();
  await page.waitForSelector('.hr-placing');
  await shot('horse-race-result');
  await page.getByRole('button', { name: ja ? /レースを見る/ : /Watch the race/ }).click();
  await page.waitForSelector('.hr-lane');
  await page.waitForTimeout(5200);
  await shot('horse-race-live');
  await page
    .getByRole('button', { name: ja ? /出馬表へ戻る/ : /All races/ })
    .click()
    .catch(() => {});
}

async function stableFlow({ page, open, shot }, ja) {
  await open('horse');
  await page.getByRole('tab', { name: ja ? '厩舎' : 'Stable' }).click();
  await page.waitForSelector('.hr-horsecard');
  await shot('horse-stable');
  await page.getByRole('tab', { name: ja ? '配合' : 'Breeding' }).click();
  await page.waitForSelector('.hr-picks');
  await page.locator('.hr-picks .bb-chip').nth(0).click();
  await page.locator('.hr-picks .bb-chip').nth(1).click();
  await page.waitForSelector('.hr-preview');
  await shot('horse-breed');
}

async function arenaFlow({ page, open, shot }, ja) {
  await open('arena');
  await page.waitForSelector('.hr-fighter');
  await shot('arena');
  await page.getByRole('tab', { name: /royale|バトル/i }).click();
  await page.waitForSelector('.hr-fighter');
  await shot('arena-royale');
}

for (const scheme of ['dark', 'light']) {
  await session(scheme, 'en', async (ctx) => {
    await horseFlow(ctx, false);
    await stableFlow(ctx, false);
    await arenaFlow(ctx, false);
  });
}
await session('dark', 'ja', async (ctx) => {
  await horseFlow(ctx, true);
  await stableFlow(ctx, true);
  await arenaFlow(ctx, true);
});

await browser.close();
console.log(shots.join('\n'));
