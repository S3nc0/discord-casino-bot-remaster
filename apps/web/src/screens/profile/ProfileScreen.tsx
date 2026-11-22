import { avatarUrl, type ScreenId } from '@casino/shared';
import { Avatar, Button, Card } from '@casino/ui';
import { formatPelica, screenName, useLocale, useT } from '../../shell/i18n.ts';
import { useRuntime } from '../../shell/runtime.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useNavStore } from '../../shell/stores/nav.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import './profile.css';

const SHORTCUTS: readonly ScreenId[] = ['inventory', 'history', 'relics', 'settings'];

/** Who you are in this Activity: avatar, name, balance and the places that are about you. */
export default function ProfileScreen() {
  const t = useT();
  const locale = useLocale();
  const { config } = useRuntime();
  const user = useSessionStore((s) => s.user);
  const balance = useBalanceStore((s) => s.balance);
  const go = useNavStore((s) => s.go);
  const name = user ? (user.globalName ?? user.username) : '';
  return (
    <section className="profile" data-screen="profile" aria-labelledby="profile-title">
      <h1 id="profile-title" className="profile__title">
        {screenName(locale, 'profile')}
      </h1>
      <Card variant="elevated">
        <div className="profile__who">
          {user ? (
            <Avatar>
              <img
                src={avatarUrl(user, { base: config.cdnBase, size: 128 })}
                alt=""
                width={48}
                height={48}
              />
            </Avatar>
          ) : null}
          <div>
            <p className="profile__name">{name}</p>
            <p className="profile__balance">
              {t('shell.balance')}: {balance !== null ? formatPelica(locale, balance) : '—'}
            </p>
          </div>
        </div>
      </Card>
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
