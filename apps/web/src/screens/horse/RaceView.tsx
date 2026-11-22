import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Chip, ChipGroup, Tag, isReducedMotionActive, useSfx } from '@casino/ui';
import { formatPelica } from '@casino/shared/i18n';
import type { HorseStable, HorseTimeline } from '@casino/shared';
import { useLocale, useT } from '../../shell/i18n.ts';
import { newKey } from './api.ts';
import { BetSlip } from './BetSlip.tsx';
import { useHorseApi } from './context.tsx';
import { formatCountdown, formatNumber, formatOdds, formatPicks } from './format.ts';
import { applyBalance, useDomainEvents, useResource, useRunner, useServerNow } from './hooks.ts';
import { ErrorNote, LoadFailed, Loading, Section, SilksDot, StatCells } from './parts.tsx';
import { PhaseTag, RaceTitle, RaceTrackLine, phaseAt } from './RaceCardTab.tsx';
import { RaceTrack } from './RaceTrack.tsx';

/** One animation step. The horses move in steps of this length. */
export const FRAME_MS = 260;
const POLL_MS = 5000;

export interface RaceViewProps {
  raceId: number;
  num: number;
  stable: HorseStable;
  /** Reload the stable after an entry or a withdrawal changed it. */
  onStableChange: () => void;
  onBack: () => void;
}

