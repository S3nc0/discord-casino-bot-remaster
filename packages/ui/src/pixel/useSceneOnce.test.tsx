import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSceneOnce } from './useSceneOnce.ts';

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-reduced-motion');
});

function Probe({ trigger, onMount = false }: { trigger: number; onMount?: boolean }) {
  return <span>{useSceneOnce({ frames: [1, 2, 3], ms: 100, trigger, rest: 4, onMount })}</span>;
}

const step = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('useSceneOnce', () => {
  it('rests until the trigger changes, then plays once and rests again', () => {
    vi.useFakeTimers();
    const view = render(<Probe trigger={0} />);
    step(500);
    expect(view.container.textContent).toBe('4');
    view.rerender(<Probe trigger={1} />);
    step(0);
    expect(view.container.textContent).toBe('1');
    step(100);
    expect(view.container.textContent).toBe('2');
    step(100);
    expect(view.container.textContent).toBe('3');
    step(100);
    expect(view.container.textContent).toBe('4');
    step(1000);
    expect(view.container.textContent).toBe('4');
  });

  it('plays on mount when asked', () => {
    vi.useFakeTimers();
    const view = render(<Probe trigger={0} onMount />);
    expect(view.container.textContent).toBe('1');
    step(300);
    expect(view.container.textContent).toBe('4');
  });

  it('shows only the still frame under reduced motion', () => {
    vi.useFakeTimers();
    document.documentElement.setAttribute('data-reduced-motion', 'true');
    const view = render(<Probe trigger={0} onMount />);
    expect(view.container.textContent).toBe('4');
    view.rerender(<Probe trigger={1} />);
    for (let i = 0; i < 5; i++) {
      step(100);
      expect(view.container.textContent).toBe('4');
    }
  });
});
