import type {
  Clock,
  LaunchIntentService,
  PublicUser,
  TokenRequest,
  TokenResponse,
} from '@casino/shared';
import { resolveLocale } from '@casino/shared/i18n';
import type { Logger } from 'pino';
import type { IdentityRepo } from '../db/identity.ts';
import type { Store } from '../db/store.ts';
import type { EconomyService } from '../economy/economy-service.ts';
import { AppError } from '../runtime/errors.ts';
import { DiscordApiError, type DiscordApi } from './discord.ts';
import type { SessionService } from './sessions.ts';

export interface TokenFlowOptions {
  discord: DiscordApi;
  store: Store;
  identity: IdentityRepo;
  economy: EconomyService;
  sessions: SessionService;
  launchIntents: LaunchIntentService;
  allowedGuildIds: ReadonlySet<string>;
  requireApproval: boolean;
  clock: Clock;
  logger: Logger;
}

/**
 * `POST /api/token`. Nothing in the request is trusted as given: the guild must be one the
 * user is in and one we allow (and approve), the instance must be a live Activity instance of
 * that guild with this user in it. Only then is anything written.
 */
export class TokenFlow {
  private readonly o: TokenFlowOptions;

  constructor(options: TokenFlowOptions) {
    this.o = options;
  }

  async exchange(request: TokenRequest): Promise<TokenResponse> {
    const { discord, identity, store } = this.o;

    let accessToken: string;
    let user;
    let guilds;
    let instance;
    try {
      accessToken = await discord.exchangeCode(request.code);
      user = await discord.getUser(accessToken);
      guilds = await discord.getUserGuilds(accessToken);
    } catch (error) {
      throw this.fromDiscord(error);
    }

    const guild = guilds.find((g) => g.id === request.guildId);
    if (!guild) throw new AppError('forbidden', { message: 'user is not in this guild' });
    if (!this.o.allowedGuildIds.has(request.guildId)) throw new AppError('guild_not_allowed');

    try {
      instance = await discord.getActivityInstance(request.instanceId);
    } catch (error) {
      throw this.fromDiscord(error);
    }
    if (!instance || instance.guildId !== request.guildId || !instance.userIds.includes(user.id)) {
      throw new AppError('forbidden', {
        message: 'not a live instance of this guild with this user',
      });
    }

    // The guild row is recorded even when it still waits for approval, so the owner can see it.
    identity.ensureGuild(
      request.guildId,
      this.o.requireApproval ? 'pending' : 'approved',
      guild.name,
    );
    if (guild.name) identity.setGuildName(request.guildId, guild.name);
    let status = identity.getGuildStatus(request.guildId);
    if (status === 'pending' && !this.o.requireApproval) {
      identity.setGuildStatus(request.guildId, 'approved');
      status = 'approved';
    }
    if (status === 'denied') throw new AppError('guild_not_allowed');
    if (status !== 'approved') throw new AppError('guild_pending');

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

  private fromDiscord(error: unknown): AppError {
    if (error instanceof DiscordApiError) {
      this.o.logger.warn({ kind: error.kind, status: error.status }, 'discord call failed');
      return error.kind === 'rejected'
        ? new AppError('unauthorized', { message: 'discord rejected the code' })
        : new AppError('internal', { status: 502, message: 'discord unavailable' });
    }
    throw error;
  }
}
