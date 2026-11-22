// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { render, type Rendered } from '../../shell/testing/render.tsx';
import { DiceRow } from './DiceRow.tsx';
import { reduceMotion } from './testing.tsx';
import { prepare } from './testing.tsx';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

const roll = {
  dice: [6, 6, 1] as [number, number, number],
  hand: { kind: 'me' as const, value: 1 },
};
const pips = (root: ParentNode) =>
  [...root.querySelectorAll('.cc-die')].map((d) => d.querySelectorAll('.cc-die__pip').length);

describe('stepped animation', () => {
  beforeEach(() => prepare());

  it('shows the final faces at once under reduced motion', () => {
    reduceMotion(true);
    mounted = render(<DiceRow roll={roll} rollKey="a" />);
    expect(pips(mounted.container)).toEqual([6, 6, 1]);
    expect(mounted.container.querySelector('.cc-die--rolling')).toBeNull();
    expect(mounted.container.textContent).toContain('Point 1');
  });

  it('tumbles through stand-in faces in steps, then settles on the real ones', () => {
    reduceMotion(false);
    vi.useFakeTimers();
    mounted = render(<DiceRow roll={roll} rollKey="b" />);
    const view = mounted;
    expect(view.container.querySelectorAll('.cc-die--rolling')).toHaveLength(3);
    expect(view.container.textContent).toContain('Rolling…');
    act(() => {
      vi.advanceTimersByTime(90 * 3);
    });
    expect(view.container.querySelectorAll('.cc-die--rolling')).toHaveLength(3);
    act(() => {
      vi.advanceTimersByTime(90 * 6);
    });
    expect(view.container.querySelector('.cc-die--rolling')).toBeNull();
    expect(pips(view.container)).toEqual([6, 6, 1]);
    expect(view.container.textContent).toContain('Point 1');
  });

  it('rolls again when the key changes even if the dice are the same', () => {
    reduceMotion(false);
    vi.useFakeTimers();
    mounted = render(<DiceRow roll={roll} rollKey="c1" />);
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(mounted.container.querySelector('.cc-die--rolling')).toBeNull();
    mounted.rerender(<DiceRow roll={roll} rollKey="c2" />);
    expect(mounted.container.querySelectorAll('.cc-die--rolling')).toHaveLength(3);
  });
});
