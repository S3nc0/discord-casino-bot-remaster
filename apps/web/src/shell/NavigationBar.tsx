import { NavigationBar } from '@casino/ui';
import type { ScreenId } from '@casino/shared';
import { isScreenId } from '@casino/shared';
import { NavIcon } from './icons.tsx';
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
export function MainNavigation() {
  const t = useT();
  const locale = useLocale();
  const screen = useNavStore((s) => s.screen);
  const go = useNavStore((s) => s.go);
  const unread = useInboxStore(selectUnread);
  const items = NAV_SCREENS.map((id) => ({
    id,
    label: screenName(locale, id),
    icon: <NavIcon screen={id} />,
    ...(id === 'inbox' && unread > 0
      ? { badge: unread, badgeLabel: `${t('inbox.unread')}: ${unread}` }
      : {}),
  }));
  return (
    <NavigationBar
      className="shell-nav"
      label={t('shell.nav')}
      items={items}
      activeId={screen}
      onSelect={(id) => {
        if (isScreenId(id)) go(id);
      }}
    />
  );
}
