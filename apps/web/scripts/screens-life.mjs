// Screenshots of the "life" screens against the in-memory mock API (no server needed).
//
//   node scripts/screens-life.mjs <outDir>
//
// Runs the Vite dev server in mock mode, opens each screen at 390px in a real Chrome (dark and
// light, English and Japanese) and saves PNGs. Fails on a console error, a failed request, a
// missing element or horizontal scrolling. Set CHROME_PATH when Chrome is not at the macOS default.
/* global console, document, window */
import { mkdirSync } from 'node:fs';
import process from 'node:process';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const out = resolve(process.argv[2] ?? 'screenshots');
mkdirSync(out, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const chrome =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

process.env.VITE_MOCK_DISCORD = '1';
const server = await createServer({
  root,
  logLevel: 'error',
  server: { port: 5199, strictPort: false },
});
await server.listen();
const base = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';

/** Each shot: screen id, a name, and steps that bring the screen into the state to capture. */
const SHOTS = [
  {
    screen: 'work',
    name: 'labor-dig',
    steps: async (p) => p.locator('.life-dig__button').waitFor(),
  },
  {
    screen: 'work',
    name: 'labor-crew',
    steps: async (p) => p.getByRole('tab', { name: /Crew|作業員/ }).click(),
  },
  {
    screen: 'work',
    name: 'labor-relics',
    steps: async (p) => p.getByRole('tab', { name: /Relics|発掘品/ }).click(),
  },
  {
    screen: 'work',
    name: 'labor-ranking',
    steps: async (p) => p.getByRole('tab', { name: /Ranking|ランキング/ }).click(),
  },
  {
    screen: 'quiz',
    name: 'quiz-answer',
    steps: async (p) => p.locator('.life__choices').waitFor(),
  },
  {
    screen: 'quiz',
    name: 'quiz-post',
    steps: async (p) => p.getByRole('tab', { name: /Post a quiz|出題する/ }).click(),
  },
  { screen: 'lottery', name: 'lottery', steps: async (p) => p.locator('.life-stats').waitFor() },
  { screen: 'poll', name: 'polls', steps: async (p) => p.locator('.life-poll').first().waitFor() },
  { screen: 'shop', name: 'shop', steps: async (p) => p.locator('.bb-list li').first().waitFor() },
  {
    screen: 'shop',
    name: 'shop-market',
    steps: async (p) => p.getByRole('tab', { name: /Teiai market|帝愛市/ }).click(),
  },
  {
    screen: 'shop',
    name: 'shop-seized',
    steps: async (p) => p.getByRole('tab', { name: /Seized goods|押収品/ }).click(),
  },
  {
    screen: 'missions',
    name: 'missions',
    steps: async (p) => p.locator('.life-mission').first().waitFor(),
  },
  {
    screen: 'ranking',
    name: 'ranking',
    steps: async (p) => p.locator('.bb-list li').first().waitFor(),
  },
  {
    screen: 'transfer',
    name: 'transfer',
    steps: async (p) => {
      await p.locator('.bb-list li').nth(1).click();
      await p.locator('input[inputmode="numeric"]').fill('1000');
      await p.locator('.life__sum').waitFor();
    },
  },
];

const THEMES = ['dark', 'light'];
const LOCALES = [
  { id: 'en', param: 'en-US' },
  { id: 'ja', param: 'ja' },
];

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const problems = [];
let saved = 0;
try {
  for (const colorScheme of THEMES) {
    for (const locale of LOCALES) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        colorScheme,
        locale: locale.param,
        isMobile: true,
        hasTouch: true,
      });
      for (const shot of SHOTS) {
        // Japanese: only the main screen of each slice, to keep the run short.
        if (
          locale.id === 'ja' &&
          ![
            'labor-dig',
            'quiz-answer',
            'shop',
            'missions',
            'transfer',
            'polls',
            'lottery',
            'ranking',
          ].includes(shot.name)
        )
          continue;
        const page = await context.newPage();
        const label = `${shot.name}.${colorScheme}.${locale.id}`;
        page.on(
          'console',
          (m) => m.type() === 'error' && problems.push(`${label}: console: ${m.text()}`),
        );
        page.on('pageerror', (e) => problems.push(`${label}: page error: ${e.message}`));
        page.on('requestfailed', (r) => problems.push(`${label}: request failed: ${r.url()}`));
        await page.goto(`${base}?screen=${shot.screen}&locale=${locale.param}`);
        try {
          await page
            .locator(`section.life[data-screen="${shot.screen}"]`)
            .waitFor({ timeout: 10_000 });
          await shot.steps(page);
          await page.waitForTimeout(400);
          // Fit the viewport to the screen so the whole screen is in the picture.
          const need = await page.evaluate(() => {
            const screen = document.querySelector('.app__screen');
            const used = window.innerHeight - (screen?.clientHeight ?? 0);
            return Math.ceil((screen?.scrollHeight ?? 0) + used);
          });
          await page.setViewportSize({ width: 390, height: Math.min(Math.max(need, 700), 2600) });
          await page.waitForTimeout(200);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          if (overflow > 0) problems.push(`${label}: scrolls sideways by ${overflow}px`);
          await page.screenshot({ path: join(out, `${label}.png`) });
          saved += 1;
        } catch (error) {
          problems.push(`${label}: ${error.message.split('\n')[0]}`);
          await page.screenshot({ path: join(out, `${label}.FAILED.png`) }).catch(() => {});
        }
        await page.close();
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`${saved} screenshots in ${out}`);
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
