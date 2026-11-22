import type { CSSProperties, ReactNode } from 'react';
import { Banner } from '@casino/ui';
import type { HorseRules, HorseStats } from '@casino/shared';
import { HORSE_STATS } from '@casino/shared';
import { useT } from '../../shell/i18n.ts';
import { useErrorText } from './hooks.ts';
import { silksColor } from './format.ts';

export function SilksDot({ silks }: { silks: string }) {
  return (
    <span
      className="hr-silks"
      aria-hidden="true"
      style={{ '--hr-silks': silksColor(silks) } as CSSProperties}
    />
  );
}

/** Four stats as bars on the 20..80 scale. */
export function StatBars({ stats, name }: { stats: HorseStats; name: string }) {
  const t = useT();
  return (
    <dl className="hr-stats" aria-label={t('screen.horse.horse.statsLabel', { name })}>
      {HORSE_STATS.map((key) => (
        <div className="hr-stats__row" key={key}>
          <dt>{t(`screen.horse.stat.${key}`)}</dt>
          <dd>
            <span className="hr-stats__bar" aria-hidden="true">
              <span
                className="hr-stats__fill"
                style={{ width: `${Math.max(0, Math.min(100, ((stats[key] - 20) / 60) * 100))}%` }}
              />
            </span>
            <span className="hr-stats__num">{stats[key]}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The same four stats as small cells (race card rows). */
export function StatCells({ stats }: { stats: HorseStats }) {
  const t = useT();
  return (
    <dl className="hr-cells">
      {HORSE_STATS.map((key) => (
        <div key={key}>
          <dt>{t(`screen.horse.stat.${key}`)}</dt>
          <dd>{stats[key]}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A refusal as a banner; nothing when there is no error. */
export function ErrorNote({
  error,
  rules,
}: {
  error: unknown;
  rules?: Pick<HorseRules, 'breedMinRaces' | 'maxFoals' | 'maxHorses' | 'nameMax'> | null;
}) {
  const text = useErrorText(error, rules);
  if (!text) return null;
  return <Banner variant="error" title={text} role="alert" className="hr-note" />;
}

export function Section({
  title,
  id,
  children,
  aside,
}: {
  title: string;
  id: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="hr-section" aria-labelledby={id}>
      <div className="hr-section__head">
        <h2 id={id} className="bb-eyebrow">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Loading() {
  const t = useT();
  return (
    <p className="hr-muted" role="status">
      {t('common.loading')}
    </p>
  );
}

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <Banner variant="error" title={t('screen.horse.loadFailed')} role="alert">
      <button type="button" className="bb-btn bb-btn--text bb-state" onClick={onRetry}>
        {t('screen.horse.retry')}
      </button>
    </Banner>
  );
}
