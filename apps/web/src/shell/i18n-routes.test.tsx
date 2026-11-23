// @vitest-environment happy-dom
/**
 * Every route in Japanese. Renders the shell against the in-memory mock API, opens each screen
 * id and fails on anything a player should never see: a raw message key or enum id, snake_case,
 * an unfilled {param}, "undefined", or an English UI word left in a Japanese screen.
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { GAME_IDS, SCREEN_IDS } from '@casino/shared';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Shell } from './Shell.tsx';
import { createMockApi } from './mockApi.ts';
import { RuntimeContext, ShellRuntime } from './runtime.ts';
import { readConfig } from './config.ts';
import { useNavStore } from './stores/nav.ts';
import { useSettingsStore } from './stores/settings.ts';
import { FakeSocket, fakeSdk, resetStores } from './testing/fakes.ts';
import { act, render, type Rendered } from './testing/render.tsx';

/** UI words that exist in the English dictionary and must be translated in Japanese. */
const ENGLISH_WORDS = [
  'Loading',
  'Retry',
  'Try again',
  'Cancel',
  'Confirm',
  'Close',
  'Back',
  'Next',
  'Save',
  'Send',
  'Buy',
  'Sell',
  'Bet',
  'Spin',
  'Roll',
  'Hit',
  'Stand',
  'Double',
  'Deal',
  'Claim',
  'Collect',
  'Upgrade',
  'Borrow',
  'Repay',
  'Deposit',
  'Withdraw',
  'Balance',
  'Total',
  'Today',
  'Win',
  'Lose',
  'Error',
  'Pelica',
  'Teiai',
  'Home',
  'Games',
  'Life',
  'Money',
  'Settings',
  'Inbox',
  'Profile',
  'Shop',
  'Work',
  'Missions',
  'Ranking',
  'Transfer',
  'Quiz',
  'Lottery',
  'Poll',
  'Inventory',
  'Relics',
  'History',
  'Market',
  'Stocks',
  'Crypto',
  'Bank',
  'Loans',
  'Kyosai',
  'Companies',
  'Horse racing',
  'Arena',
  'Slots',
  'Roulette',
  'Pachinko',
  'Blackjack',
  'Chinchiro',
  'Daily bonus',
  'Dealer',
  'Stable',
  'Breed',
  'Race',
  'On',
  'Off',
];
const ENGLISH = new RegExp(
  `(?<![A-Za-z])(?:${ENGLISH_WORDS.map((w) => w.replace(/ /g, '\\s')).join('|')})(?![A-Za-z])`,
);

const PROBLEMS: ReadonlyArray<[string, RegExp]> = [
  [
    'a raw message key',
    /\b(?:screen|error|common|shell|home|settings|inbox|currency|notify)\.[A-Za-z]\w*/,
  ],
  ['snake_case', /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/],
  ['an unfilled {param}', /\{[A-Za-z0-9_]+\}/],
  ['a stringified null', /\b(?:undefined|NaN|null)\b|\[object Object\]/],
  ['a lower-case English word', /(?<![A-Za-z0-9])[a-z]{4,}(?![A-Za-z0-9])/],
  ['an English UI word', ENGLISH],
];

/** Latin lower-case words that are fine in Japanese text: units and tickers of the mock data. */
const ALLOWED = new Set<string>([]);

/** Text other players wrote (the mock's quiz and poll questions): not ours to translate. */
const USER_TEXT = new Set([
  'Which planet has the most moons?',
  'Should the weekly ranking pay a bonus?',
  'Pizza or sushi on Friday?',
  'Add a night mode to the arena?',
  'Largest ocean on Earth?',
]);

const ids = new Set<string>([...SCREEN_IDS, ...GAME_IDS]);

/** Visible text nodes plus the attributes a screen reader reads. */
function visibleStrings(root: Element): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const value = (n.nodeValue ?? '').trim();
    if (value) out.push(value);
  }
  for (const el of root.querySelectorAll('[aria-label],[title],[placeholder],[alt]')) {
    for (const name of ['aria-label', 'title', 'placeholder', 'alt']) {
      const value = el.getAttribute(name)?.trim();
      if (value) out.push(value);
    }
  }
  return out;
}