export function RaceView({ raceId, num, stable, onStableChange, onBack }: RaceViewProps) {
  const { rules } = stable;
  const t = useT();
  const locale = useLocale();
  const api = useHorseApi();
  const sfx = useSfx();
  const detail = useResource(() => api.race(raceId), [api, raceId]);
  const now = useServerNow(detail.data?.now);
  const entry = useRunner();
  const [horseId, setHorseId] = useState<number | null>(null);
  const [timeline, setTimeline] = useState<HorseTimeline | null>(null);
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const { reload } = detail;
  const celebrated = useRef(false);
  const liveRef = useRef<HTMLDivElement | null>(null);

  const finished = detail.data?.race.status === 'done';
  useEffect(() => {
    // A finished race no longer changes: stop asking.
    if (finished) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [reload, finished]);

  const watch = useCallback(async () => {
    try {
      const data = await api.timeline(raceId);
      const skip = isReducedMotionActive();
      setReduced(skip);
      setTimeline(data);
      celebrated.current = false;
      setTick(skip ? data.frames.length : 0);
      setPlaying(!skip);
    } catch {
      // The result list still tells the story.
    }
  }, [api, raceId]);

  // The race ran while this screen was open: show it.
  useDomainEvents((event) => {
    if (event.type === 'RaceFinished' && event.raceId === raceId) {
      void reload().then(() => watch());
    }
  });

  useEffect(() => {
    // Bring the track into view when a race starts (a replay is started from the result list).
    const el = liveRef.current;
    const scroller = el?.closest('.app__screen');
    if (el && scroller) {
      // Scroll the screen's own container, never the page behind the shell.
      scroller.scrollTop +=
        el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
    }
  }, [timeline]);

  useEffect(() => {
    if (!playing || !timeline) return;
    const timer = setInterval(() => {
      setTick((current) => {
        if (current + 1 >= timeline.frames.length) {
          setPlaying(false);
          return timeline.frames.length;
        }
        return current + 1;
      });
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [playing, timeline]);

  const finishedPlaying = timeline !== null && tick >= timeline.frames.length;
  const prize = detail.data?.myPrize ?? 0;
  const payout = useMemo(
    () => (detail.data?.tickets ?? []).reduce((sum, ticket) => sum + (ticket.payout ?? 0), 0),
    [detail.data],
  );
  useEffect(() => {
    if (!finishedPlaying || celebrated.current || reduced) return;
    celebrated.current = true;
    sfx.play(prize + payout >= 10_000 ? 'bigWin' : prize + payout > 0 ? 'smallWin' : 'lose');
  }, [finishedPlaying, payout, prize, reduced, sfx]);

  if (detail.error && !detail.data) return <LoadFailed onRetry={() => void reload()} />;
  if (!detail.data) return <Loading />;
  const { race, runners, odds, tickets, enterable } = detail.data;
  const phase = phaseAt(race, now);
  const done = phase === 'done';
  const mineEntered = runners.find((r) => r.mine && r.horseId !== null);
  const pickedHorse = horseId ?? enterable[0] ?? null;
  const coats: Record<number, string> = {};
  for (const r of runners) coats[r.lane] = r.coat;
  const stake = tickets.reduce((s, tk) => s + tk.stake, 0);

  const enter = async () => {
    if (pickedHorse === null) return;
    const res = await entry.run(async () => {
      const r = await api.enter(raceId, { horseId: pickedHorse }, newKey());
      applyBalance(r.balance);
      return r;
    }, 'screen.horse.entry.done');
    if (res) {
      await reload();
      onStableChange();
    }
  };
  const withdraw = async () => {
    if (!mineEntered?.horseId) return;
    const id = mineEntered.horseId;
    const res = await entry.run(async () => {
      const r = await api.withdraw(raceId, { horseId: id }, newKey());
      applyBalance(r.balance);
      return r;
    }, 'screen.horse.entry.withdrawn');
    if (res) {
      await reload();
      onStableChange();
    }
  };

  return (
    <div className="hr-stack">
      <button type="button" className="bb-btn bb-btn--text bb-state hr-back" onClick={onBack}>
        ← {t('screen.horse.race.back')}
      </button>
      <Card
        variant="filled"
        className="hr-race hr-race--head"
        title={<RaceTitle num={num} race={race} />}
        meta={
          <>
            {t('screen.horse.race.start', {
              time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
                race.startAt,
              ),
            })}
            {race.track ? ' · ' : ''}
            <RaceTrackLine race={race} />
          </>
        }
      >
        <div className="hr-race__row">
          <PhaseTag race={race} now={now} />
          {!done ? (
            <span className="hr-muted">
              {t('screen.horse.live.countdown', { time: formatCountdown(race.startAt - now) })}
            </span>
          ) : null}
        </div>
      </Card>

      {timeline ? (
        <div ref={liveRef}>
          <Section title={t('screen.horse.live.title')} id="hr-live">
            <RaceTrack timeline={timeline} tick={tick} playing={playing} coats={coats} />
            {reduced ? <p className="hr-muted">{t('screen.horse.live.reduced')}</p> : null}
            {playing ? (
              <Button
                variant="outlined"
                onClick={() => {
                  setPlaying(false);
                  setTick(timeline.frames.length);
                }}
              >
                {t('screen.horse.live.skip')}
              </Button>
            ) : null}
          </Section>
        </div>
      ) : null}

      {done && race.placings ? (
        <Section title={t('screen.horse.result.title')} id="hr-result">
          <ol className="hr-placings">
            {race.placings.map((lane, i) => {
              const r = runners.find((x) => x.lane === lane);
              if (!r) return null;
              return (
                <li key={lane} className={`hr-placing${r.mine ? ' is-mine' : ''}`}>
                  <span className="hr-placing__no">
                    {t('screen.horse.result.place', { n: i + 1 })}
                  </span>
                  <SilksDot silks={r.silks} />
                  <span className="hr-placing__name">{r.name}</span>
                  <span className="hr-muted">{r.lane}</span>
                </li>
              );
            })}
          </ol>
          {runners.some((r) => r.mine) ? (
            <p className={prize > 0 ? 'hr-ok' : 'hr-muted'}>
              {prize > 0
                ? t('screen.horse.result.prize', { amount: formatPelica(locale, prize) })
                : t('screen.horse.result.noPrize')}
            </p>
          ) : null}
          {tickets.length > 0 ? (
            <p className={payout > 0 ? 'hr-ok' : 'hr-muted'}>
              {payout > 0
                ? t('screen.horse.result.payout', { amount: formatPelica(locale, payout) })
                : t('screen.horse.result.missed')}
            </p>
          ) : null}
          {detail.data.hasTimeline ? (
            <Button variant="tonal" onClick={() => void watch()}>
              {timeline ? t('screen.horse.live.replay') : t('screen.horse.live.watch')}
            </Button>
          ) : null}
        </Section>
      ) : null}

      {phase === 'entry_open' ? (
        <Section title={t('screen.horse.entry.title')} id="hr-entry">
          <p className="hr-muted">
            {t('screen.horse.entry.fee', { fee: formatPelica(locale, rules.entryFee) })}{' '}
            {t('screen.horse.race.fieldNote')}
          </p>
          {mineEntered ? (
            <>
              <p className="hr-ok">{t('screen.horse.entry.entered', { name: mineEntered.name })}</p>
              <Button variant="outlined" disabled={entry.busy} onClick={() => void withdraw()}>
                {t('screen.horse.entry.withdraw', { name: mineEntered.name })}
              </Button>
            </>
          ) : enterable.length === 0 ? (
            <p className="hr-muted">{t('screen.horse.entry.none')}</p>
          ) : (
            <>
              <ChipGroup label={t('screen.horse.entry.pick')} className="hr-picks">
                {stable.horses
                  .filter((h) => enterable.includes(h.id))
                  .map((h) => (
                    <Chip
                      key={h.id}
                      selected={pickedHorse === h.id}
                      icon={<SilksDot silks={h.silks} />}
                      onClick={() => setHorseId(h.id)}
                    >
                      {h.name}
                    </Chip>
                  ))}
              </ChipGroup>
              <Button disabled={entry.busy || pickedHorse === null} onClick={() => void enter()}>
                {t('screen.horse.entry.enter', {
                  name: stable.horses.find((h) => h.id === pickedHorse)?.name ?? '',
                })}
              </Button>
            </>
          )}
          <ErrorNote error={entry.error} rules={rules} />
        </Section>
      ) : null}

      {phase === 'betting' ? (
        <Section title={t('screen.horse.bet.title')} id="hr-bet">
          <BetSlip detail={detail.data} rules={rules} onBought={() => void reload()} />
        </Section>
      ) : phase === 'entry_open' || phase === 'upcoming' || phase === 'entry_closed' ? (
        <p className="hr-muted">{t('screen.horse.bet.later')}</p>
      ) : phase === 'bet_closed' ? (
        <p className="hr-muted">{t('screen.horse.bet.closed')}</p>
      ) : null}

      {tickets.length > 0 || stake > 0 ? (
        <Section title={t('screen.horse.tickets.title')} id="hr-tickets">
          <ul className="hr-tickets">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="hr-ticket">
                <span>
                  <strong>{t(`screen.horse.bet.kind.${ticket.kind}`)}</strong>{' '}
                  {formatPicks(ticket.key)}
                </span>
                <span className="hr-muted">
                  {t('screen.horse.ticket.detail', {
                    stake: formatNumber(locale, ticket.stake),
                    odds: formatOdds(ticket.oddsTenths),
                  })}
                </span>
                <span className="hr-ticket__state">
                  {ticket.payout === null ? (
                    <Tag hue="neutral">{t('screen.horse.ticket.pending')}</Tag>
                  ) : ticket.payout > 0 ? (
                    <Tag hue="green" solid>
                      {t('screen.horse.ticket.payout', {
                        amount: formatNumber(locale, ticket.payout),
                      })}
                    </Tag>
                  ) : (
                    <Tag hue="red">{t('screen.horse.ticket.lost')}</Tag>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={t('screen.horse.runners.title')} id="hr-runners">
        <ul className="hr-runners">
          {runners.map((r, i) => (
            <li key={`${r.lane}-${r.name}-${i}`} className={`hr-runner${r.mine ? ' is-mine' : ''}`}>
              <div className="hr-runner__head">
                {r.lane > 0 ? <span className="hr-runner__lane">{r.lane}</span> : null}
                <SilksDot silks={r.silks} />
                <strong className="hr-runner__name">{r.name}</strong>
                {r.mine ? <Tag hue="green">{t('screen.horse.runner.you')}</Tag> : null}
                {r.npc ? <Tag hue="neutral">{t('screen.horse.runner.npc')}</Tag> : null}
                {r.form !== null ? (
                  <span className="hr-runner__form" title={t(`screen.horse.form.${r.form}`)}>
                    {r.form === 1 ? '◎' : r.form === -1 ? '△' : '○'}
                    <span className="hr-sr">{t(`screen.horse.form.${r.form}`)}</span>
                  </span>
                ) : null}
              </div>
              <p className="hr-muted hr-runner__record">
                {r.races === 0
                  ? t('screen.horse.runner.firstRun')
                  : t('screen.horse.runner.record', {
                      races: r.races,
                      wins: r.wins,
                      places: r.places,
                    })}
                {r.style ? ` · ${t(`screen.horse.style.${r.style}`)}` : ''}
              </p>
              {r.stats ? (
                <StatCells stats={r.stats} />
              ) : (
                <p className="hr-muted">{t('screen.horse.runner.hidden')}</p>
              )}
              {r.lane > 0 && odds.win?.[String(r.lane)] ? (
                <p className="hr-runner__odds">
                  {t('screen.horse.runner.winOdds', {
                    odds: formatOdds(odds.win[String(r.lane)] as number),
                  })}
                  {' · '}
                  {t('screen.horse.runner.placeOdds', {
                    odds: formatOdds(odds.place?.[String(r.lane)] ?? 10),
                  })}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="hr-muted">{t('screen.horse.formLegend')}</p>
      </Section>
    </div>
  );
}
