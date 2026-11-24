/* global document */
// Screenshots of the casino screens against the mock API, at 390 px in dark and light.
// Needs playwright-core and a Chrome binary (neither is a repo dependency):
//   VITE_MOCK_DISCORD=1 pnpm --filter @casino/web exec vite --port 5199 &
//   npm i playwright-core --prefix /tmp/pw
//   PLAYWRIGHT_CORE=/tmp/pw/node_modules/playwright-core/index.mjs \
//     node apps/web/scripts/casino-shots.js http://localhost:5199 <outDir> [screen]
// Env: SEED (mock dice and cards), LOCALE (en or ja), CHROME (binary path).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5199', out = './out', only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

const hideBadge = `[role="status"][data-status]{display:none !important}`;

async function open(scheme, query) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 200)));
  await page.goto(`${base}/?${query}`);
  await page.addStyleTag({ content: hideBadge });
  await page.waitForSelector('.app', { timeout: 15000 });
  await page.waitForTimeout(400);
  return { ctx, page };
}

const shot = async (page, name, scheme) => {
  await page.screenshot({ path: `${out}/${name}-${scheme}.png`, fullPage: false });
  console.log('saved', `${name}-${scheme}`);
};
const click = (page, name, opts = {}) =>
  page
    .getByRole('button', { name, ...opts })
    .first()
    .click();

const flows = {
  async home(page, scheme) {
    await shot(page, 'home', scheme);
    await page.getByRole('button', { name: 'Claim bonus' }).click();
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('.app__screen').scrollTo(0, 9999));
    await shot(page, 'home-claimed', scheme);
  },
  async slots(page, scheme) {
    await shot(page, 'slots-idle', scheme);
    await click(page, 'Spin');
    await page.waitForTimeout(500);
    await shot(page, 'slots-spinning', scheme);
    await page.waitForTimeout(2600);
    await shot(page, 'slots-result', scheme);
  },
  async chinchiro(page, scheme) {
    await shot(page, 'chinchiro-idle', scheme);
    await click(page, 'Deal in');
    await page.waitForTimeout(1200);
    await shot(page, 'chinchiro-dealt', scheme);
    for (let i = 0; i < 3; i += 1) {
      const roll = page.getByRole('button', { name: 'Roll the dice' });
      if (!(await roll.count())) break;
      await roll.click();
      await page.waitForTimeout(1100);
    }
    await shot(page, 'chinchiro-result', scheme);
    await page.getByRole('tab', { name: 'Table' }).click();
    await page.waitForTimeout(300);
    await click(page, 'Open a table');
    await page.waitForTimeout(8000);
    await shot(page, 'chinchiro-lobby', scheme);
    await page.waitForTimeout(13500);
    await shot(page, 'chinchiro-rolling', scheme);
    await click(page, '🎲 Roll');
    await page.waitForTimeout(5000);
    await shot(page, 'chinchiro-table-result', scheme);
  },
  async roulette(page, scheme) {
    await shot(page, 'roulette-idle', scheme);
    await click(page, 'Red (×2)');
    await click(page, '25–36 (×3)');
    await page.getByLabel('Number 0–36').fill('17');
    await click(page, 'Add number');
    await shot(page, 'roulette-slip', scheme);
    await click(page, 'Place bets');
    await page.waitForTimeout(1000);
    await shot(page, 'roulette-betting', scheme);
    await page.waitForTimeout(12500);
    await shot(page, 'roulette-spinning', scheme);
    await page.waitForTimeout(3500);
    await shot(page, 'roulette-result', scheme);
  },
  async pachinko(page, scheme) {
    await shot(page, 'pachinko-idle', scheme);
    await page.getByRole('button', { name: 'More sets' }).click();
    await page.getByRole('button', { name: 'More sets' }).click();
    await click(page, 'Launch');
    await page.waitForTimeout(400);
    await shot(page, 'pachinko-launching', scheme);
    await page.waitForTimeout(3600);
    await shot(page, 'pachinko-result', scheme);
  },
  async blackjack(page, scheme) {
    await shot(page, 'blackjack-idle', scheme);
    await click(page, 'Bet', { exact: true });
    await page.waitForTimeout(800);
    await shot(page, 'blackjack-betting', scheme);
    await page.waitForTimeout(10000);
    await shot(page, 'blackjack-player', scheme);
    const stand = page.getByRole('button', { name: 'Stand' });
    for (let i = 0; i < 4 && (await stand.count()); i += 1) {
      await stand.click();
      await page.waitForTimeout(3000);
    }
    await shot(page, 'blackjack-result', scheme);
  },
  async history(page, scheme) {
    await page.waitForTimeout(400);
    await shot(page, 'history', scheme);
  },
};

const screens = only ? [only] : Object.keys(flows);
for (const name of screens) {
  for (const scheme of ['dark', 'light']) {
    const query = `screen=${name}&seed=${process.env.SEED ?? '7'}${process.env.LOCALE ? `&locale=${process.env.LOCALE}` : ''}`;
    const { ctx, page } = await open(scheme, query);
    try {
      await flows[name](page, scheme);
    } catch (e) {
      console.log('FLOW FAIL', name, scheme, e.message.split('\n')[0]);
      await page.screenshot({ path: `${out}/${name}-fail-${scheme}.png` });
    }
    await ctx.close();
  }
}
await browser.close();
