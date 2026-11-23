// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PublicUser } from '@casino/shared';
import { RuntimeContext, type ShellRuntime } from '../../shell/runtime.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useNavStore } from '../../shell/stores/nav.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { resetStores } from '../../shell/testing/fakes.ts';
import { act, render, type Rendered } from '../../shell/testing/render.tsx';
import { withServices } from '../casino/testing.tsx';
import { LifeApiContext } from '../life/api.tsx';
import { createMockLifeApi } from '../life/mock.ts';
import ProfileScreen from './ProfileScreen.tsx';

const RUNTIME = { config: { cdnBase: '/cdn' } } as unknown as ShellRuntime;
let mounted: Rendered | null = null;

beforeEach(() => {
  resetStores();
  useBalanceStore.getState().set(12_400);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function signIn(user: Partial<PublicUser> = {}) {
  useSessionStore.getState().authenticated({
    user: { id: '200000000000000002', username: 'p', globalName: 'Player', avatar: null, ...user },
    guildId: '100000000000000001',
    instanceId: 'i-1',
    sessionToken: 's',
    expiresAt: Date.now() + 60_000,
    guildLocale: 'en',
  });
}

async function show(): Promise<HTMLElement> {
  const { element } = withServices(
    <RuntimeContext.Provider value={RUNTIME}>
      <LifeApiContext.Provider value={createMockLifeApi()}>
        <ProfileScreen />
      </LifeApiContext.Provider>
    </RuntimeContext.Provider>,
  );
  mounted = render(element);
  for (let i = 0; i < 3; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  return mounted.container;
}

const text = (el: Element | null | undefined) => el?.textContent ?? '';

describe('profile card', () => {
  it('shows the Discord avatar when the player has one', async () => {
    signIn({ avatar: 'abc123' });
    const root = await show();
    const img = root.querySelector<HTMLImageElement>('.profile-card__portrait img');
    expect(img?.getAttribute('src')).toBe('/cdn/avatars/200000000000000002/abc123.png?size=128');
    expect(root.querySelector('.profile-card__portrait svg')).toBeNull();
  });

  it('draws the pixel placeholder, not a default Discord avatar, when there is none', async () => {
    signIn({ avatar: null });
    const root = await show();
    expect(root.querySelector('.profile-card__portrait img')).toBeNull();
    expect(root.querySelector('.profile-card__portrait svg.bb-scene')).not.toBeNull();
    expect(root.innerHTML).not.toContain('embed/avatars');
  });

  it('puts the name on the ribbon and the numbers on the plaques', async () => {
    signIn();
    const root = await show();
    expect(text(root.querySelector('.profile-card__name'))).toBe('Player');
    const plaque = (key: string) => root.querySelector(`[data-plaque="${key}"]`);
    expect(text(plaque('balance')?.querySelector('dt'))).toBe('Balance');
    expect(text(plaque('balance')?.querySelector('dd'))).toBe('12,400 Pelica');
    expect(text(plaque('streak')?.querySelector('dt'))).toBe('Daily streak');
    expect(text(plaque('streak')?.querySelector('dd'))).toBe('3 days');
    expect(text(plaque('rank')?.querySelector('dt'))).toBe('Weekly rank');
    expect(text(plaque('rank')?.querySelector('dd'))).toBe('2 of 9');
  });

  it('labels the sockets as owned items and lists them in words', async () => {
    signIn();
    const root = await show();
    const sockets = root.querySelector('.profile-card__sockets');
    expect(sockets?.getAttribute('aria-label')).toBe('Owned');
    const icons = [...root.querySelectorAll('.profile-card__socket svg')];
    expect(icons.map((i) => i.getAttribute('aria-label'))).toEqual(['Rookie Gambler']);
    expect(text(root.querySelector('.profile__owned'))).toBe('Owned · Rookie Gambler');
    expect(text(root)).not.toMatch(/equipped/i);
  });

  it('keeps the shortcuts', async () => {
    signIn();
    const root = await show();
    const links = [...root.querySelectorAll<HTMLButtonElement>('.profile__links button')];
    expect(links.map((b) => b.textContent)).toEqual(['Inventory', 'History', 'Relics', 'Settings']);
    await act(async () => links[1]!.click());
    expect(useNavStore.getState().screen).toBe('history');
  });
});
