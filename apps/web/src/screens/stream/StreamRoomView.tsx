import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Avatar, Banner, Button, Card, PixelScene, Tag, useSceneFrame } from '@casino/ui';
import {
  STREAM_LIMITS,
  streamOddsBps,
  type StreamSettleResult,
  type StreamView,
  type TransferView,
} from '@casino/shared';
import { formatPelica, useLocale, useT } from '../../shell/i18n.ts';
import { RuntimeContext } from '../../shell/runtime.ts';
import { formatDuration } from '../life/format.ts';
import type { StreamApi, StreamDomainEvent, StreamSocket } from './client.ts';
import { isFeatureDisabledError, roundDisplayLabel, streamErrorMessage } from './helpers.ts';
import { RoundCard } from './RoundCard.tsx';
import { ON_AIR_BADGE } from './stream-art.ts';
import { StreamerControls } from './StreamerControls.tsx';
import { TipPanel } from './TipPanel.tsx';

export interface StreamRoomViewProps {
  streamId: number;
  initialView?: StreamView | null;
  api: StreamApi;
  socket: StreamSocket;
  featureDisabled: boolean;
  onFeatureDisabled: () => void;
  onBack: () => void;
}

function applyRoomEvent(prev: StreamView, event: StreamDomainEvent): StreamView {
  switch (event.type) {
    case 'StreamTipped':
      return {
        ...prev,
        tips: Math.max(prev.tips, event.tips),
        tipCount: Math.max(prev.tipCount, event.tipCount),
      };
    case 'StreamBetPlaced':
      if (!prev.round || prev.round.id !== event.roundId) return prev;
      return {
        ...prev,
        round: {
          ...prev.round,
          winTotal: event.winTotal,
          loseTotal: event.loseTotal,
          bettors: event.bettors,
          winOddsBps: streamOddsBps(event.winTotal, event.loseTotal, 'win'),
          loseOddsBps: streamOddsBps(event.winTotal, event.loseTotal, 'lose'),
        },
      };
    case 'StreamRoundOpened':
      return {
        ...prev,
        round: {
          id: event.roundId,
          label: event.label,
          status: 'open',
          openedAt: event.at,
          autoLockAt: event.autoLockAt,
          lockedAt: null,
          winTotal: 0,
          loseTotal: 0,
          bettors: 0,
          winOddsBps: null,
          loseOddsBps: null,
        },
        me: {
          ...prev.me,
          bet: null,
          betRoom: prev.me.isStreamer ? 0 : STREAM_LIMITS.betMax,
        },
      };
    case 'StreamRoundLocked':
      if (!prev.round || prev.round.id !== event.roundId) return prev;
      return {
        ...prev,
        round: {
          ...prev.round,
          status: 'locked',
          lockedAt: event.at,
        },
      };
    case 'StreamRoundSettled':
      if (prev.round && prev.round.id !== event.result.roundId) return prev;
      return {
        ...prev,
        round: null,
        me: { ...prev.me, bet: null, betRoom: 0 },
      };
    case 'StreamEnded':
      return {
        ...prev,
        status: 'ended',
        endedAt: event.at,
        tips: Math.max(prev.tips, event.tips),
        tipCount: Math.max(prev.tipCount, event.tipCount),
        round: null,
        me: { ...prev.me, bet: null, betRoom: 0 },
      };
    default:
      return prev;
  }
}

