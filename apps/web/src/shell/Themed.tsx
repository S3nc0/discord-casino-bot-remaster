import type { ReactNode } from 'react';
import { ThemeProvider } from '@casino/ui';
import { useSettingsStore } from './stores/settings.ts';
import { motionToReducedMotion } from './theme.ts';

/** Root theme: colour mode and motion come from the user's settings (theme `discord` follows the client). */
export function Themed({ children }: { children: ReactNode }) {
  const theme = useSettingsStore((s) => s.theme);
  const motion = useSettingsStore((s) => s.motion);
  return (
    <ThemeProvider theme={theme} reducedMotion={motionToReducedMotion(motion)} className="app-root">
      {children}
    </ThemeProvider>
  );
}
