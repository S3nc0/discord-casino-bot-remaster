// One screenshot per route: every screen id at 390 px, dark and light, English and Japanese,
// against the in-memory mock API (no server needed).
//
//   node scripts/screens-all.mjs <outDir> [screenId ...]
//
// Fails on a console error, a failed request or horizontal scrolling. Set CHROME_PATH when
// Chrome is not at the macOS default.
/* global console, document, window */
import { mkdirSync } from 'node:fs';
import process from 'node:process';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { SCREEN_IDS } from '@casino/shared';

const [outArg, ...only] = process.argv.slice(2);
const out = resolve(outArg ?? 'screenshots');
mkdirSync(out, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const chrome =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

process.env.VITE_MOCK_DISCORD = '1';
const server = await createServer({
  root,
  logLevel: 'error',
  server: { port: 5198, strictPort: false },
});
await server.listen();
const base = server.resolvedUrls?.local[0] ?? 'http://localhost:5198/';

const screens = only.length > 0 ? only : SCREEN_IDS.filter((id) => id !== 'inbox');
const LOCALES = [
  { id: 'en', param: 'en-US' },
  { id: 'ja', param: 'ja' },
];

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const problems = [];
let saved = 0;
try {
  for (const colorScheme of ['dark', 'light']) {
    for (const locale of LOCALES) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        colorScheme,
        locale: locale.param,
        isMobile: true,
        hasTouch: true,
      });
      for (const screen of screens) {
        const label = `${screen}.${colorScheme}.${locale.id}`;
        const page = await context.newPage();
        page.on(
          'console',
          (m) => m.type() === 'error' && problems.push(`${label}: console: ${m.text()}`),
        );
        page.on('pageerror', (e) => problems.push(`${label}: page error: ${e.message}`));
        page.on('requestfailed', (r) => problems.push(`${label}: request failed: ${r.url()}`));
        try {
          await page.goto(`${base}?screen=${screen}&locale=${locale.param}`);
          await page.locator('.app__screen').waitFor({ timeout: 10_000 });
          await page.locator('.app__screen > *').first().waitFor({ timeout: 10_000 });
          await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, {
            timeout: 10_000,
          });
          await page.waitForTimeout(500);
          const need = await page.evaluate(() => {
            const main = document.querySelector('.app__screen');
            const used = window.innerHeight - (main?.clientHeight ?? 0);
            return Math.ceil((main?.scrollHeight ?? 0) + used);
          });
          await page.setViewportSize({ width: 390, height: Math.min(Math.max(need, 700), 3000) });
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
