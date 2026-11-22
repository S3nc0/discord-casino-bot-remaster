/* global process, fetch, setTimeout, console */
// Screenshot run for the finance screens: starts the web app against the in-memory mock API,
// opens each main screen at 390 px in dark and light, and saves PNGs.
//   pnpm --filter @casino/web exec node src/screens/finance/shots.mjs <outDir>
// Needs Google Chrome (or CHROME_PATH). Nothing here runs in CI.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: shots.mjs <outDir>');
mkdirSync(outDir, { recursive: true });
const port = Number(process.env.SHOTS_PORT ?? 5277);
const origin = `http://localhost:${port}`;
const chrome =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = spawn('pnpm', ['exec', 'vite', '--port', String(port), '--strictPort'], {
  env: { ...process.env, VITE_MOCK_DISCORD: '1' },
  stdio: 'ignore',
});
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

async function ready() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('vite did not start');
}

const SHOTS = [
  { name: 'bank', screen: 'bank', wait: '[data-screen="bank"] .fin-panel' },
  { name: 'loans', screen: 'loans', wait: '[data-loan]' },
  { name: 'kyosai', screen: 'kyosai', wait: '[data-motion]' },
  { name: 'market-board', screen: 'market', wait: '.fin-symbol .fin-chart' },
  { name: 'market-trade', screen: 'market', tab: 1, wait: '.fin-panel .bb-chip' },
  { name: 'market-holdings', screen: 'market', tab: 2, wait: '[data-position]' },
  { name: 'market-listings', screen: 'market', tab: 3, wait: '[data-listing]' },
  { name: 'companies', screen: 'companies', wait: '[data-owner]' },
];

try {
  await ready();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const scheme of ['dark', 'light']) {
    for (const locale of ['en', 'ja']) {
      if (locale === 'ja' && scheme === 'light') continue;
      const context = await browser.newContext({
        viewport: { width: 390, height: 1500 },
        deviceScaleFactor: 2,
        colorScheme: scheme,
        reducedMotion: 'reduce',
      });
      for (const shot of SHOTS) {
        const page = await context.newPage();
        await page.goto(`${origin}/?screen=${shot.screen}&locale=${locale}`);
        if (shot.tab) {
          const tab = page.getByRole('tab').nth(shot.tab);
          await tab.waitFor();
          await tab.click();
        }
        await page.waitForSelector(shot.wait);
        await page.waitForTimeout(250);
        const suffix = locale === 'ja' ? `-ja-${scheme}` : `-${scheme}`;
        await page.screenshot({ path: join(outDir, `${shot.name}${suffix}.png`), fullPage: false });
        await page.close();
      }
      await context.close();
    }
  }
  await browser.close();
  console.log(`saved to ${outDir}`);
} finally {
  stop();
}
