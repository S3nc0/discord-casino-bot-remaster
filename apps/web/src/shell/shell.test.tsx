// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import { SCREEN_IDS } from '@casino/shared';
import { screenRoutes } from '../screens/index.ts';
import { casinoRoutes } from '../screens/casino/lazy.tsx';
import { layoutFor } from './layout.ts';
import { createMockApi } from './mockApi.ts';
import { MainNavigation } from './NavigationBar.tsx';
import { RuntimeContext, ShellRuntime } from './runtime.ts';
import { readConfig } from './config.ts';
import { SettingsScreen } from './SettingsScreen.tsx';
import { Toasts } from './Snackbar.tsx';
import { Themed } from './Themed.tsx';
import { InboxScreen } from './InboxScreen.tsx';
import { DISCORD_CDN_ORIGIN } from '@casino/shared';
import { Participants } from './Participants.tsx';
import { motionToReducedMotion } from './theme.ts';
import { useInboxStore } from './stores/inbox.ts';
import { useNavStore } from './stores/nav.ts';
import { useSessionStore } from './stores/session.ts';
import { useSettingsStore } from './stores/settings.ts';
import { useToastStore } from './stores/toasts.ts';
import { FakeSocket, GUILD, fakeSdk, resetStores } from './testing/fakes.ts';
import type { InboxItem } from '@casino/shared';
import { act, render, type Rendered } from './testing/render.tsx';

let mounted: Rendered | null = null;
beforeEach(resetStores);
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const show = (ui: Parameters<typeof render>[0]) => (mounted = render(ui));

function makeRuntime(screen: Parameters<typeof createMockApi>[0] = {}) {
  const socket = new FakeSocket();
  const sdk = fakeSdk({ locale: 'en-US' });
  const runtime = new ShellRuntime({
    config: readConfig('', { VITE_MOCK_DISCORD: '1' }),
    sdk,
    api: createMockApi(screen),
    origin: 'http://localhost',
    socketFactory: () => socket.asSocket(),
  });
  return { runtime, socket, sdk };
}

describe('boot', () => {
  it('authenticates, opens the launch-intent screen, connects, and loads settings, inbox and balance', async () => {
    const { runtime, socket, sdk } = makeRuntime({ launchScreen: 'blackjack', balance: 777 });
    await runtime.boot();
    expect(useSessionStore.getState().status).toBe('ready');
    expect(useNavStore.getState().screen).toBe('blackjack');
    expect(socket.handlers.has('connect')).toBe(true);
    expect(useSettingsStore.getState().loaded).toBe(true);
    expect(useInboxStore.getState().loaded).toBe(true);
    expect(sdk.activities.at(-1)?.details).toBe('Playing Blackjack — 777 Pelica');
    runtime.presence.stop();
    runtime.settings.stop();
  });

  it('falls back to Home without an intent and is idempotent', async () => {
    const { runtime } = makeRuntime();
    await Promise.all([runtime.boot(), runtime.boot()]);
    expect(useNavStore.getState().screen).toBe('home');
    runtime.presence.stop();
    runtime.settings.stop();
  });

  it('leaves the error in the store when auth fails', async () => {
    const { runtime } = makeRuntime();
    runtime.api.token = () => Promise.reject(new Error('down'));
    await runtime.boot();
    expect(useSessionStore.getState()).toMatchObject({ status: 'error', error: 'internal' });
  });
});

