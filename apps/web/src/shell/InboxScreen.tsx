import { useMemo } from 'react';
import { useLocale, useT } from './i18n.ts';
import { useRuntime } from './runtime.ts';
import { selectUnread, useInboxStore } from './stores/inbox.ts';

export function InboxScreen() {
  const t = useT();
  const locale = useLocale();
  const { socket } = useRuntime();
  const items = useInboxStore((s) => s.items);
  const unread = useInboxStore(selectUnread);
  const format = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );
  const markAll = () =>
    socket.markInboxRead(items.filter((i) => i.readAt === null).map((i) => i.id));

  return (
    <section className="panel inbox" aria-labelledby="inbox-title">
      <header className="inbox__head">
        <h1 id="inbox-title">{t('inbox.title')}</h1>
        <button type="button" onClick={markAll} disabled={unread === 0}>
          {t('inbox.markAllRead')}
        </button>
      </header>
      {items.length === 0 ? (
        <p>{t('inbox.empty')}</p>
      ) : (
        <ul className="inbox__list">
          {items.map((item) => (
            <li key={item.id} className="inbox__item" data-unread={item.readAt === null}>
              <span className="inbox__title">{t(`inbox.kind.${item.kind}`)}</span>
              {item.readAt === null ? <span className="sr-only">{t('inbox.unread')}</span> : null}
              <time dateTime={new Date(item.createdAt).toISOString()}>
                {format.format(item.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
