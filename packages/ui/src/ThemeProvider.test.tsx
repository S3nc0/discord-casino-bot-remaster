import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './index.ts';

function ThemeProbe() {
  const { theme, resolvedTheme, reducedMotion } = useTheme();
  return (
    <div data-testid="probe">
      {theme}:{resolvedTheme}:{String(reducedMotion)}
    </div>
  );
}

function mockMatchMedia(matchesMap: Record<string, boolean>) {
  const listeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>();

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => {
      if (!listeners.has(query)) {
        listeners.set(query, new Set());
      }
      return {
        matches: Boolean(matchesMap[query]),
        media: query,
        addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
          listeners.get(query)?.add(cb);
        },
        removeEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
          listeners.get(query)?.delete(cb);
        },
      };
    }),
  });

  return {
    emit(query: string, matches: boolean) {
      matchesMap[query] = matches;
      for (const cb of listeners.get(query) ?? []) {
        cb({ matches, media: query } as MediaQueryListEvent);
      }
    },
  };
}

describe('ThemeProvider', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-reduced-motion');
  });

  it('defaults to follow-Discord (OS color scheme) and reacts to changes', () => {
    const media = mockMatchMedia({ '(prefers-color-scheme: dark)': true });
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('probe').textContent).toBe('discord:dark:false');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => {
      media.emit('(prefers-color-scheme: dark)', false);
    });
    expect(screen.getByTestId('probe').textContent).toBe('discord:light:false');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('supports explicit light, dark, and discordTheme overrides', () => {
    mockMatchMedia({ '(prefers-color-scheme: dark)': false });
    const { rerender } = render(
      <ThemeProvider theme="dark">
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('dark:dark:false');

    rerender(
      <ThemeProvider theme="discord" discordTheme="dark">
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('discord:dark:false');

    rerender(
      <ThemeProvider theme="light" discordTheme="dark">
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('light:light:false');
  });

  it('honours prefers-reduced-motion and app toggle prop', () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': true });
    const { rerender } = render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('discord:light:true');
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true');

    mockMatchMedia({ '(prefers-reduced-motion: reduce)': false });
    rerender(
      <ThemeProvider reducedMotion={true}>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('discord:light:true');
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true');
  });
});
