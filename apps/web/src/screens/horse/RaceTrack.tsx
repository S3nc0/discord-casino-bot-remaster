import type { HorseTimeline } from '@casino/shared';
import { PixelScene, PixelTile, useSceneFrame } from '@casino/ui';
import { useT } from '../../shell/i18n.ts';
import { PixelHorse } from './PixelHorse.tsx';
import {
  RACE_DUST,
  RACE_GATE,
  RACE_LANE,
  RACE_LANE_DARK,
  RACE_RAIL,
  RACE_STAND,
} from './race-art.ts';

export interface RaceTrackProps {
  timeline: HorseTimeline;
  /** Ticks shown so far (0 = at the gate, frames.length = the finish). */
  tick: number;
  playing: boolean;
  /** Silks and coats by lane, taken from the race detail. */
  coats: Readonly<Record<number, string>>;
}

/** Positions (milli, 0..1000) of every runner after `tick` ticks. */
export function positionsAt(timeline: HorseTimeline, tick: number): number[] {
  if (tick <= 0) return timeline.runners.map(() => 0);
  const frame = timeline.frames[Math.min(tick, timeline.frames.length) - 1];
  return frame ?? timeline.runners.map(() => 1000);
}

/** Runner index in front (ties: the lower lane). */
export function leaderIndex(positions: readonly number[]): number {
  let best = 0;
  positions.forEach((p, i) => {
    if (p > (positions[best] ?? 0)) best = i;
  });
  return best;
}

/** The commentary line key and its params for the moment shown. */
export function commentary(timeline: HorseTimeline, tick: number): { key: string; name: string } {
  const positions = positionsAt(timeline, tick);
  const leader = leaderIndex(positions);
  const name = timeline.runners[leader]?.name ?? '';
  const winner = timeline.runners.find((r) => r.lane === timeline.placings[0])?.name ?? name;
  if (tick <= 0) return { key: 'screen.horse.live.start', name };
  if (tick >= timeline.frames.length) return { key: 'screen.horse.live.goal', name: winner };
  if ((positions[leader] ?? 0) >= 700) return { key: 'screen.horse.live.stretch', name };
  return { key: 'screen.horse.live.lead', name };
}

/**
 * Eight lanes, a pixel horse in each, moving in steps along the track. Behind them: the grandstand
 * and the finish post, turf with mowing stripes, the inner rail; the starting gate stands in each
 * lane until the off, and dust flies behind a running horse (not under reduced motion).
 */
export function RaceTrack({ timeline, tick, playing, coats }: RaceTrackProps) {
  const t = useT();
  const positions = positionsAt(timeline, tick);
  const leader = leaderIndex(positions);
  const line = commentary(timeline, tick);
  const percent = Math.round(((positions[leader] ?? 0) / 1000) * 100);
  const dust = useSceneFrame(RACE_DUST.frames.length, 90, playing);
  return (
    <div className="hr-track" role="group" aria-label={t('screen.horse.live.title')}>
      <p className="hr-track__line" role="status" aria-live="polite">
        {t(line.key, { name: line.name })}
      </p>
      <div
        className="hr-track__bar"
        role="progressbar"
        aria-label={t('screen.horse.live.progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className="hr-track__fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="hr-track__stand" aria-hidden="true">
        <PixelScene art={RACE_STAND} />
      </div>
      <ol className="hr-lanes">
        {timeline.runners.map((runner, i) => (
          <li
            key={runner.lane}
            className={`hr-lane${runner.mine ? ' is-mine' : ''}${i === leader && tick > 0 ? ' is-leader' : ''}`}
          >
            <PixelTile art={i % 2 ? RACE_LANE_DARK : RACE_LANE} className="hr-lane__turf" />
            <span className="hr-lane__no">{runner.lane}</span>
            <span className="hr-lane__course">
              {tick <= 0 ? <PixelScene art={RACE_GATE} className="hr-lane__gate" /> : null}
              <span
                className="hr-lane__runner"
                style={{ '--p': positions[i] ?? 0 } as React.CSSProperties}
              >
                {playing && tick > 0 && (positions[i] ?? 0) < 1000 ? (
                  <PixelScene
                    art={RACE_DUST}
                    frame={(dust + i) % RACE_DUST.frames.length}
                    className="hr-lane__dust"
                  />
                ) : null}
                <PixelHorse
                  coat={coats[runner.lane] ?? ''}
                  silks={runner.silks}
                  running={playing && (positions[i] ?? 0) < 1000}
                  phase={runner.lane * 3}
                />
              </span>
              <span className="hr-lane__finish" aria-hidden="true" />
            </span>
            <span className="hr-lane__name">{runner.name}</span>
          </li>
        ))}
      </ol>
      <div className="hr-track__rail" aria-hidden="true">
        <PixelTile art={RACE_RAIL} />
      </div>
    </div>
  );
}