export function problemsIn(strings: readonly string[]): string[] {
  const found: string[] = [];
  for (const text of strings) {
    if (USER_TEXT.has(text)) continue;
    if (ids.has(text)) found.push(`a raw id: "${text}"`);
    for (const [what, pattern] of PROBLEMS) {
      const m = pattern.exec(text);
      if (m && !ALLOWED.has(m[0])) found.push(`${what}: "${m[0]}" in "${text.slice(0, 80)}"`);
    }
  }
  return found;
}

let mounted: Rendered | null = null;
beforeEach(resetStores);
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const sleep = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

/**
 * Wait until the screen is really in: no loader is marked busy (lazy chunks), the screen has its
 * h1, and the text has stopped changing (mock API calls have landed). A slow chunk only makes
 * this wait longer; it never lets the test read the loading state as the screen.
 */
async function settled(screen: Element): Promise<void> {
  let last = '';
  let same = 0;
  for (let i = 0; i < 400; i++) {
    await sleep(25);
    const ready = !screen.querySelector('[aria-busy="true"]') && screen.querySelector('h1');
    const now = screen.textContent ?? '';
    same = ready && now === last ? same + 1 : 0;
    last = now;
    if (same >= 4) return;
  }
  throw new Error(`screen did not settle: ${(screen.textContent ?? '').slice(0, 80)}`);
}

describe('every route in Japanese', () => {
  it('finds nothing a player should not see', async () => {
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: unknown) => {
      urls.push(String(input));
      return Promise.reject(new Error('no network in this test'));
    }) as typeof fetch;
    onTestFinished(() => {
      globalThis.fetch = realFetch;
      expect(urls).toEqual([]);
    });
    // The horse screens take their in-memory API only when the build flag says so.
    vi.stubEnv('VITE_MOCK_DISCORD', '1');
    onTestFinished(() => void vi.unstubAllEnvs());
    useSettingsStore.getState().update({ language: 'ja' });
    const socket = new FakeSocket();
    const runtime = new ShellRuntime({
      config: readConfig('', { VITE_MOCK_DISCORD: '1' }),
      sdk: fakeSdk({ locale: 'ja' }),
      api: createMockApi({}),
      origin: 'http://localhost',
      socketFactory: () => socket.asSocket(),
    });
    mounted = render(
      <RuntimeContext.Provider value={runtime}>
        <Shell />
      </RuntimeContext.Provider>,
    );
    await act(async () => {
      await runtime.boot();
    });
    await sleep(50);
    const report: string[] = [];
    for (const id of SCREEN_IDS) {
      act(() => useNavStore.getState().go(id));
      const screen = mounted.container.querySelector('.app__screen');
      expect(screen, id).not.toBeNull();
      await settled(screen!);
      // The lazily loaded body is in; the title must be the Japanese name, never the id.
      expect(screen!.querySelector('h1')?.textContent, id).toBeTruthy();
      for (const p of problemsIn(visibleStrings(screen!))) report.push(`${id}: ${p}`);
      // Every tab of the screen too: sub-views are where leftovers hide.
      const tabs = screen!.querySelectorAll<HTMLElement>('[role="tab"]').length;
      for (let i = 0; i < tabs; i++) {
        const tab = screen!.querySelectorAll<HTMLElement>('[role="tab"]')[i];
        if (!tab) break;
        act(() => tab.click());
        await settled(screen!);
        for (const p of problemsIn(visibleStrings(screen!)))
          report.push(`${id} / ${tab.textContent}: ${p}`);
      }
    }
    runtime.presence.stop();
    runtime.settings.stop();
    expect(report).toEqual([]);
  }, 60_000);

  it('the checker itself catches the things it is for', () => {
    const bad = [
      'blackjack',
      'screen.life.work.title',
      'work_dig_failed',
      'Loading',
      'On',
      'Off',
      'もう一度 retry',
      'まで {time}',
      'undefined',
    ];
    for (const text of bad) expect(problemsIn([text]), text).not.toEqual([]);
    expect(
      problemsIn(['ブラックジャック', '12,400 ペリカ', 'Aki', '×3', 'ビットコイン 1.5 CS']),
    ).toEqual([]);
  });

  it('no stylesheet lets a word split in the middle (word-break: break-all)', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.css') && /break-all/.test(readFileSync(path, 'utf8')))
          offenders.push(path);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
