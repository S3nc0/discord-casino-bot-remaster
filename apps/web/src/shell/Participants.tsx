import type { PublicUser } from '@casino/shared';
import { useT } from './i18n.ts';
import { useRuntime } from './runtime.ts';
import { useSessionStore } from './stores/session.ts';

const MAX_SHOWN = 5;

/** Needs a Developer Portal mapping `/cdn` → Discord's CDN host (see report). */
export function avatarUrl(user: PublicUser, proxyPrefix: string): string | null {
  return user.avatar ? `${proxyPrefix}/cdn/avatars/${user.id}/${user.avatar}.png?size=64` : null;
}

export function Participants() {
  const t = useT();
  const { config } = useRuntime();
  const users = useSessionStore((s) => s.participants);
  if (users.length === 0) return null;
  const shown = users.slice(0, MAX_SHOWN);
  return (
    <ul className="participants" aria-label={t('shell.players')}>
      {shown.map((user) => {
        const name = user.globalName ?? user.username;
        const src = avatarUrl(user, config.proxyPrefix);
        return (
          <li key={user.id} className="participants__avatar" title={name}>
            {src ? (
              <img src={src} alt={name} width={28} height={28} />
            ) : (
              <span aria-label={name}>{name.slice(0, 1)}</span>
            )}
          </li>
        );
      })}
      {users.length > MAX_SHOWN ? (
        <li className="participants__more">+{users.length - MAX_SHOWN}</li>
      ) : null}
    </ul>
  );
}
