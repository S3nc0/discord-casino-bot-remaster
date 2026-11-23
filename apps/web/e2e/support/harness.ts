// Everything a browser test needs: a real in-process server (in-memory database, no chat bot),
// the web app served by Vite with the SDK swapped for `DiscordSDKMock`, and a Chrome to drive.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createServer as createVite, type ViteDevServer } from 'vite';
import {
  ALICE,
  GUILD_A,
  INSTANCE_A1,
  startStack,
  type Person,
  type Stack,
  type StackOptions,
} from '../../../../tests/e2e/support/stack.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../..');
const shim = resolve(here, 'discord-sdk-shim.ts');

export interface Harness {
  stack: Stack;
  vite: ViteDevServer;
  browser: Browser;
  /** Origin of the web app. */
  base: string;
  close(): Promise<void>;
}

/** A Chrome to drive: `CHROME_PATH`, the usual install locations, then Playwright's download. */
function chromePath(): string | undefined {
  const candidates = [
    process.env['CHROME_PATH'],
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => p !== undefined && p !== '' && existsSync(p));
}

export async function startHarness(options: StackOptions = {}): Promise<Harness> {
  const stack = await startStack(options);
  const vite = await createVite({
    root: webRoot,
    logLevel: 'error',
    // vite.config.ts is read as usual (React plugin, base); this adds the SDK swap and the proxy.
    plugins: [
      {
        // Avatars are served from Discord's CDN through the proxy; answer with a 1x1 image.
        name: 'e2e-cdn-stub',
        configureServer(server) {
          // The shell has no favicon (Discord shows its own); keep the console clean of it.
          server.middlewares.use('/favicon.ico', (_req, res) => {
            res.statusCode = 204;
            res.end();
          });
          server.middlewares.use('/.proxy/discord-cdn', (_req, res) => {
            res.setHeader('content-type', 'image/gif');
            res.end(Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64'));
          });
        },
      },
      {
        name: 'e2e-discord-sdk',
        enforce: 'pre',
        resolveId(source, importer) {
          return source === '@discord/embedded-app-sdk' && importer !== shim ? shim : null;
        },
      },
    ],
    // Inside Discord every call carries `/.proxy`; it is stripped here like Discord's proxy does.
    server: {
      port: 0,
      host: '127.0.0.1',
      proxy: {
        '/.proxy': {
          target: stack.url,
          ws: true,
          rewrite: (path) => path.replace(/^\/\.proxy/, ''),
          // The signature headers Discord would add; the server verifies them when present.
          headers: stack.signed(),
        },
      },
    },
    optimizeDeps: { exclude: ['@discord/embedded-app-sdk'] },
  });
  await vite.listen();
  const base = (vite.resolvedUrls?.local[0] ?? '').replace(/\/$/, '');
  const executablePath = chromePath();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath === undefined ? {} : { executablePath }),
  });
  return {
    stack,
    vite,
    browser,
    base,
    async close() {
      await browser.close();
      await vite.close();
      await stack.close();
    },
  };
}

export interface Launch {
  person?: Person;
  guildId?: string;
  instanceId?: string;
  /** `?screen=` is not used: the launch intent comes from the server. */
  extra?: Record<string, string>;
}

/** The URL Discord would give the Activity iframe. */
export function activityUrl(base: string, launch: Launch = {}): string {
  const query = new URLSearchParams({
    frame_id: 'e2e-frame',
    instance_id: launch.instanceId ?? INSTANCE_A1,
    guild_id: launch.guildId ?? GUILD_A,
    e2e_user: (launch.person ?? ALICE).id,
    ...launch.extra,
  });
  return `${base}/?${query.toString()}`;
}

export interface Viewport {
  name: 'desktop' | '390px';
  width: number;
  height: number;
  mobile: boolean;
}

export const VIEWPORTS: Viewport[] = [
  { name: 'desktop', width: 1280, height: 800, mobile: false },
  { name: '390px', width: 390, height: 844, mobile: true },
];

export interface Problems {
  console: string[];
  failedRequests: string[];
  pageErrors: string[];
}

/** A page in a fresh context that records console errors, page errors and failed requests. */
export async function openPage(
  h: Harness,
  viewport: Viewport,
  options: { locale?: string; colorScheme?: 'light' | 'dark' } = {},
): Promise<{ page: Page; context: BrowserContext; problems: Problems }> {
  const context = await h.browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    locale: options.locale ?? 'en-US',
    colorScheme: options.colorScheme ?? 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const problems: Problems = { console: [], failedRequests: [], pageErrors: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') problems.console.push(`${m.text()} (${m.location().url})`);
  });
  page.on('pageerror', (e) => problems.pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) {
      problems.failedRequests.push(`${r.status()} ${r.url()}`);
    }
  });
  return { page, context, problems };
}
