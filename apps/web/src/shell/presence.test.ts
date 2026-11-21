import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PresenceController, presenceText } from './presence.ts';
import { useBalanceStore } from './stores/balance.ts';
import { useNavStore } from './stores/nav.ts';
import { useSessionStore } from './stores/session.ts';
import { useSettingsStore } from './stores/settings.ts';
import { GUILD, INSTANCE, USER_ID, fakeSdk, resetStores } from './testing/fakes.ts';

describe('presenceText', () => {
  it('speaks the user language', () => {
    expect(presenceText('ja', 'blackjack', 12400)).toBe('ブラックジャック中 — 12,400ペリカ');
    expect(presenceText('en', 'blackjack', 12400)).toBe('Playing Blackjack — 12,400 Pelica');
  });
  it('uses the plain screen name outside games and omits an unknown balance', () => {
    expect(presenceText('en', 'bank', 5)).toBe('Bank — 5 Pelica');
    expect(presenceText('ja', 'home', null)).toBe('ホーム');
  });
});

describe('PresenceController', () => {
  let now = 0;
  const timers: { fn: () => void; ms: number }[] = [];
  let controller: PresenceController | null = null;

  beforeEach(() => {
    resetStores();
    now = 100_000;
    timers.length = 0;
    useSessionStore.getState().authenticated({
      user: { id: USER_ID, username: 'u', globalName: null, avatar: null },
      guildId: GUILD,
      instanceId: INSTANCE,
      sessionToken: 't',
      expiresAt: 1,
      serverLocale: 'en',
    });
  });
  afterEach(() => controller?.stop());

  function start(sdk = fakeSdk(), screens: string[] = []) {
    controller = new PresenceController({
      sdk,
      now: () => now,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimer: () => undefined,
      onScreen: (s) => screens.push(s),
    });
    controller.start();
    return sdk;
  }

  it('sends once at start, throttles later changes and sends only the newest state', () => {
    useBalanceStore.getState().set(100);
    const screens: string[] = [];
    const sdk = start(fakeSdk(), screens);
    expect(sdk.activities.map((a) => a.details)).toEqual(['Home — 100 Pelica']);
    expect(sdk.activities[0]?.startedAt).toBe(100_000);

    now += 1000;
    useNavStore.getState().go('slots');
    useBalanceStore.getState().set(150);
    useNavStore.getState().go('blackjack');
    expect(sdk.activities).toHaveLength(1);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(4000);

    now += 4000;
    timers[0]?.fn();
    expect(sdk.activities.map((a) => a.details)).toEqual([
      'Home — 100 Pelica',
      'Playing Blackjack — 150 Pelica',
    ]);
    expect(screens).toEqual(['home', 'slots', 'blackjack']);
  });

  it('follows a language switch', () => {
    useBalanceStore.getState().set(100);
    const sdk = start();
    now += 6000;
    useSettingsStore.getState().update({ language: 'ja' });
    expect(sdk.activities.at(-1)?.details).toBe('ホーム — 100ペリカ');
  });

  it('does nothing before the session is ready and survives a failing SDK call', async () => {
    useSessionStore.getState().reset();
    const sdk = fakeSdk();
    sdk.setActivity = () => Promise.reject(new Error('missing scope'));
    start(sdk);
    expect(timers).toHaveLength(0);
    useSessionStore.setState({ status: 'ready' });
    await Promise.resolve();
  });
});
