// README screenshots: a few Activity screens at 390 px inside a pixel phone frame, in English and
// Japanese, against the in-memory mock API (mock names only, no server needed).
//
//   node scripts/readme-shots.mjs [outDir]    (default: ../../docs/images/readme)
//
// Writes <outDir>/<shot>.<locale>.webp. Needs `cwebp` on PATH (macOS: brew install webp) and
// Chrome (set CHROME_PATH when it is not at the macOS default).
/* global console, document */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import process from 'node:process';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(process.argv[2] ?? join(root, '../../docs/images/readme'));
mkdirSync(out, { recursive: true });
const chrome =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SHOTS = [
  { id: 'home', screen: 'home', scheme: 'dark' },
  { id: 'slots', screen: 'slots', scheme: 'dark' },
  { id: 'horse', screen: 'horse', scheme: 'dark' },
  { id: 'stocks', screen: 'stocks', scheme: 'dark', firstTab: true },
  { id: 'bank-light', screen: 'bank', scheme: 'light' },
];
const LOCALES = [
  { id: 'en', param: 'en-US' },
  { id: 'ja', param: 'ja' },
];
const PHONE = { width: 390, height: 760 };
// Pixel phone: a navy bezel with a stepped (pixel) corner, a yellow speaker slot, a green edge.
const FRAME = (img) => `<!doctype html><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box}
body{background:transparent;padding:12px;display:inline-block}
.p{padding:14px;background:#0d1625;border:4px solid #29b8e9;
 clip-path:polygon(0 16px,8px 16px,8px 8px,16px 8px,16px 0,calc(100% - 16px) 0,calc(100% - 16px) 8px,calc(100% - 8px) 8px,calc(100% - 8px) 16px,100% 16px,100% calc(100% - 16px),calc(100% - 8px) calc(100% - 16px),calc(100% - 8px) calc(100% - 8px),calc(100% - 16px) calc(100% - 8px),calc(100% - 16px) 100%,16px 100%,16px calc(100% - 8px),8px calc(100% - 8px),8px calc(100% - 16px),0 calc(100% - 16px))}
.p::before{content:"";display:block;width:56px;height:6px;margin:0 auto 10px;background:#dfc738}
img{display:block;width:${PHONE.width}px;height:${PHONE.height}px}
</style><div class="p"><img src="${img}"></div>`;

process.env.VITE_MOCK_DISCORD = '1';
const server = await createServer({
  root,
  logLevel: 'error',
  server: { port: 5197, strictPort: false },
});
await server.listen();
const base = server.resolvedUrls?.local[0] ?? 'http://localhost:5197/';

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const problems = [];
try {
  for (const locale of LOCALES) {
    for (const shot of SHOTS) {
      const label = `${shot.id}.${locale.id}`;
      const context = await browser.newContext({
        viewport: PHONE,
        deviceScaleFactor: 2,
        colorScheme: shot.scheme,
        locale: locale.param,
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => problems.push(`${label}: page error: ${e.message}`));
      await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
      await page.goto(`${base}?screen=${shot.screen}&locale=${locale.param}`);
      await page.locator('.app__screen > *').first().waitFor({ timeout: 10_000 });
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, {
        timeout: 10_000,
      });
      // The mock has no socket server; hide the "Connecting…" chip so the shot reads as live.
      await page.addStyleTag({ content: '[role="status"][data-status]{display:none !important}' });
      if (shot.firstTab) await page.getByRole('tab').first().click();
      await page.waitForTimeout(600);
      const png = await page.screenshot();
      await context.close();

      const framed = await browser.newContext({
        viewport: { width: 520, height: 900 },
        deviceScaleFactor: 2,
      });
      const fp = await framed.newPage();
      await fp.setContent(FRAME(`data:image/png;base64,${png.toString('base64')}`));
      await fp.waitForLoadState('load');
      const raw = join(out, `${label}.tmp.png`);
      await fp.locator('body').screenshot({ path: raw, omitBackground: true });
      await framed.close();
      execFileSync('cwebp', [
        '-quiet',
        '-q',
        '88',
        '-alpha_q',
        '100',
        raw,
        '-o',
        join(out, `${label}.webp`),
      ]);
      rmSync(raw);
      console.log(label);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
