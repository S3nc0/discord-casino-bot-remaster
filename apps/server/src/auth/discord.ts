import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';

// ---- injectable HTTP client: tests never reach the network ----

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  /** Sent as `application/x-www-form-urlencoded`. */
  form?: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  /** Parsed JSON, or `undefined` when the body was not JSON. */
  body: unknown;
}

export interface HttpClient {
  request(request: HttpRequest): Promise<HttpResponse>;
}

/** Production client on the global `fetch`, with a timeout. */
export function createFetchClient(timeoutMs = 8000): HttpClient {
  return {
    async request(request) {
      const headers = { ...request.headers };
      let body: string | undefined;
      if (request.form) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(request.form).toString();
      }
      const response = await fetch(request.url, {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        json = undefined;
      }
      return { status: response.status, body: json };
    },
  };
}

// ---- Discord REST ----

/**
 * `rejected`: Discord answered and said no (bad code, revoked token, unknown instance).
 * `unavailable`: network error, timeout, 429/5xx or an answer we cannot read.
 */
export class DiscordApiError extends Error {
  readonly kind: 'rejected' | 'unavailable';
  readonly status: number | undefined;

  constructor(kind: 'rejected' | 'unavailable', message: string, status?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DiscordApiError';
    this.kind = kind;
    this.status = status;
  }
}

const OAuthToken = Type.Object({ access_token: Type.String({ minLength: 1 }) });
const DiscordUser = Type.Object({
  id: Type.String({ pattern: '^[0-9]{17,20}$' }),
  username: Type.String(),
  global_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  avatar: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
const DiscordGuilds = Type.Array(
  Type.Object({
    id: Type.String({ pattern: '^[0-9]{17,20}$' }),
    name: Type.Optional(Type.String()),
  }),
);
const ActivityInstance = Type.Object({
  instance_id: Type.String(),
  location: Type.Object({ guild_id: Type.Optional(Type.Union([Type.String(), Type.Null()])) }),
  users: Type.Array(Type.String()),
});

export interface DiscordUserInfo {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

export interface DiscordGuildInfo {
  id: string;
  name: string | null;
}

export interface ActivityInstanceInfo {
  instanceId: string;
  guildId: string | null;
  userIds: string[];
}

const GUILD_PAGE = 200;
const MAX_GUILD_PAGES = 10;

export interface DiscordApiOptions {
  http: HttpClient;
  clientId: string;
  clientSecret: string;
  botToken: string;
  baseUrl?: string;
}

/** The few Discord REST calls the auth flow needs. */
export class DiscordApi {
  private readonly http: HttpClient;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly botToken: string;
  private readonly baseUrl: string;

  constructor(options: DiscordApiOptions) {
    this.http = options.http;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.botToken = options.botToken;
    this.baseUrl = options.baseUrl ?? 'https://discord.com/api/v10';
  }

  /** OAuth2 code → access token (the Activity flow has no redirect URI). */
  async exchangeCode(code: string): Promise<string> {
    const response = await this.call({
      method: 'POST',
      url: `${this.baseUrl}/oauth2/token`,
      form: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
      },
    });
    return this.parse(OAuthToken, response, 'token exchange').access_token;
  }

  async getUser(accessToken: string): Promise<DiscordUserInfo> {
    const response = await this.call({
      method: 'GET',
      url: `${this.baseUrl}/users/@me`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const user = this.parse(DiscordUser, response, 'user');
    return {
      id: user.id,
      username: user.username,
      globalName: user.global_name ?? null,
      avatar: user.avatar ?? null,
    };
  }

  /** The user's guilds, paged by id until a short page. */
  async getUserGuilds(accessToken: string): Promise<DiscordGuildInfo[]> {
    const guilds: DiscordGuildInfo[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_GUILD_PAGES; page++) {
      const query = `limit=${GUILD_PAGE}${after === undefined ? '' : `&after=${after}`}`;
      const response = await this.call({
        method: 'GET',
        url: `${this.baseUrl}/users/@me/guilds?${query}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const batch = this.parse(DiscordGuilds, response, 'guilds');
      for (const guild of batch) guilds.push({ id: guild.id, name: guild.name ?? null });
      if (batch.length < GUILD_PAGE) break;
      after = batch.reduce(
        (max, g) => (BigInt(g.id) > BigInt(max) ? g.id : max),
        batch[0]?.id ?? '0',
      );
    }
    return guilds;
  }

  /** Live Activity instance, or null when Discord does not know it (never started or ended). */
  async getActivityInstance(instanceId: string): Promise<ActivityInstanceInfo | null> {
    const response = await this.call(
      {
        method: 'GET',
        url: `${this.baseUrl}/applications/${this.clientId}/activity-instances/${encodeURIComponent(instanceId)}`,
        headers: { authorization: `Bot ${this.botToken}` },
      },
      [404],
    );
    if (response.status === 404) return null;
    const instance = this.parse(ActivityInstance, response, 'activity instance');
    return {
      instanceId: instance.instance_id,
      guildId: instance.location.guild_id ?? null,
      userIds: instance.users,
    };
  }

  private async call(request: HttpRequest, accept: number[] = []): Promise<HttpResponse> {
    let response: HttpResponse;
    try {
      response = await this.http.request(request);
    } catch (error) {
      throw new DiscordApiError('unavailable', 'request failed', undefined, error);
    }
    if (response.status >= 200 && response.status < 300) return response;
    if (accept.includes(response.status)) return response;
    if (response.status === 429 || response.status >= 500) {
      throw new DiscordApiError(
        'unavailable',
        `discord answered ${response.status}`,
        response.status,
      );
    }
    throw new DiscordApiError('rejected', `discord answered ${response.status}`, response.status);
  }

  private parse<S extends TSchema>(schema: S, response: HttpResponse, what: string): Static<S> {
    if (!Value.Check(schema, response.body)) {
      throw new DiscordApiError('unavailable', `unreadable ${what} response`, response.status);
    }
    return response.body as Static<S>;
  }
}
