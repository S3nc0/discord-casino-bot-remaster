import { useCallback, useEffect, useState } from 'react';
import { Banner, Button, GameIcon } from '@casino/ui';
import type { StreamList, StreamView } from '@casino/shared';
import { screenName, useLocale, useT } from '../../shell/i18n.ts';
import { isFeatureDisabledError, streamErrorMessage } from './helpers.ts';
import { useStreamServices } from './services.tsx';
import { StreamListView } from './StreamListView.tsx';
import { StreamRoomView } from './StreamRoomView.tsx';
import './stream.css';

export default function StreamScreen() {
  const t = useT();
  const locale = useLocale();
  const { api, socket } = useStreamServices();

  const [list, setList] = useState<StreamList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [initialView, setInitialView] = useState<StreamView | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.streams();
      setList(next);
    } catch (err) {
      if (isFeatureDisabledError(err)) setFeatureDisabled(true);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    return socket.onEvent((event) => {
      if (event.type === 'StreamStarted' || event.type === 'StreamEnded') {
        void api
          .streams()
          .then((next) => setList(next))
          .catch(() => undefined);
      }
    });
  }, [socket, api]);

  const handleFeatureDisabled = useCallback(() => setFeatureDisabled(true), []);

  const handleStarted = useCallback(
    (stream: StreamView) => {
      setInitialView(stream);
      setSelectedId(stream.id);
      void api
        .streams()
        .then((next) => setList(next))
        .catch(() => undefined);
    },
    [api],
  );

  const handleBack = useCallback(() => {
    setSelectedId(null);
    setInitialView(null);
    void loadList();
  }, [loadList]);

  return (
    <section className="st" data-screen="stream" aria-labelledby="stream-screen-title">
      <header className="st__head">
        <GameIcon name="stream" className="st__icon" />
        <h1 id="stream-screen-title" className="st__title">
          {screenName(locale, 'stream')}
        </h1>
      </header>

      {selectedId !== null ? (
        <StreamRoomView
          streamId={selectedId}
          initialView={initialView}
          api={api}
          socket={socket}
          featureDisabled={featureDisabled}
          onFeatureDisabled={handleFeatureDisabled}
          onBack={handleBack}
        />
      ) : loading && list === null ? (
        <p className="st__loading" role="status">
          {t('screen.life.loading')}
        </p>
      ) : list === null ? (
        (() => {
          const msg = streamErrorMessage(error);
          return (
            <Banner variant="error" title={t('screen.life.loadError')}>
              <p>{t(msg.key, msg.params)}</p>
              <Button variant="tonal" onClick={() => void loadList()}>
                {t('screen.life.retry')}
              </Button>
            </Banner>
          );
        })()
      ) : (
        <StreamListView
          list={list}
          api={api}
          featureDisabled={featureDisabled}
          onFeatureDisabled={handleFeatureDisabled}
          onSelect={(id) => {
            setInitialView(null);
            setSelectedId(id);
          }}
          onStarted={handleStarted}
        />
      )}
    </section>
  );
}
