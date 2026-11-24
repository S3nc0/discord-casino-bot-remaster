import { useState, type FormEvent } from 'react';
import { Avatar, Banner, Button, Card, List, ListItem, Tag, TextField } from '@casino/ui';
import { STREAM_LIMITS, type StreamList, type StreamView } from '@casino/shared';
import { formatPelica, useLocale, useT } from '../../shell/i18n.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import type { StreamApi } from './client.ts';
import {
  isFeatureDisabledError,
  pushStreamToast,
  streamErrorMessage,
  useStreamIntent,
} from './helpers.ts';

export interface StreamListViewProps {
  list: StreamList;
  api: StreamApi;
  featureDisabled: boolean;
  onFeatureDisabled: () => void;
  onSelect: (streamId: number) => void;
  onStarted: (stream: StreamView) => void;
}

export function StreamListView({
  list,
  api,
  featureDisabled,
  onFeatureDisabled,
  onSelect,
  onStarted,
}: StreamListViewProps) {
  const t = useT();
  const locale = useLocale();
  const intent = useStreamIntent();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [formError, setFormError] = useState<{
    key: string;
    params: Record<string, string | number>;
  } | null>(null);

  const trimmedTitle = title.trim();
  const canStart =
    !featureDisabled &&
    list.mine === null &&
    trimmedTitle.length >= 1 &&
    trimmedTitle.length <= STREAM_LIMITS.titleMax &&
    !intent.busy;

  const handleStart = (e: FormEvent) => {
    e.preventDefault();
    if (!canStart) return;
    setFormError(null);
    const trimmedUrl = url.trim();
    const label = `start:${trimmedTitle}:${trimmedUrl}`;
    void intent
      .run(
        label,
        (key) =>
          api.start({ title: trimmedTitle, ...(trimmedUrl ? { url: trimmedUrl } : {}) }, key),
        (err) => {
          if (isFeatureDisabledError(err)) onFeatureDisabled();
          const msg = streamErrorMessage(err);
          setFormError({ key: msg.key, params: msg.params as Record<string, string | number> });
          pushStreamToast('error', msg.key, msg.params as Record<string, string | number>);
        },
      )
      .then((res) => {
        if (!res) return;
        useBalanceStore.getState().set(res.balance);
        pushStreamToast('success', 'screen.stream.ui.started');
        setTitle('');
        setUrl('');
        onStarted(res.stream);
      });
  };

  return (
    <div className="st__stack">
      {featureDisabled ? (
        <Banner variant="warning" title={t('screen.stream.ui.featureOff')} />
      ) : null}

      {list.mine !== null ? (
        <div className="st__row">
          <Tag hue="emerald">{t('screen.stream.ui.yourStream')}</Tag>
          <Button variant="tonal" onClick={() => onSelect(list.mine as number)}>
            {t('screen.stream.ui.openMine')}
          </Button>
        </div>
      ) : null}

      <Card variant="filled" title={t('screen.stream.ui.liveList')}>
        {list.streams.length === 0 ? (
          <p className="st__note">{t('screen.stream.ui.emptyList')}</p>
        ) : (
          <List label={t('screen.stream.ui.liveList')}>
            {list.streams.map((item) => (
              <ListItem
                key={item.id}
                headline={item.title}
                supportingText={
                  <span className="st__row">
                    <span>{item.streamerName}</span>
                    {item.id === list.mine ? (
                      <Tag hue="emerald">{t('screen.stream.ui.yourStream')}</Tag>
                    ) : null}
                    {item.roundStatus === 'open' ? (
                      <Tag hue="emerald">{t('screen.stream.round.open')}</Tag>
                    ) : item.roundStatus === 'locked' ? (
                      <Tag hue="orange">{t('screen.stream.round.locked')}</Tag>
                    ) : null}
                  </span>
                }
                leading={<Avatar>{item.streamerName.slice(0, 1).toUpperCase()}</Avatar>}
                trailing={<span className="num">{formatPelica(locale, item.tips)}</span>}
                onSelect={() => onSelect(item.id)}
              />
            ))}
          </List>
        )}
      </Card>

      {list.mine === null ? (
        <Card variant="filled" title={t('screen.stream.ui.startTitle')}>
          <form className="st__stack" onSubmit={handleStart}>
            <TextField
              label={t('screen.stream.ui.titleLabel')}
              value={title}
              maxLength={STREAM_LIMITS.titleMax}
              autoComplete="off"
              disabled={featureDisabled || intent.busy}
              onChange={(e) => setTitle(e.target.value)}
              helperText={t('screen.stream.ui.titleHint', { max: STREAM_LIMITS.titleMax })}
            />
            <TextField
              label={t('screen.stream.ui.urlLabel')}
              value={url}
              maxLength={STREAM_LIMITS.urlMax}
              autoComplete="off"
              disabled={featureDisabled || intent.busy}
              onChange={(e) => setUrl(e.target.value)}
              helperText={t('screen.stream.ui.urlHint')}
            />
            {formError ? (
              <p className="st__error" role="alert">
                {t(formError.key, formError.params)}
              </p>
            ) : null}
            <Button type="submit" disabled={!canStart}>
              {t('screen.stream.ui.startAction')}
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
