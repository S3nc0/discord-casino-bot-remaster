import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { readConfig } from './shell/config.ts';
import { createRuntime } from './shell/runtime.ts';
import './shell/styles.css';

const root = document.getElementById('root');
if (root) {
  const config = readConfig(window.location.search, import.meta.env);
  const runtime =
    config.mode === 'none'
      ? null
      : createRuntime(window.location.search, window.location.origin, import.meta.env);
  createRoot(root).render(
    <StrictMode>
      <App runtime={runtime} />
    </StrictMode>,
  );
}
