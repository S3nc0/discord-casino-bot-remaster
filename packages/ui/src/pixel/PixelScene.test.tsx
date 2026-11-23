import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../ThemeProvider.tsx';
import {
  PixelScene,
  PixelTile,
  SceneLayer,
  scenePaths,
  useSceneFrame,
  type SceneArt,
} from './PixelScene.tsx';

const ART: SceneArt = {
  w: 3,
  h: 2,
  legend: { a: ['paper-96', 'neutral-10'], b: ['red-50', 'red-60'] },
  frames: [
    ['aab', '.ba'],
    ['bbb', '...'],
  ],
};

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-reduced-motion');
});

describe('PixelScene', () => {
  it('fills each character from its token for the active theme', () => {
    const light = render(
      <ThemeProvider theme="light" syncDocument={false}>
        <PixelScene art={ART} />
      </ThemeProvider>,
    );
    const fills = (root: HTMLElement) =>
      [...root.querySelectorAll('path')].map((p) => p.getAttribute('fill'));
    expect(fills(light.container)).toEqual(['var(--paper-96)', 'var(--red-50)']);
    light.unmount();
    const dark = render(
      <ThemeProvider theme="dark" syncDocument={false}>
        <PixelScene art={ART} />
      </ThemeProvider>,
    );
    expect(fills(dark.container)).toEqual(['var(--neutral-10)', 'var(--red-60)']);
  });

  it('scales by whole numbers only and is decorative unless labelled', () => {
    const { container } = render(<PixelScene art={ART} scale={2.4} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('6');
    expect(svg.getAttribute('height')).toBe('4');
    expect(svg.getAttribute('viewBox')).toBe('0 0 3 2');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const named = render(<PixelScene art={ART} label="Mine" />);
    expect(named.container.querySelector('svg')!.getAttribute('aria-label')).toBe('Mine');
  });

  it('stacks layers in art pixels, mirrored when asked', () => {
    const { container } = render(
      <PixelScene art={ART}>
        <SceneLayer art={ART} frame={1} x={1} y={1} flip />
      </PixelScene>,
    );
    const g = container.querySelectorAll('g');
    expect(g).toHaveLength(2);
    expect(g[1]!.getAttribute('transform')).toBe('translate(4 1) scale(-1 1)');
    expect(scenePaths(ART, 1)).toEqual([['b', 'M0 0h3v1h-3z']]);
  });

  it('tiles a picture over its box with a pattern', () => {
    const { container } = render(<PixelTile art={ART} scale={2} />);
    const pattern = container.querySelector('pattern')!;
    expect(pattern.getAttribute('width')).toBe('3');
    expect(pattern.getAttribute('patternTransform')).toBe('scale(2)');
    expect(container.querySelector('rect')!.getAttribute('fill')).toBe(`url(#${pattern.id})`);
  });
});

describe('useSceneFrame', () => {
  function Probe({ play = true }: { play?: boolean }) {
    return <span>{useSceneFrame(3, 100, play)}</span>;
  }

  it('steps through the frames and loops', () => {
    vi.useFakeTimers();
    const { container } = render(<Probe />);
    expect(container.textContent).toBe('0');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(container.textContent).toBe('1');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.textContent).toBe('0');
  });

  it('stays on the still frame when stopped or under reduced motion', () => {
    vi.useFakeTimers();
    const stopped = render(<Probe play={false} />);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(stopped.container.textContent).toBe('0');
    stopped.unmount();
    document.documentElement.setAttribute('data-reduced-motion', 'true');
    const reduced = render(<Probe />);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(reduced.container.textContent).toBe('0');
  });
});
