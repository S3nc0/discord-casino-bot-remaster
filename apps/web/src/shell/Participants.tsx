import { avatarUrl } from '@casino/shared';
import { Avatar } from '@casino/ui';
import { useT } from './i18n.ts';
import { useRuntime } from './runtime.ts';
import { useSessionStore } from './stores/session.ts';

const MAX_SHOWN = 5;

/** Avatars of the people in this Activity instance (SDK list, or the socket's as fallback). */
export function Participants() {
  const t = useT();
  const { config } = useRuntime();
  const users = useSessionStore((s) => s.participants);
  if (users.length === 0) return null;
  return (
    <ul className="participants" aria-label={t('shell.players')}>
      {users.slice(0, MAX_SHOWN).map((user) => {
        const name = user.globalName ?? user.username;
        return (
          <li key={user.id} className="participants__item">
            <Avatar>
              <img
                src={avatarUrl(user, { base: config.cdnBase, size: 64 })}
                alt={name}
                title={name}
                width={40}
                height={40}
              />
            </Avatar>
          </li>
        );
      })}
      {users.length > MAX_SHOWN ? (
        <li className="participants__more">+{users.length - MAX_SHOWN}</li>
      ) : null}
    </ul>
  );
}
