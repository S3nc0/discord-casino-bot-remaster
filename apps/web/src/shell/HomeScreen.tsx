import { Card, GameIcon, Skyline, Sparkle, type GameIconName } from '@casino/ui';
import type { ScreenId } from '@casino/shared';
import { screenName, useLocale, useT } from './i18n.ts';
import { useBalanceStore } from './stores/balance.ts';
import { useNavStore } from './stores/nav.ts';
import { DailyBonus, FeaturedGame } from '../screens/casino/home.tsx';

/** The four tiles on Home, each opening its game screen. */
export const HOME_TILES: ReadonlyArray<{ screen: ScreenId; icon: GameIconName }> = [
  { screen: 'chinchiro', icon: 'dice' },
  { screen: 'slots', icon: 'slots' },
  { screen: 'blackjack', icon: 'cards' },
  { screen: 'horse', icon: 'horse' },
];

/** Balance hero under a pixel skyline, then the 4-up game tiles. */
export function HomeScreen() {
  const t = useT();
  const locale = useLocale();
  const balance = useBalanceStore((s) => s.balance);
  const go = useNavStore((s) => s.go);
  return (
    <div className="home">
      <Card variant="elevated" className="home__hero" media={<Skyline />}>
        <div className="home__body">
          <h1 className="bb-eyebrow home__eyebrow">{t('shell.balance')}</h1>
          <p className="home__balance">
            <span className="home__amount">
              {balance !== null ? new Intl.NumberFormat(locale).format(balance) : '—'}
            </span>
            <span className="home__unit">{t('currency.name')}</span>
          </p>
        </div>
        <div className="home__art" aria-hidden="true">
          <GameIcon name="dice" className="home__die" />
          <GameIcon name="coin" bob className="home__coin" />
          <Sparkle className="home__spark home__spark--a" />
          <Sparkle className="home__spark home__spark--b" />
        </div>
      </Card>
      <DailyBonus />
      <section className="home__games" aria-labelledby="home-games">
        <h2 className="bb-eyebrow" id="home-games">
          {t('home.games')}
        </h2>
        <div className="home__tiles">
          {HOME_TILES.map(({ screen, icon }) => (
            <button
              key={screen}
              type="button"
              className="bb-card bb-game bb-state"
              onClick={() => go(screen)}
            >
              <GameIcon name={icon} />
              <span>{screenName(locale, screen)}</span>
            </button>
          ))}
        </div>
      </section>
      <FeaturedGame />
    </div>
  );
}
