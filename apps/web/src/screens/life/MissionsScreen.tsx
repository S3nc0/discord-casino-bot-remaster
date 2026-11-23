import { Banner, Card, Progress, Tag } from '@casino/ui';
import type { MissionItem } from '@casino/shared';
import { formatPelica, useLocale, useT, type Translate } from '../../shell/i18n.ts';
import { useLifeApi } from './api.tsx';
import { formatDuration } from './format.ts';
import { useLoad, useNow } from './hooks.ts';
import { Await, LifeFrame } from './ui.tsx';

/** The mission's sentence: by kind, with its game or tag filled in. */
export function missionText(
  t: Translate,
  m: Pick<MissionItem, 'kind' | 'target' | 'game' | 'tag'>,
) {
  const target = new Intl.NumberFormat('en-US').format(m.target);
  if (m.kind === 'tag' && m.tag) return t(`screen.life.missions.tag.${m.tag}`);
  const game = m.game ? t(`screen.${m.game}`) : '';
  return t(`screen.life.missions.kind.${m.kind}`, { target, game });
}

export default function MissionsScreen() {
  const t = useT();
  const locale = useLocale();
  const api = useLifeApi();
  const state = useLoad(() => api.missions(), 30_000);
  const now = useNow(1000);
  return (
    <LifeFrame screen="missions" icon="missions">
      <Await state={state}>
        {(v) => {
          const allDone = v.missions.every((m) => m.done);
          return (
            <>
              {allDone ? (
                <Banner variant="success" title={t('screen.life.missions.allDone')}>
                  {t('screen.life.missions.bonus', { bonus: formatPelica(locale, v.bonus) })}
                </Banner>
              ) : null}
              <ul className="life__list" aria-label={t('screen.life.missions.title')}>
                {v.missions.map((m) => (
                  <li key={m.id}>
                    <Card variant="filled" className="life-mission" data-done={m.done}>
                      <div className="life-mission__top">
                        <span className="life-mission__text">{missionText(t, m)}</span>
                        {m.done ? (
                          <Tag hue="green">{t('screen.life.missions.done')}</Tag>
                        ) : (
                          <Tag hue="yellow">
                            {t('screen.life.missions.reward', {
                              reward: new Intl.NumberFormat(locale).format(m.reward),
                            })}
                          </Tag>
                        )}
                      </div>
                      <Progress
                        label={missionText(t, m)}
                        value={m.progress}
                        max={m.target}
                        valueLabel={`${new Intl.NumberFormat(locale).format(m.progress)} / ${new Intl.NumberFormat(locale).format(m.target)}`}
                        variant={m.done ? 'success' : 'primary'}
                      />
                    </Card>
                  </li>
                ))}
              </ul>
              {!allDone ? (
                <p className="life__note">
                  {t('screen.life.missions.bonus', { bonus: formatPelica(locale, v.bonus) })}
                </p>
              ) : null}
              <p className="life__note">{t('screen.life.missions.auto')}</p>
              <p className="life__note">{t('screen.life.missions.minBet', { min: v.minBet })}</p>
              <p className="life__note">
                {t('screen.life.missions.streak', { win: v.winStreak, best: v.bestStreak })}
              </p>
              <p className="life__note">
                {t('screen.life.missions.reset', { time: formatDuration(t, v.resetAt - now) })}
              </p>
            </>
          );
        }}
      </Await>
    </LifeFrame>
  );
}
