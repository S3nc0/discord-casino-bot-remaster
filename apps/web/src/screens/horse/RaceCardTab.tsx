import { Card, Tag, type TagHue } from '@casino/ui';
import type { HorseRaceSummary, RacePhase } from '@casino/shared';
import { useLocale, useT } from '../../shell/i18n.ts';
import { useDomainEvents, useResource, useServerNow } from './hooks.ts';
import { useEffect } from 'react';
import { useHorseApi } from './context.tsx';
import { formatClock, formatCountdown, formatNumber } from './format.ts';
import { Loading, LoadFailed } from './parts.tsx';

export const PHASE_HUE: Record<RacePhase, TagHue> = {
  upcoming: 'neutral',
  entry_open: 'green',
  entry_closed: 'amber',
  betting: 'sky',
  bet_closed: 'amber',
  done: 'neutral',
};

/** The phase from the clock: the server flips `status` on its 5 s tick, so the screen reads times. */
export function phaseAt(race: HorseRaceSummary, now: number): RacePhase {
  if (race.status === 'done') return 'done';
  if (race.status === 'betting') return now >= race.betClose ? 'bet_closed' : 'betting';
  if (now < race.entryOpen) return 'upcoming';
  return now < race.entryClose ? 'entry_open' : 'entry_closed';
}

/** What the phase tag says, with the countdown that matters in that phase. */
export function PhaseTag({ race, now }: { race: HorseRaceSummary; now: number }) {
  const t = useT();
  const locale = useLocale();
  const phase = phaseAt(race, now);
  let text = t(`screen.horse.phase.${phase}`, { time: formatClock(locale, race.entryOpen) });
  if (phase === 'entry_open') text += ` · ${formatCountdown(race.entryClose - now)}`;
  if (phase === 'betting') text += ` · ${formatCountdown(race.betClose - now)}`;
  return (
    <Tag hue={PHASE_HUE[phase]} solid={phase === 'entry_open' || phase === 'betting'}>
      {text}
    </Tag>
  );
}

export function RaceTitle({ num, race }: { num: number; race: HorseRaceSummary }) {
  const t = useT();
  return (
    <>
      {t('screen.horse.race.title', { num })}
      {race.major ? <Tag hue="yellow">{t('screen.horse.race.major')}</Tag> : null}
      {race.kind === 'special' ? <Tag hue="violet">{t('screen.horse.race.special')}</Tag> : null}
    </>
  );
}

export function RaceTrackLine({ race }: { race: HorseRaceSummary }) {
  const t = useT();
  if (!race.track) return null;
  return (
    <>
      {t('screen.horse.track.line', {
        distance: formatNumber('en', race.track.distance),
        going: t(`screen.horse.going.${race.track.going}`),
      })}
    </>
  );
}

const POLL_MS = 15_000;

export function RaceCardTab({ onOpen }: { onOpen: (id: number, num: number) => void }) {
  const t = useT();
  const locale = useLocale();
  const api = useHorseApi();
  const card = useResource(() => api.card(), [api]);
  const now = useServerNow(card.data?.now);
  const { reload } = card;

  useDomainEvents((event) => {
    if (event.type === 'RaceScheduled' || event.type === 'RaceFinished') void reload();
  });
  useEffect(() => {
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  if (card.error && !card.data) return <LoadFailed onRetry={() => void reload()} />;
  if (!card.data) return <Loading />;
  const { races, nextStartAt } = card.data;
  return (
    <div className="hr-stack">
      <h2 className="bb-eyebrow">{t('screen.horse.card.title')}</h2>
      {races.length === 0 ? (
        <p className="hr-muted">
          {t('screen.horse.card.empty')}
          {nextStartAt !== null
            ? ` ${t('screen.horse.card.next', { time: formatClock(locale, nextStartAt) })}`
            : ''}
        </p>
      ) : null}
      <ul className="hr-list">
        {races.map((race, i) => (
          <li key={race.id}>
            <Card
              variant="filled"
              className="hr-race"
              title={<RaceTitle num={i + 1} race={race} />}
              meta={
                <>
                  {t('screen.horse.race.start', { time: formatClock(locale, race.startAt) })}
                  {race.track ? ' · ' : ''}
                  <RaceTrackLine race={race} />
                </>
              }
              onClick={() => onOpen(race.id, i + 1)}
            >
              <div className="hr-race__row">
                <PhaseTag race={race} now={now} />
                <span className="hr-muted">
                  {t(
                    race.status === 'entry'
                      ? 'screen.horse.race.entrants'
                      : 'screen.horse.race.runnersCount',
                    { n: race.entrants, max: 8 },
                  )}
                </span>
              </div>
              {race.myHorse ? (
                <p className="hr-race__mine">
                  {t('screen.horse.race.mine', { name: race.myHorse.name })}
                </p>
              ) : null}
              {race.myStake > 0 ? (
                <p className="hr-race__mine">
                  {t('screen.horse.race.stake', { amount: formatNumber(locale, race.myStake) })}
                </p>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
