import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  container: HTMLElement;
  html: () => string;
  rerender: (ui: ReactElement) => void;
  unmount: () => void;
}

/** Mount into the happy-dom document. Store updates re-render because React is subscribed. */
export function render(ui: ReactElement): Rendered {
  const container = document.createElement('div');
  document.body.append(container);
  const root: Root = createRoot(container);
  act(() => root.render(ui));
  return {
    container,
    html: () => container.innerHTML,
    rerender: (next) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export { act };
