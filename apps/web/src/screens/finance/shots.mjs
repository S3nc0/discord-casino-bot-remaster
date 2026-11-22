/* global process, fetch, setTimeout, console, document */
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

/** Fails the run when a nav label or an amount breaks over two lines at 360 or 390 px. */
async function checkLayout(browser) {
  const problems = [];
  for (const width of [360, 390]) {
    for (const locale of ['en', 'ja']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      for (const screen of ['bank', 'kyosai', 'companies']) {
        await page.goto(`${origin}/?screen=${screen}&locale=${locale}`);
        await page.waitForSelector('.fin-panel');
        const bad = await page.evaluate(() => {
          const lines = (el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return new Set([...range.getClientRects()].map((r) => Math.round(r.top / 4))).size;
          };
          const out = [];
          for (const item of document.querySelectorAll('.bb-nav-item')) {
            const label = [...item.childNodes].find(
              (n) => n.nodeType === 3 || (n.tagName === 'SPAN' && !n.className.includes('ind')),
            );
            const box = item.getBoundingClientRect();
            if (
              lines(label ?? item) > 1 ||
              item.scrollWidth > item.clientWidth + 1 ||
              box.height < 48
            ) {
              out.push(
                `nav "${item.textContent}" ${Math.round(box.width)}x${Math.round(box.height)}`,
              );
            }
          }
          for (const v of document.querySelectorAll('.fin-stat__value')) {
            if (!v.querySelector('.bb-tag') && lines(v) > 1) out.push(`amount "${v.textContent}"`);
          }
          return out;
        });
        for (const b of bad) problems.push(`${width}px ${locale} ${screen}: ${b}`);
      }
      await page.close();
    }
  }
  if (problems.length > 0) throw new Error(`layout problems:\n${problems.join('\n')}`);
  console.log('layout ok at 360 and 390 px, en and ja');
}

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
  await checkLayout(browser);
  await browser.close();
  console.log(`saved to ${outDir}`);
} finally {
  stop();
}
