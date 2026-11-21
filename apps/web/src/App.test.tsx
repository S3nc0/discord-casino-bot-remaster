import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';

describe('App', () => {
  it('renders the app name in both languages', () => {
    expect(renderToStaticMarkup(<App locale="en" />)).toContain('Discord Casino Remaster');
    expect(renderToStaticMarkup(<App locale="ja" />)).toContain('Discord Casino Remaster');
  });
});
