import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Surface } from './index.ts';

describe('Surface', () => {
  it('renders children inside a labelled region', () => {
    const html = renderToStaticMarkup(<Surface label="Lobby">hello</Surface>);
    expect(html).toBe('<section class="bb-surface" aria-label="Lobby">hello</section>');
  });
});