describe('rendering', () => {
  it('shows the not-in-Discord message without a runtime', () => {
    expect(show(<App runtime={null} />).html()).toContain('Discord Activity');
  });

  it('renders a placeholder for every screen id', () => {
    for (const id of SCREEN_IDS) {
      // Screens that have been built carry their own tests (screens/casino/*.test.tsx).
      if (id in casinoRoutes) continue;
      const Route = screenRoutes[id];
      const view = render(<Route />);
      expect(view.container.querySelector('h1, h3')?.textContent).toBeTruthy();
      view.unmount();
    }
  });

  it('re-renders everything in Japanese after the language setting changes', () => {
    useSettingsStore.getState().update({ language: 'en' });
    const view = show(<SettingsScreen />);
    expect(view.html()).toContain('Follow system');
    act(() => useSettingsStore.getState().update({ language: 'ja' }));
    expect(view.html()).toContain('アニメーション');
    expect(view.html()).not.toContain('Animations');
  });

  it('writes edits to the settings store from the kit controls', () => {
    const view = show(<SettingsScreen />);
    const radio = (value: string) =>
      view.container.querySelector<HTMLInputElement>(`input[type=radio][value="${value}"]`)!;
    act(() => radio('reduced').click());
    expect(useSettingsStore.getState().motion).toBe('reduced');
    act(() => radio('dark').click());
    expect(useSettingsStore.getState().theme).toBe('dark');
    act(() => radio('ja').click());
    expect(useSettingsStore.getState().language).toBe('ja');
    const toggle = view.container.querySelector<HTMLInputElement>('input[role=switch]')!;
    act(() => toggle.click());
    expect(useSettingsStore.getState().sound.enabled).toBe(false);
    expect(view.container.querySelector<HTMLInputElement>('input[type=range]')!.disabled).toBe(
      true,
    );
  });

  it('lists the inbox with a tab for unread items', () => {
    const { runtime } = makeRuntime();
    const mk = (id: number, readAt: number | null) =>
      ({
        id,
        guildId: GUILD,
        kind: 'loan_due',
        event: {},
        createdAt: id,
        readAt,
      }) as unknown as InboxItem;
    useInboxStore.getState().set([mk(1, null), mk(2, 5)], 1);
    const view = show(
      <RuntimeContext.Provider value={runtime}>
        <InboxScreen />
      </RuntimeContext.Provider>,
    );
    expect(view.container.querySelectorAll('li.bb-list__item')).toHaveLength(2);
    const tabs = view.container.querySelectorAll<HTMLButtonElement>('[role=tab]');
    act(() => tabs[1]!.click());
    expect(view.container.querySelectorAll('li.bb-list__item')).toHaveLength(1);
  });

  it('marks all read through the API and shows the server count', async () => {
    const { runtime } = makeRuntime();
    const calls: unknown[] = [];
    runtime.api.markInboxRead = (request) => {
      calls.push(request);
      return Promise.resolve({ unread: 0 });
    };
    useInboxStore.getState().set(
      [
        {
          id: 1,
          guildId: GUILD,
          kind: 'loan_due',
          event: {},
          createdAt: 1,
          readAt: null,
        } as unknown as InboxItem,
      ],
      1,
    );
    const view = show(
      <RuntimeContext.Provider value={runtime}>
        <InboxScreen />
      </RuntimeContext.Provider>,
    );
    await act(async () => {
      view.container.querySelector<HTMLButtonElement>('button.bb-btn')!.click();
    });
    expect(calls).toEqual([{ all: true }]);
    expect(useInboxStore.getState().unread).toBe(0);
  });

  it('draws participant avatars from the CDN base', () => {
    const { runtime } = makeRuntime();
    useSessionStore
      .getState()
      .setParticipants([
        { id: '200000000000000001', username: 'p', globalName: 'P', avatar: 'abc' },
      ]);
    const view = show(
      <RuntimeContext.Provider value={runtime}>
        <Participants />
      </RuntimeContext.Provider>,
    );
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(
      `${DISCORD_CDN_ORIGIN}/avatars/200000000000000001/abc.png?size=64`,
    );
  });

  it('themes the document from the settings', () => {
    show(
      <Themed>
        <p>x</p>
      </Themed>,
    );
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBeNull();
    act(() => useSettingsStore.getState().update({ theme: 'dark', motion: 'reduced' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true');
    act(() => useSettingsStore.getState().update({ theme: 'light', motion: 'full' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBeNull();
  });

  it('shows the unread badge on the inbox button and updates it live', () => {
    const { runtime } = makeRuntime();
    const item = (id: number) =>
      ({
        id,
        guildId: GUILD,
        kind: 'daily_ready',
        event: {},
        createdAt: id,
        readAt: null,
      }) as unknown as InboxItem;
    useInboxStore.getState().set([item(1), item(2)], 2);
    const view = show(
      <RuntimeContext.Provider value={runtime}>
        <MainNavigation />
      </RuntimeContext.Provider>,
    );
    expect(view.container.querySelector('.bb-badge')?.textContent).toBe('2');
    act(() => useInboxStore.getState().add(item(3)));
    expect(view.container.querySelector('.bb-badge')?.textContent).toBe('3');
    act(() => useInboxStore.getState().markRead([1, 2, 3], 9));
    expect(view.container.querySelector('.bb-badge')).toBeNull();
  });

  it('renders toasts in the active language', () => {
    useToastStore.getState().push({ tone: 'info', messageKey: 'inbox.kind.daily_ready' });
    const view = show(<Toasts />);
    expect(view.html()).toContain('Daily bonus ready');
    act(() => useSettingsStore.getState().update({ language: 'ja' }));
    expect(view.html()).toContain('デイリーボーナス受け取り可');
  });

  it('boots into the shell and lands on the launch-intent screen', async () => {
    const { runtime } = makeRuntime({ launchScreen: 'slots' });
    const view = show(<App runtime={runtime} />);
    await act(async () => {
      await runtime.boot();
    });
    // Built screens load on first visit (lazy chunk), so wait for it.
    await vi.waitFor(() =>
      expect(view.container.querySelector('[data-screen="slots"]')).not.toBeNull(),
    );
    expect(view.container.querySelector('.app')?.getAttribute('data-layout')).toBeTruthy();
    runtime.presence.stop();
    runtime.settings.stop();
  });
});

describe('layout, theme and config', () => {
  it('picks the layout from the viewport, including orientation changes', () => {
    expect(layoutFor(1280, 800)).toBe('desktop');
    expect(layoutFor(390, 844)).toBe('mobile-portrait');
    expect(layoutFor(844, 390)).toBe('mobile-landscape');
    expect(layoutFor(1024, 768)).toBe('desktop');
  });

  it('maps the motion setting onto the kit: system follows the OS, the toggle forces it', () => {
    expect(motionToReducedMotion('system')).toBe('system');
    expect(motionToReducedMotion('full')).toBe('no-preference');
    expect(motionToReducedMotion('reduced')).toBe('reduce');
  });

  it('uses the proxy only inside the Discord frame and mock only behind the flag', () => {
    expect(readConfig('?frame_id=1&instance_id=2', {})).toMatchObject({
      mode: 'discord',
      proxyPrefix: '/.proxy',
      cdnBase: '/.proxy/discord-cdn',
    });
    expect(readConfig('', { VITE_MOCK_DISCORD: '1' })).toMatchObject({
      mode: 'mock',
      proxyPrefix: '',
      cdnBase: DISCORD_CDN_ORIGIN,
    });
    expect(readConfig('', {}).mode).toBe('none');
    expect(readConfig('?screen=slots', { VITE_MOCK_DISCORD: '1' }).mockScreen).toBe('slots');
    expect(readConfig('?screen=nope', { VITE_MOCK_DISCORD: '1' }).mockScreen).toBeNull();
    expect(readConfig('?screen=slots', {}).mockScreen).toBeNull();
  });
});
