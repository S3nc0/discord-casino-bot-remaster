import type { ScreenId } from '@casino/shared';
import { screenName, useLocale, useT } from './i18n.ts';
import { selectUnread, useInboxStore } from './stores/inbox.ts';
import { useNavStore } from './stores/nav.ts';

export const NAV_SCREENS: readonly ScreenId[] = [
  'home',
  'missions',
  'ranking',
  'inbox',
  'settings',
];

/** Bottom bar on a phone held upright, side rail otherwise (CSS decides from `data-layout`). */
export function NavigationBar() {
  const t = useT();
  const locale = useLocale();
  const screen = useNavStore((s) => s.screen);
  const go = useNavStore((s) => s.go);
  const unread = useInboxStore(selectUnread);
  return (
    <nav className="nav" aria-label={t('shell.nav')}>
      <ul className="nav__list">
        {NAV_SCREENS.map((id) => (
          <li key={id}>
            <button
              type="button"
              className="nav__item"
              aria-current={screen === id ? 'page' : undefined}
              onClick={() => go(id)}
            >
              <span className="nav__label">{screenName(locale, id)}</span>
              {id === 'inbox' && unread > 0 ? (
                <span
                  className="nav__badge"
                  role="img"
                  aria-label={`${t('inbox.unread')}: ${unread}`}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
