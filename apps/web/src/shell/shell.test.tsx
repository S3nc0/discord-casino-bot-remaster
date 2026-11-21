// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App.tsx';
import { SCREEN_IDS } from '@casino/shared';
import { screenRoutes } from '../screens/index.ts';
import { layoutFor } from './layout.ts';
import { createMockApi } from './mockApi.ts';
import { NavigationBar } from './NavigationBar.tsx';
import { RuntimeContext, ShellRuntime } from './runtime.ts';
import { readConfig } from './config.ts';
import { SettingsScreen } from './SettingsScreen.tsx';
import { Snackbar } from './Snackbar.tsx';
import { resolveTheme } from './theme.ts';
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
      const Route = screenRoutes[id];
      const view = render(<Route />);
      expect(view.container.querySelector('h1')?.textContent).toBeTruthy();
      view.unmount();
    }
  });

  it('re-renders everything in Japanese after the language setting changes', () => {
    useSettingsStore.getState().update({ language: 'en' });
    const view = show(<SettingsScreen />);
    expect(view.html()).toContain('Animations');
    act(() => useSettingsStore.getState().update({ language: 'ja' }));
    expect(view.html()).toContain('アニメーション');
    expect(view.html()).not.toContain('Animations');
  });

  it('writes edits to the settings store from the controls', () => {
    const view = show(<SettingsScreen />);
    const checkbox = view.container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1]!;
    act(() => checkbox.click());
    expect(useSettingsStore.getState().animations).toBe(false);
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
    useInboxStore.getState().set([item(1), item(2)]);
    const view = show(
      <RuntimeContext.Provider value={runtime}>
        <NavigationBar />
      </RuntimeContext.Provider>,
    );
    expect(view.container.querySelector('.nav__badge')?.textContent).toBe('2');
    act(() => useInboxStore.getState().add(item(3)));
    expect(view.container.querySelector('.nav__badge')?.textContent).toBe('3');
    act(() => useInboxStore.getState().markRead([1, 2, 3], 9));
    expect(view.container.querySelector('.nav__badge')).toBeNull();
  });

  it('renders toasts in the active language', () => {
    useToastStore.getState().push({ tone: 'info', messageKey: 'inbox.kind.daily_ready' });
    const view = show(<Snackbar />);
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
    expect(view.container.querySelector('[data-screen="slots"]')).not.toBeNull();
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

  it('follows the Discord colour scheme unless a theme is chosen', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('uses the proxy only inside the Discord frame and mock only behind the flag', () => {
    expect(readConfig('?frame_id=1&instance_id=2', {})).toMatchObject({
      mode: 'discord',
      proxyPrefix: '/.proxy',
    });
    expect(readConfig('', { VITE_MOCK_DISCORD: '1' })).toMatchObject({
      mode: 'mock',
      proxyPrefix: '',
    });
    expect(readConfig('', {}).mode).toBe('none');
    expect(readConfig('?screen=slots', { VITE_MOCK_DISCORD: '1' }).mockScreen).toBe('slots');
    expect(readConfig('?screen=nope', { VITE_MOCK_DISCORD: '1' }).mockScreen).toBeNull();
    expect(readConfig('?screen=slots', {}).mockScreen).toBeNull();
  });
});
