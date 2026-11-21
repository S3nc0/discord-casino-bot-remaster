import { useEffect } from 'react';
import { useLayout } from './layout.ts';
import { formatPelica, useLocale, useT } from './i18n.ts';
import { InboxScreen } from './InboxScreen.tsx';
import { NavigationBar } from './NavigationBar.tsx';
import { Participants } from './Participants.tsx';
import { useRuntime } from './runtime.ts';
import { SettingsScreen } from './SettingsScreen.tsx';
import { Snackbar } from './Snackbar.tsx';
import { ErrorScreen, LoadingScreen } from './StatusScreens.tsx';
import { useBalanceStore } from './stores/balance.ts';
import { useConnectionStore } from './stores/connection.ts';
import { useNavStore } from './stores/nav.ts';
import { useSessionStore } from './stores/session.ts';
import { useDocumentEffects } from './theme.ts';
import { screenRoutes } from '../screens/index.ts';

function ConnectionBadge() {
  const t = useT();
  const status = useConnectionStore((s) => s.status);
  if (status === 'online') return null;
  const key =
    status === 'connecting'
      ? 'shell.connecting'
      : status === 'reconnecting'
        ? 'shell.reconnecting'
        : 'shell.offline';
  return (
    <span className="conn" role="status" data-status={status}>
      {t(key)}
    </span>
  );
}

function TopBar() {
  const locale = useLocale();
  const t = useT();
  const balance = useBalanceStore((s) => s.balance);
  return (
    <header className="topbar">
      <Participants />
      <ConnectionBadge />
      {balance !== null ? (
        <output className="topbar__balance" aria-label={t('shell.balance')}>
          {formatPelica(locale, balance)}
        </output>
      ) : null}
    </header>
  );
}

function Screen() {
  const screen = useNavStore((s) => s.screen);
  if (screen === 'settings') return <SettingsScreen />;
  if (screen === 'inbox') return <InboxScreen />;
  const Route = screenRoutes[screen];
  return <Route />;
}

/** Boots the runtime and renders the responsive shell once the session is ready. */
export function Shell() {
  const runtime = useRuntime();
  const status = useSessionStore((s) => s.status);
  const error = useSessionStore((s) => s.error);
  const layout = useLayout();
  useDocumentEffects();

  useEffect(() => {
    void runtime.boot();
  }, [runtime]);

  if (status === 'error' && error) {
    return <ErrorScreen error={error} onRetry={() => void runtime.retry()} />;
  }
  if (status !== 'ready') return <LoadingScreen />;

  return (
    <div className="app" data-layout={layout}>
      <NavigationBar />
      <div className="app__main">
        <TopBar />
        <main className="app__screen">
          <Screen />
        </main>
      </div>
      <Snackbar />
    </div>
  );
}
