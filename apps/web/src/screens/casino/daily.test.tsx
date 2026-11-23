// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scenePaths, type SceneArt } from '@casino/ui';
import { render, type Rendered } from '../../shell/testing/render.tsx';
import DailyScreen from './DailyScreen.tsx';
import { DAILY_GIFT, DAILY_STAMP } from './daily-art.ts';
import { button, click, fakeApi, prepare, settle, text, withServices } from './testing.tsx';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

async function show(api = fakeApi()) {
  const { element } = withServices(<DailyScreen />, { api });
  mounted = render(element);
  await settle();
  return mounted.container;
}

/** The layers of the room drawn with this picture and frame (matched by their path data). */
const layers = (root: ParentNode, art: SceneArt, frame = 0) => {
  const want = scenePaths(art, frame)
    .map(([, d]) => d)
    .join('|');
  return [...root.querySelectorAll('.sc-scene g')].filter(
    (g) => [...g.querySelectorAll('path')].map((p) => p.getAttribute('d')).join('|') === want,
  );
};

describe('Daily screen', () => {
  beforeEach(() => prepare());

  it('draws the room above the bonus card, stamping one calendar day per streak day', async () => {
    const root = await show();
    const room = root.querySelector('.cc-daily > .sc-scene + .daily');
    expect(room).not.toBeNull();
    expect(root.querySelector('.sc-scene svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(layers(root, DAILY_STAMP)).toHaveLength(3);
    // waiting bonus: the box is closed (the still frame under reduced motion)
    expect(layers(root, DAILY_GIFT, 0)).toHaveLength(1);
    expect(text(root)).toContain('Streak: 3 days');
  });

  it('opens the gift and stamps the new day after a claim', async () => {
    // like the server: after a claim the status says the slot is taken
    let claimed = false;
    const base = fakeApi();
    const root = await show(
      fakeApi({
        daily: () =>
          Promise.resolve(
            claimed
              ? { claimable: false, nextSlotAt: Date.now() + 60_000, streak: 4 }
              : { claimable: true, nextSlotAt: 1_000, streak: 3 },
          ),
        claimDaily: (key) => {
          claimed = true;
          return base.claimDaily(key);
        },
      }),
    );
    await click(button(root, 'Claim bonus'));
    await settle();
    expect(text(root)).toContain('Claimed 1,300 Pelica');
    expect(layers(root, DAILY_GIFT, 5)).toHaveLength(1);
    expect(layers(root, DAILY_STAMP)).toHaveLength(4);
  });

  it('shows the box open when today is already claimed', async () => {
    const root = await show(
      fakeApi({
        daily: () =>
          Promise.resolve({ claimable: false, nextSlotAt: Date.now() + 60_000, streak: 9 }),
      }),
    );
    expect(layers(root, DAILY_GIFT, 5)).toHaveLength(1);
    // the week restarts after seven days: day 9 is the second stamp
    expect(layers(root, DAILY_STAMP)).toHaveLength(2);
  });
});
