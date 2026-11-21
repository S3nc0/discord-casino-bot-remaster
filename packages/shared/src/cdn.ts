/**
 * Discord CDN access from inside the Activity. The Activity's CSP only allows its own origin,
 * so avatars go through a Developer Portal URL mapping:
 * `/discord-cdn` → `cdn.discordapp.com`. Inside Discord the browser path is
 * `/.proxy/discord-cdn/...`; outside Discord (local dev in a browser) it is the CDN origin.
 */
export const DISCORD_CDN_ORIGIN = 'https://cdn.discordapp.com';
export const DISCORD_CDN_PREFIX = '/discord-cdn';

/** Every URL mapping besides `/` and `/api`, in the shape `patchUrlMappings` takes. */
export const DISCORD_URL_MAPPINGS = [
  { prefix: DISCORD_CDN_PREFIX, target: 'cdn.discordapp.com' },
] as const;

/** Sizes the CDN serves (powers of two). */
export const AVATAR_SIZES = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

export interface AvatarUrlOptions {
  /**
   * Where CDN paths are served from. Default `DISCORD_CDN_ORIGIN`; inside Discord pass
   * `/.proxy` + `DISCORD_CDN_PREFIX` (i.e. `/.proxy/discord-cdn`).
   */
  base?: string;
  size?: AvatarSize;
}

/**
 * URL of a user's avatar, or of their default avatar when `avatar` is null.
 * Animated hashes (`a_...`) get a GIF; everything else a PNG.
 */
export function avatarUrl(
  user: { id: string; avatar: string | null },
  options: AvatarUrlOptions = {},
): string {
  const base = options.base ?? DISCORD_CDN_ORIGIN;
  const size = options.size ?? 128;
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `${base}/avatars/${user.id}/${user.avatar}.${ext}?size=${size}`;
  }
  return `${base}/embed/avatars/${defaultAvatarIndex(user.id)}.png`;
}

/** Default avatar index for the username system (no discriminator): `(id >> 22) % 6`. */
export function defaultAvatarIndex(userId: string): number {
  if (!/^[0-9]{1,20}$/.test(userId)) return 0;
  return Number((BigInt(userId) >> 22n) % 6n);
}
