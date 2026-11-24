import { Card, GameIcon, Skyline, Sparkle, type GameIconName } from '@casino/ui';
import type { ScreenId } from '@casino/shared';
import { screenName, useLocale, useT } from './i18n.ts';
import { useBalanceStore } from './stores/balance.ts';
import { useNavStore } from './stores/nav.ts';
import { DailyBonus, FeaturedGame } from '../screens/casino/home.tsx';

type Tile = { screen: ScreenId; icon: GameIconName };

/** Home is the way in to every screen: one section per area, each tile opening its screen. */
export const HOME_SECTIONS: ReadonlyArray<{
  id: 'games' | 'life' | 'money' | 'you';
  titleKey: string;
  tiles: readonly Tile[];
}> = [
  {
    id: 'games',
    titleKey: 'home.games',
    tiles: [
      { screen: 'chinchiro', icon: 'dice' },
      { screen: 'slots', icon: 'slots' },
      { screen: 'blackjack', icon: 'cards' },
      { screen: 'roulette', icon: 'roulette' },
      { screen: 'pachinko', icon: 'pachinko' },
      { screen: 'horse', icon: 'horse' },
      { screen: 'arena', icon: 'sword' },
    ],
  },
  {
    id: 'life',
    titleKey: 'home.life',
    tiles: [
      { screen: 'work', icon: 'pickaxe' },
      { screen: 'shop', icon: 'shop' },
      { screen: 'missions', icon: 'missions' },
      { screen: 'ranking', icon: 'trophy' },
      { screen: 'transfer', icon: 'transfer' },
      { screen: 'quiz', icon: 'quiz' },
      { screen: 'lottery', icon: 'lottery' },
      { screen: 'poll', icon: 'poll' },
      { screen: 'stream', icon: 'stream' },
    ],
  },
  {
    id: 'money',
    titleKey: 'home.money',
    tiles: [
      { screen: 'market', icon: 'market' },
      { screen: 'stocks', icon: 'stocks' },
      { screen: 'crypto', icon: 'crypto' },
      { screen: 'bank', icon: 'bank' },
      { screen: 'loans', icon: 'loan' },
      { screen: 'kyosai', icon: 'shield' },
      { screen: 'companies', icon: 'company' },
    ],
  },
  {
    id: 'you',
    titleKey: 'home.you',
    tiles: [
      { screen: 'daily', icon: 'daily' },
      { screen: 'inventory', icon: 'inventory' },
      { screen: 'relics', icon: 'relic' },
      { screen: 'history', icon: 'history' },
      { screen: 'profile', icon: 'profile' },
    ],
  },
];

/** Balance hero under a pixel skyline, the daily bonus, then a grid of tiles per area. */
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
            <span className="home__amount num">
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
      {HOME_SECTIONS.map(({ id, titleKey, tiles }) => (
        <section key={id} className="home__games" aria-labelledby={`home-${id}`}>
          <h2 className="bb-eyebrow" id={`home-${id}`}>
            {t(titleKey)}
          </h2>
          <div className="home__tiles">
            {tiles.map(({ screen, icon }) => (
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
      ))}
      <FeaturedGame />
    </div>
  );
}
