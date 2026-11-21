import { isGameId, type ScreenId } from '@casino/shared';
import type { Locale } from '@casino/shared/i18n';
import { currentLocale, formatPelica, screenName, translate } from './i18n.ts';
import type { ActivitySdk } from './sdk.ts';
import { useBalanceStore } from './stores/balance.ts';
import { useNavStore } from './stores/nav.ts';
import { useSessionStore } from './stores/session.ts';
import { useSettingsStore } from './stores/settings.ts';

/** "ブラックジャック中 — 12,400ペリカ" / "Playing Blackjack — 12,400 Pelica". */
export function presenceText(locale: Locale, screen: ScreenId, balance: number | null): string {
  const key = isGameId(screen) ? 'presence.playing' : 'presence.browsing';
  const head = translate(locale, key, { screen: screenName(locale, screen) });
  return balance === null ? head : `${head} — ${formatPelica(locale, balance)}`;
}

/** Discord allows about 5 activity updates per 20 s. */
export const PRESENCE_MIN_INTERVAL_MS = 5_000;

export interface PresenceOptions {
  sdk: ActivitySdk;
  minIntervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Called when the screen changes (the socket tells the server too). */
  onScreen?: (screen: ScreenId) => void;
}

/**
 * Rich presence in the user's language, updated when the screen, balance or language changes.
 * Updates are throttled to one per interval; the newest state always wins. Failures are
 * ignored: `setActivity` needs the `rpc.activities.write` scope, which a user may not grant.
 */
export class PresenceController {
  private lastText: string | null = null;
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private timer: unknown = null;
  private unsubscribe: (() => void)[] = [];
  private readonly startedAt: number;
  private readonly minInterval: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private readonly options: PresenceOptions;

  constructor(options: PresenceOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.minInterval = options.minIntervalMs ?? PRESENCE_MIN_INTERVAL_MS;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.startedAt = this.now();
  }

  start(): void {
    let screen = useNavStore.getState().screen;
    this.unsubscribe.push(
      useNavStore.subscribe((s) => {
        if (s.screen !== screen) {
          screen = s.screen;
          this.options.onScreen?.(screen);
        }
        this.request();
      }),
      useBalanceStore.subscribe(() => this.request()),
      useSettingsStore.subscribe(() => this.request()),
      useSessionStore.subscribe(() => this.request()),
    );
    this.options.onScreen?.(screen);
    this.request();
  }

  stop(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private text(): string {
    return presenceText(
      currentLocale(),
      useNavStore.getState().screen,
      useBalanceStore.getState().balance,
    );
  }

  private request(): void {
    if (useSessionStore.getState().status !== 'ready') return;
    if (this.timer !== null) return; // a send is already queued and will read the newest state
    if (this.text() === this.lastText) return;
    const wait = this.lastSentAt + this.minInterval - this.now();
    if (wait <= 0) {
      this.send();
    } else {
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.send();
      }, wait);
    }
  }

  private send(): void {
    const details = this.text();
    if (details === this.lastText) return;
    this.lastText = details;
    this.lastSentAt = this.now();
    this.options.sdk.setActivity({ details, startedAt: this.startedAt }).catch(() => undefined);
  }
}
