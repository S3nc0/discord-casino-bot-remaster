import type { ReactNode } from 'react';
import {
  Banner,
  Button,
  Chip,
  ChipGroup,
  GameIcon,
  ScrollFade,
  type GameIconName,
} from '@casino/ui';
import type { ScreenId } from '@casino/shared';
import { screenName, useLocale, useT } from '../../shell/i18n.ts';
import { useNavStore } from '../../shell/stores/nav.ts';
import { errorMessage, type Loaded } from './hooks.ts';
import './life.css';

/** The life screens, reachable from one another. */
export const LIFE_SCREENS: ReadonlyArray<{ id: ScreenId; icon: GameIconName }> = [
  { id: 'work', icon: 'pickaxe' },
  { id: 'relics', icon: 'gem' },
  { id: 'shop', icon: 'coin' },
  { id: 'inventory', icon: 'gem' },
  { id: 'missions', icon: 'sword' },
  { id: 'ranking', icon: 'stocks' },
  { id: 'transfer', icon: 'coin' },
  { id: 'quiz', icon: 'cards' },
  { id: 'lottery', icon: 'roulette' },
  { id: 'poll', icon: 'dice' },
];

export function LifeNav({ current }: { current: ScreenId }) {
  const t = useT();
  const locale = useLocale();
  const go = useNavStore((s) => s.go);
  return (
    <ScrollFade className="life__nav" revealSelector='[aria-pressed="true"]'>
      <ChipGroup label={t('screen.life.nav')}>
        {LIFE_SCREENS.map(({ id }) => (
          <Chip key={id} selected={id === current} onClick={() => go(id)}>
            {screenName(locale, id)}
          </Chip>
        ))}
      </ChipGroup>
    </ScrollFade>
  );
}

/** Title, the link strip and the body of one life screen. */
export function LifeFrame({
  screen,
  icon,
  children,
}: {
  screen: ScreenId;
  icon: GameIconName;
  children: ReactNode;
}) {
  const locale = useLocale();
  return (
    <section className="life" data-screen={screen} aria-labelledby={`life-${screen}-title`}>
      <header className="life__head">
        <GameIcon name={icon} className="life__icon" />
        <h1 id={`life-${screen}-title`} className="life__title">
          {screenName(locale, screen)}
        </h1>
      </header>
      <LifeNav current={screen} />
      {children}
    </section>
  );
}

/** Loading, failure with a retry button, or the loaded body. */
export function Await<T>({
  state,
  children,
}: {
  state: Loaded<T>;
  children: (data: T) => ReactNode;
}) {
  const t = useT();
  if (state.data !== null) return <>{children(state.data)}</>;
  if (state.error !== null && !state.loading) {
    const { key, params } = errorMessage(state.error);
    return (
      <Banner variant="error" title={t('screen.life.loadError')}>
        <p>{t(key, params)}</p>
        <Button variant="tonal" onClick={() => void state.reload()}>
          {t('screen.life.retry')}
        </Button>
      </Banner>
    );
  }
  return (
    <p className="life__loading" role="status">
      {t('screen.life.loading')}
    </p>
  );
}

/** A labelled number: `Waiting to collect` over `1,200`. */
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'coin' }) {
  return (
    <div className="life-stat">
      <span className="life-stat__label">{label}</span>
      <span
        className={tone === 'coin' ? 'life-stat__value life-stat__value--coin' : 'life-stat__value'}
      >
        {value}
      </span>
    </div>
  );
}
