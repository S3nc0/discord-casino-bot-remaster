import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { resolveLocale } from '@casino/shared/i18n';
import { App } from './App.tsx';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App locale={resolveLocale({ client: navigator.language })} />
    </StrictMode>,
  );
}
