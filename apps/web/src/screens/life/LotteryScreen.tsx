import { Banner, Button, Card, Tag } from '@casino/ui';
import type { LotteryView } from '@casino/shared';
import { formatPelica, useLocale, useT } from '../../shell/i18n.ts';
import { useLifeApi } from './api.tsx';
import { formatDuration } from './format.ts';
import { pushToast, useIntent, useLoad, useNow, usePlay } from './hooks.ts';
import { Await, LifeFrame, Stat } from './ui.tsx';

function Result({ last }: { last: NonNullable<LotteryView['last']> }) {
  const t = useT();
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale);
  if (last.iWon) {
    return (
      <Banner
        variant="success"
        title={t('screen.life.lottery.youWon', { prize: nf.format(last.prize) })}
      >
        {t('screen.life.lottery.won', {
          name: last.winnerName ?? '',
          prize: nf.format(last.prize),
          count: last.entrantCount,
        })}
      </Banner>
    );
  }
  if (last.outcome === 'won') {
    return (
      <Banner variant="info" title={t('screen.life.lottery.last')}>
        {t('screen.life.lottery.won', {
          name: last.winnerName ?? '',
          prize: nf.format(last.prize),
          count: last.entrantCount,
        })}
      </Banner>
    );
  }
  return (
    <Banner variant="warning" title={t('screen.life.lottery.last')}>
      {t(last.cancelled ? 'screen.life.lottery.cancelled' : 'screen.life.lottery.refunded')}
    </Banner>
  );
}

export default function LotteryScreen() {
  const t = useT();
  const locale = useLocale();
  const api = useLifeApi();
  const state = useLoad(() => api.lottery(), 15_000);
  const intent = useIntent();
  const play = usePlay();
  const now = useNow(1000);

  const join = (raffleId: number) =>
    void intent
      .run(`join:${raffleId}`, (key) => api.lotteryJoin(raffleId, key))
      .then(async (r) => {
        if (!r) return;
        play('coin');
        pushToast('success', 'screen.life.lottery.joined');
        await state.reload();
      });

  return (
    <LifeFrame screen="lottery" icon="roulette">
      <Await state={state}>
        {(v) => (
          <>
            {v.current ? (
              <Card
                variant="elevated"
                title={t('screen.life.lottery.title')}
                meta={t('screen.life.lottery.host', { name: v.current.hostName })}
              >
                <div className="life-stats">
                  <Stat
                    label={t('screen.life.lottery.pot')}
                    value={formatPelica(locale, v.current.pot)}
                    tone="coin"
                  />
                  <Stat
                    label={t('screen.life.lottery.fee')}
                    value={formatPelica(locale, v.current.fee)}
                  />
                  <Stat label={t('screen.life.lottery.entrants')} value={v.current.entrantCount} />
                </div>
                <p>
                  <Tag hue="sky">
                    {t('screen.life.lottery.closes', {
                      time: formatDuration(t, v.current.closesAt - now),
                    })}
                  </Tag>
                </p>
                {v.current.entrants.length > 0 ? (
                  <ul className="life__tags" aria-label={t('screen.life.lottery.entrants')}>
                    {v.current.entrants.map((name, i) => (
                      <li key={`${name}-${i}`}>
                        <Tag hue="teal">{name}</Tag>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="life__note">{t('screen.life.lottery.noEntrants')}</p>
                )}
                <div className="life__actions">
                  {v.current.joined ? (
                    <Tag hue="green">{t('screen.life.lottery.in')}</Tag>
                  ) : (
                    <Button
                      disabled={intent.busy || v.balance < v.current.fee}
                      onClick={() => join((v.current as NonNullable<typeof v.current>).id)}
                    >
                      {t('screen.life.lottery.buy', { fee: formatPelica(locale, v.current.fee) })}
                    </Button>
                  )}
                </div>
                <p className="life__note">
                  {t('screen.life.lottery.rules', { min: v.minEntrants })}
                </p>
              </Card>
            ) : (
              <p className="life__empty">{t('screen.life.lottery.none')}</p>
            )}
            {v.last ? (
              <Result last={v.last} />
            ) : (
              <p className="life__note">{t('screen.life.lottery.noDraw')}</p>
            )}
          </>
        )}
      </Await>
    </LifeFrame>
  );
}