export function StreamRoomView({
  streamId,
  initialView = null,
  api,
  socket,
  featureDisabled,
  onFeatureDisabled,
  onBack,
}: StreamRoomViewProps) {
  const t = useT();
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale);
  const runtime = useContext(RuntimeContext);

  const [view, setView] = useState<StreamView | null>(
    initialView && initialView.id === streamId ? initialView : null,
  );
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(view === null);
  const [transfer, setTransfer] = useState<TransferView | null>(null);
  const [lastResult, setLastResult] = useState<StreamSettleResult | null>(null);
  const clockOffsetRef = useRef(0);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const onFeatureDisabledRef = useRef(onFeatureDisabled);
  onFeatureDisabledRef.current = onFeatureDisabled;
  const initialViewRef = useRef(initialView);
  initialViewRef.current = initialView;

  const applyView = useCallback((next: StreamView) => {
    clockOffsetRef.current = next.now - Date.now();
    setView(next);
    setLoadError(null);
    setLoading(false);
  }, []);

  const loadView = useCallback(async () => {
    try {
      const v = await api.view(streamId);
      applyView(v);
    } catch (err) {
      if (isFeatureDisabledError(err)) onFeatureDisabledRef.current();
      setLoadError(err);
      setLoading(false);
    }
  }, [api, streamId, applyView]);

  const loadTransfer = useCallback(() => {
    api
      .transfer()
      .then((tv) => setTransfer(tv))
      .catch(() => undefined);
  }, [api]);

  useEffect(() => {
    let active = true;
    const init = initialViewRef.current;
    setLoading(init === null || init.id !== streamId);
    setLoadError(null);
    setLastResult(null);

    api
      .view(streamId)
      .then((v) => {
        if (active) applyView(v);
      })
      .catch((err) => {
        if (!active) return;
        if (isFeatureDisabledError(err)) onFeatureDisabledRef.current();
        setLoadError(err);
        setLoading(false);
      });

    api
      .transfer()
      .then((tv) => {
        if (active) setTransfer(tv);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [api, streamId, applyView]);

  useEffect(() => {
    const leave = socket.join(streamId, (snapshot) => {
      if (snapshot.id === streamId) applyView(snapshot);
    });
    const offEvent = socket.onEvent((event) => {
      if ('streamId' in event && event.streamId !== streamId) return;
      if (event.type === 'StreamRoundOpened') setLastResult(null);
      if (event.type === 'StreamRoundSettled') setLastResult(event.result);
      setView((prev) => (prev ? applyRoomEvent(prev, event) : prev));
      if (event.type === 'StreamTipped') {
        void api
          .view(streamId)
          .then((fresh) => applyView(fresh))
          .catch(() => undefined);
      }
    });
    return () => {
      leave();
      offEvent();
    };
  }, [socket, streamId, api, applyView]);

  const live = view?.status === 'live';
  const badgeFrame = useSceneFrame(ON_AIR_BADGE.frames.length, 650, Boolean(live));

  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  const serverNow = nowTick + clockOffsetRef.current;

  const openExternal = (url: string) => {
    if (!runtime) return;
    void runtime.sdk.openExternalLink(url).catch(() => undefined);
  };

  if (loading && !view) {
    return (
      <div className="st__stack">
        <div className="st__row">
          <Button variant="text" onClick={onBack}>
            {t('screen.stream.ui.back')}
          </Button>
        </div>
        <p className="st__loading" role="status">
          {t('screen.life.loading')}
        </p>
      </div>
    );
  }

  if (!view) {
    const msg = streamErrorMessage(loadError);
    return (
      <div className="st__stack">
        <div className="st__row">
          <Button variant="text" onClick={onBack}>
            {t('screen.stream.ui.back')}
          </Button>
        </div>
        <Banner variant="error" title={t('screen.life.loadError')}>
          <p>{t(msg.key, msg.params)}</p>
          <Button variant="tonal" onClick={() => void loadView()}>
            {t('screen.life.retry')}
          </Button>
        </Banner>
      </div>
    );
  }

  const autoCloseRemaining = Math.max(0, view.endsAt - serverNow);

  return (
    <div className="st__stack">
      <div className="st__row">
        <Button variant="text" onClick={onBack}>
          {t('screen.stream.ui.back')}
        </Button>
        {view.me.isStreamer ? <Tag hue="emerald">{t('screen.stream.ui.yourStream')}</Tag> : null}
      </div>

      {featureDisabled ? (
        <Banner variant="warning" title={t('screen.stream.ui.featureOff')} />
      ) : null}

      {view.status === 'ended' ? (
        <Banner variant="info" title={t('screen.stream.ui.endedNotice')} />
      ) : null}

      <Card variant="filled">
        <div className="st-room__head">
          <div className="st-room__status">
            {live ? (
              <span className="st-room__onair">
                <PixelScene art={ON_AIR_BADGE} frame={badgeFrame} scale={2} />
                <Tag hue="red">{t('screen.stream.ui.liveBadge')}</Tag>
              </span>
            ) : (
              <Tag hue="neutral">{t('screen.stream.ui.endedBadge')}</Tag>
            )}
            {live ? (
              <span className="st__note num">
                {t('screen.stream.ui.autoClose', { time: formatDuration(t, autoCloseRemaining) })}
              </span>
            ) : null}
          </div>

          <h2 className="st-room__heading">{view.title}</h2>

          <div className="st-room__streamer">
            <Avatar>{view.streamerName.slice(0, 1).toUpperCase()}</Avatar>
            <span>{view.streamerName}</span>
          </div>

          <div className="st-room__meta">
            {view.location ? (
              <span data-testid="stream-location">
                {t('screen.stream.ui.location', { channel: view.location.channelId })}
              </span>
            ) : null}
          </div>

          {view.url ? (
            <div>
              <Button variant="tonal" onClick={() => openExternal(view.url as string)}>
                {t('screen.stream.ui.openLink')}
              </Button>
            </div>
          ) : null}

          <div className="st-room__stats">
            <div className="st-stat">
              <span className="st-stat__label">{t('screen.stream.ui.tipsTotal')}</span>
              <span className="st-stat__fig st-stat__fig--coin num">
                {formatPelica(locale, view.tips)}
              </span>
            </div>
            <div className="st-stat">
              <span className="st-stat__label">{t('screen.stream.ui.recentTips')}</span>
              <span className="st-stat__fig num">
                {t('screen.stream.ui.tipsCount', { count: nf.format(view.tipCount) })}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {lastResult ? (
        <Banner
          variant="info"
          title={t('screen.stream.ui.resultTitle', {
            label: roundDisplayLabel(lastResult, t('screen.stream.round.default')),
          })}
        >
          <p className="num">
            {lastResult.outcome === 'void'
              ? t('screen.stream.ui.resultVoid')
              : lastResult.refunded
                ? t('screen.stream.ui.resultRefunded')
                : t('screen.stream.ui.resultOutcome', {
                    side: t(`screen.stream.side.${lastResult.outcome}`),
                    count: nf.format(lastResult.payoutCount),
                    rake: formatPelica(locale, lastResult.rake),
                  })}
          </p>
        </Banner>
      ) : null}

      <RoundCard
        stream={view}
        serverNow={serverNow}
        api={api}
        featureDisabled={featureDisabled}
        onFeatureDisabled={onFeatureDisabled}
        onUpdated={applyView}
      />

      {view.me.isStreamer ? (
        <StreamerControls
          stream={view}
          serverNow={serverNow}
          api={api}
          featureDisabled={featureDisabled}
          onFeatureDisabled={onFeatureDisabled}
          onUpdated={applyView}
          onSettled={setLastResult}
        />
      ) : null}

      <TipPanel
        stream={view}
        transfer={transfer}
        api={api}
        featureDisabled={featureDisabled}
        onFeatureDisabled={onFeatureDisabled}
        onUpdated={applyView}
        onReloadTransfer={loadTransfer}
      />
    </div>
  );
}
