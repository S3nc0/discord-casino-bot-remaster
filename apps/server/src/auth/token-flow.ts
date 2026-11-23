import type {
  Clock,
  LaunchIntentService,
  PublicUser,
  TokenRequest,
  TokenResponse,
} from '@casino/shared';
import { REQUIRED_SERVER_SCOPES } from '@casino/shared';
import { resolveLocale } from '@casino/shared/i18n';
import type { Logger } from 'pino';
import type { IdentityRepo } from '../db/identity.ts';
import type { Store } from '../db/store.ts';
import type { EconomyService } from '../economy/economy-service.ts';
import { AppError } from '../runtime/errors.ts';
import { DiscordApiError, type DiscordApi } from './discord.ts';
import { REASONS, discordStepReason } from './reasons.ts';
import type { SessionService } from './sessions.ts';

export interface TokenFlowOptions {
  discord: DiscordApi;
  store: Store;
  identity: IdentityRepo;
  economy: EconomyService;
  sessions: SessionService;
  launchIntents: LaunchIntentService;
  allowedGuildIds: ReadonlySet<string>;
  clock: Clock;
  logger: Logger;
}

/**
 * `POST /api/token`. Nothing in the request is trusted as given: the guild must be one the
 * user is in and one the owner approved (ALLOWED_GUILD_IDS, or `approved` in the database), the instance must be a live Activity instance of
 * that guild with this user in it. Only then is anything written.
 */
export class TokenFlow {
  private readonly o: TokenFlowOptions;

  constructor(options: TokenFlowOptions) {
    this.o = options;
  }

  async exchange(request: TokenRequest): Promise<TokenResponse> {
    const { discord, identity, store } = this.o;

    const grant = await this.step('code_exchange', () => discord.exchangeCode(request.code));
    const accessToken = grant.accessToken;
    // Extra scopes (such as rpc.activities.write for rich presence) are fine; the ones this
    // flow reads with must be there.
    if (grant.scopes && !REQUIRED_SERVER_SCOPES.every((scope) => grant.scopes?.includes(scope))) {
      throw new AppError('forbidden', {
        message: 'authorization is missing a required scope',
        reason: REASONS.scopeMissing,
      });
    }
    const user = await this.step('user_fetch', () => discord.getUser(accessToken));
    const guilds = await this.step('guilds_fetch', () => discord.getUserGuilds(accessToken));

    const guild = guilds.find((g) => g.id === request.guildId);
    if (!guild) {
      throw new AppError('forbidden', {
        message: 'user is not in this guild',
        reason: REASONS.userNotInGuild,
      });
    }
    // The owner's list in ALLOWED_GUILD_IDS, or a guild approved with `/admin server-allow`
    // (the bot already honours both). A pending or denied guild outside the list never signs in.
    if (
      !this.o.allowedGuildIds.has(request.guildId) &&
      identity.getGuildStatus(request.guildId) !== 'approved'
    ) {
      throw new AppError('guild_not_allowed', { reason: REASONS.guildNotAllowed });
    }

    const instance = await this.step('instance_fetch', () =>
      discord.getActivityInstance(request.instanceId),
    );
    if (!instance || instance.guildId !== request.guildId || !instance.userIds.includes(user.id)) {
      throw new AppError('forbidden', {
        message: 'not a live instance of this guild with this user',
        reason: REASONS.instanceMismatch,
      });
    }

    // A guild in ALLOWED_GUILD_IDS (checked above) is approved: the owner chose it explicitly,
    // so a `pending` row (made here on first sight, or by `ensureMember`) never blocks it.
    // Only an explicit `denied` decision is honoured.
    identity.ensureGuild(request.guildId, 'approved', guild.name);
    if (guild.name) identity.setGuildName(request.guildId, guild.name);
    const status = identity.getGuildStatus(request.guildId);
    if (status === 'denied')
      throw new AppError('guild_not_allowed', { reason: REASONS.guildDenied });
    if (status !== 'approved') identity.setGuildStatus(request.guildId, 'approved');

    // Everything below commits together: the member and its start balance, and the intent.
    const result = store.transaction(() => {
      identity.upsertUser({
        userId: user.id,
        username: user.username,
        globalName: user.globalName,
        avatar: user.avatar,
      });
      this.o.economy.ensureMember(request.guildId, user.id);
      const locale = resolveLocale({
        user: identity.getUserLocale(user.id),
        client: request.clientLocale,
        guild: identity.getGuildLocale(request.guildId),
      });
      const launchIntent = this.o.launchIntents.consume(user.id, request.guildId);
      return { locale, launchIntent };
    });

    const session = this.o.sessions.issue({
      userId: user.id,
      guildId: request.guildId,
      instanceId: request.instanceId,
      locale: result.locale,
    });
    const publicUser: PublicUser = {
      id: user.id,
      username: user.username,
      globalName: user.globalName,
      avatar: user.avatar,
    };
    return {
      accessToken,
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      user: publicUser,
      guildId: request.guildId,
      locale: result.locale,
      launchIntent: result.launchIntent,
    };
  }

  /** Runs one Discord call; a failure becomes an AppError that names the step and status. */
  private async step<T>(name: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof DiscordApiError)) throw error;
      const reason = discordStepReason(name, error.status);
      this.o.logger.warn(
        { reason, kind: error.kind, status: error.status },
        `discord call failed: ${reason}`,
      );
      if (error.kind === 'rejected') {
        throw new AppError('unauthorized', { message: 'discord rejected the request', reason });
      }
      throw new AppError('internal', { status: 502, message: 'discord unavailable', reason });
    }
  }
}
