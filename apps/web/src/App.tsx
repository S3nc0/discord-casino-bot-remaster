import { RuntimeContext, type ShellRuntime } from './shell/runtime.ts';
import { Shell } from './shell/Shell.tsx';
import { ErrorScreen } from './shell/StatusScreens.tsx';

export interface AppProps {
  /** null when the page was not opened inside Discord and mock mode is off. */
  runtime: ShellRuntime | null;
}

export function App({ runtime }: AppProps) {
  if (!runtime) return <ErrorScreen error="not_in_discord" />;
  return (
    <RuntimeContext.Provider value={runtime}>
      <Shell />
    </RuntimeContext.Provider>
  );
}
