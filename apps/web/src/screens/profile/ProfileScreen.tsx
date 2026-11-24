import { avatarUrl, type FinanceDebtStatus, type ScreenId, type ShopKind } from '@casino/shared';
import { Button, GameIcon, PixelScene, Tag, type TagHue } from '@casino/ui';
import { formatPelica, screenName, useLocale, useT } from '../../shell/i18n.ts';
import { useRuntime } from '../../shell/runtime.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useNavStore } from '../../shell/stores/nav.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { useCasinoOptional } from '../casino/services.tsx';
import { useLifeApi } from '../life/api.tsx';
import { useLoad } from '../life/hooks.ts';
import { itemIcon, itemLabel } from '../life/items.ts';
import { PROFILE_CARD, PROFILE_PLACEHOLDER, PROFILE_SLOTS } from './profile-art.ts';
import './profile.css';

const SHORTCUTS: readonly ScreenId[] = ['inventory', 'history', 'relics', 'settings'];

const STATUS_HUE: Record<FinanceDebtStatus, TagHue> = {
  katagi: 'green',
  wealthy: 'yellow',
  underground: 'brown',
  bankrupt: 'red',
};

/** Shop kinds that are things to show off (not used up), in socket order. */
const COSMETIC: readonly ShopKind[] = [
  'title',
  'card_color',
  'card_icon',
  'skin_dice',
  'skin_table',
  'collection',
  'color_role',
];

/** Art pixels → CSS pixels on the card, which is drawn at 2×. */
const S = 2;
const box = (r: { x: number; y: number; w: number; h: number }) => ({
  left: r.x * S,
  top: r.y * S,
  width: r.w * S,
  height: r.h * S,
});

/** Who you are in this Activity: the player card, then the places that are about you. */
export default function ProfileScreen() {
  const t = useT();
  const locale = useLocale();
  const { config } = useRuntime();
  const user = useSessionStore((s) => s.user);
  const balance = useBalanceStore((s) => s.balance);
  const go = useNavStore((s) => s.go);
  const casino = useCasinoOptional()?.api ?? null;
  const life = useLifeApi();
  const daily = useLoad(() => casino?.daily() ?? Promise.resolve(null), 0, casino ? 'on' : 'off');
  const ranking = useLoad(() => life.ranking());
  const shop = useLoad(() => life.shop());
  const name = user ? (user.globalName ?? user.username) : '';
  const nf = new Intl.NumberFormat(locale);
  const streak = daily.data?.streak;
  const self = ranking.data?.self;
  const status = ranking.data?.selfStatus;
  const owned = (shop.data?.items ?? [])
    .filter((i) => i.owned > 0 && COSMETIC.includes(i.kind))
    .sort((a, b) => COSMETIC.indexOf(a.kind) - COSMETIC.indexOf(b.kind))
    .slice(0, PROFILE_SLOTS.sockets.length);
  const plaques = [
    {
      key: 'balance',
      label: t('shell.balance'),
      value: balance !== null ? formatPelica(locale, balance) : '—',
    },
    {
      key: 'streak',
      label: t('screen.profile.streak'),
      value: streak !== undefined ? t('screen.profile.days', { days: nf.format(streak) }) : '—',
    },
    {
      key: 'rank',
      label: t('screen.profile.rank'),
      value: self
        ? t('screen.profile.rankOf', { rank: nf.format(self.rank), total: nf.format(self.total) })
        : '—',
    },
  ];
  return (
    <section className="profile" data-screen="profile" aria-labelledby="profile-title">
      <div className="profile__head">
        <h1 id="profile-title" className="profile__title">
          {screenName(locale, 'profile')}
        </h1>
        {status ? (
          <Tag hue={STATUS_HUE[status]} className="profile__status" data-status={status}>
            {t(`status.badge.${status}`)}
          </Tag>
        ) : null}
      </div>
      <div className="profile-card">
        <PixelScene art={PROFILE_CARD} scale={S} className="profile-card__art" />
        <div className="profile-card__portrait" style={box(PROFILE_SLOTS.portrait)}>
          {user?.avatar ? (
            <img
              src={avatarUrl(user, { base: config.cdnBase, size: 128 })}
              alt=""
              width={PROFILE_SLOTS.portrait.w * S}
              height={PROFILE_SLOTS.portrait.h * S}
            />
          ) : (
            <PixelScene art={PROFILE_PLACEHOLDER} scale={S} />
          )}
        </div>
        <p className="profile-card__name" style={box(PROFILE_SLOTS.ribbon)}>
          {name}
        </p>
        <dl className="profile-card__plaques">
          {plaques.map((p, i) => {
            const slot = PROFILE_SLOTS.plaques[i];
            return slot ? (
              <div
                key={p.key}
                className="profile-card__plaque"
                style={box(slot)}
                data-plaque={p.key}
              >
                <dt>{p.label}</dt>
                <dd>{p.value}</dd>
              </div>
            ) : null;
          })}
        </dl>
        <ul className="profile-card__sockets" aria-label={t('screen.profile.owned')}>
          {owned.map((item, i) => {
            const slot = PROFILE_SLOTS.sockets[i];
            return slot ? (
              <li key={item.id} className="profile-card__socket" style={box(slot)}>
                <GameIcon
                  name={itemIcon(item.id)}
                  width={32}
                  height={32}
                  label={itemLabel(locale, item.id)}
                />
              </li>
            ) : null;
          })}
        </ul>
      </div>
      <p className="profile__owned">
        <strong>{t('screen.profile.owned')}</strong>
        {' · '}
        {owned.length > 0
          ? owned.map((item) => itemLabel(locale, item.id)).join(', ')
          : shop.data
            ? t('screen.profile.ownedNone')
            : '—'}
      </p>
      {shop.data?.colorRole ? (
        <p className="profile__owned" data-name-color={shop.data.colorRole}>
          <strong>{t('screen.profile.nameColor')}</strong>
          {' · '}
          {itemLabel(locale, shop.data.colorRole)}
        </p>
      ) : null}
      <div className="profile__links">
        {SHORTCUTS.map((id) => (
          <Button key={id} variant="tonal" onClick={() => go(id)}>
            {screenName(locale, id)}
          </Button>
        ))}
      </div>
    </section>
  );
}
