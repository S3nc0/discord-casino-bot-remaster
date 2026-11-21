import { useMemo, useState } from 'react';
import type { InboxItem } from '@casino/shared';
import { inboxKindMessageKey } from '@casino/shared/i18n';
import { Button, List, ListItem, Surface, Tabs, Tag } from '@casino/ui';
import { useLocale, useT } from './i18n.ts';
import { useRuntime } from './runtime.ts';
import { selectUnread, useInboxStore } from './stores/inbox.ts';
import { useToastStore } from './stores/toasts.ts';

type InboxTab = 'all' | 'unread';

export function InboxScreen() {
  const t = useT();
  const locale = useLocale();
  const { api } = useRuntime();
  const items = useInboxStore((s) => s.items);
  const unread = useInboxStore(selectUnread);
  const [tab, setTab] = useState<InboxTab>('all');
  const format = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  const markAll = () => {
    useInboxStore.getState().markAllRead(Date.now());
    api
      .markInboxRead({ all: true })
      .then(({ unread: left }) => useInboxStore.getState().setUnread(left))
      .catch(() => useToastStore.getState().push({ tone: 'error', messageKey: 'error.internal' }));
  };

  const panel = (shown: InboxItem[]) =>
    shown.length === 0 ? (
      <p>{t('inbox.empty')}</p>
    ) : (
      <List label={t('inbox.title')} className="inbox__list">
        {shown.map((item) => (
          <ListItem
            key={item.id}
            headline={t(inboxKindMessageKey(item.kind))}
            supportingText={
              <time dateTime={new Date(item.createdAt).toISOString()}>
                {format.format(item.createdAt)}
              </time>
            }
            trailing={item.readAt === null ? <Tag solid>{t('inbox.unread')}</Tag> : undefined}
          />
        ))}
      </List>
    );

  return (
    <Surface label={t('inbox.title')}>
      <div className="inbox">
        <header className="inbox__head">
          <h1>{t('inbox.title')}</h1>
          <Button variant="tonal" onClick={markAll} disabled={unread === 0}>
            {t('inbox.markAllRead')}
          </Button>
        </header>
        <Tabs
          label={t('inbox.title')}
          activeId={tab}
          onChange={(id) => setTab(id as InboxTab)}
          tabs={[
            { id: 'all', label: t('inbox.title'), panel: panel(items) },
            {
              id: 'unread',
              label: `${t('inbox.unread')} (${unread})`,
              panel: panel(items.filter((i) => i.readAt === null)),
            },
          ]}
        />
      </div>
    </Surface>
  );
}
