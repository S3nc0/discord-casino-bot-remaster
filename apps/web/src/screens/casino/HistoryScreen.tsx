import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Button, List, ListItem, PixelScene, Surface, Tag } from '@casino/ui';
import type { HistoryEntry } from '@casino/shared';
import { useLocale, useT } from '../../shell/i18n.ts';
import { formatNumber, formatSigned } from './format.ts';
import { errorKeyOf } from './hooks.ts';
import { useCasino } from './services.tsx';
import { HISTORY_LEDGER } from './history-art.ts';
import './games.css';
import './history.css';

const PAGE = 20;

/** The user's ledger, newest first, paged with a "load more" button. */
export default function HistoryScreen() {
  const t = useT();
  const locale = useLocale();
  const { api } = useCasino();
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const format = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  const load = useCallback(
    (before?: number) => {
      setBusy(true);
      setErrorKey(null);
      api
        .history({ limit: PAGE, ...(before === undefined ? {} : { before }) })
        .then((page) => {
          if (!alive.current) return;
          setItems((prev) => (before === undefined ? page.items : [...prev, ...page.items]));
          setNext(page.nextBefore);
          setLoaded(true);
        })
        .catch((error: unknown) => {
          if (alive.current) setErrorKey(errorKeyOf(error));
        })
        .finally(() => {
          if (alive.current) setBusy(false);
        });
    },
    [api],
  );
  useEffect(() => load(), [load]);

  const title = t('screen.history');
  return (
    <Surface label={title}>
      <div className="cc-screen cc-history-screen" data-screen="history">
        <header className="cc-head">
          <h1 className="cc-head__title">{title}</h1>
        </header>
        <div className="sc-scene">
          <PixelScene art={HISTORY_LEDGER} scale={2} />
        </div>
        {errorKey ? (
          <Banner variant="error" title={t('screen.casino.history.loadError')} role="alert">
            <Button variant="tonal" onClick={() => load()} disabled={busy}>
              {t('screen.casino.history.retry')}
            </Button>
          </Banner>
        ) : null}
        {loaded && items.length === 0 ? <p>{t('screen.casino.history.empty')}</p> : null}
        {items.length > 0 ? (
          <List label={t('screen.casino.history.list')} className="cc-ledger" data-theme="light">
            {items.map((entry) => (
              <ListItem
                key={entry.id}
                headline={t(`screen.casino.history.reason.${entry.reason}`)}
                supportingText={
                  <>
                    <time dateTime={new Date(entry.createdAt).toISOString()}>
                      {format.format(entry.createdAt)}
                    </time>
                    {' · '}
                    {t('screen.casino.history.balanceAfter', {
                      amount: formatNumber(locale, entry.balanceAfter),
                    })}
                  </>
                }
                trailing={
                  <Tag hue={entry.delta > 0 ? 'green' : entry.delta < 0 ? 'red' : 'neutral'} solid>
                    {formatSigned(locale, entry.delta)}
                  </Tag>
                }
              />
            ))}
          </List>
        ) : null}
        {next !== null ? (
          <Button variant="outlined" onClick={() => load(next)} disabled={busy}>
            {busy ? t('screen.casino.working') : t('screen.casino.history.more')}
          </Button>
        ) : null}
      </div>
    </Surface>
  );
}
