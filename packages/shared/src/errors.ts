import { Type, type Static } from 'typebox';

/** Machine-readable error codes. The client maps each to an i18n key `error.<code>`. */
export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'guild_not_allowed',
  'guild_pending',
  'invalid_payload',
  'rate_limited',
  'insufficient_funds',
  'feature_disabled',
  'not_found',
  'conflict',
  'in_flight',
  'expired',
  'game_busy',
  'internal',
] as const;
export const ErrorCode = Type.Enum(ERROR_CODES);
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Body of every non-2xx HTTP response. */
export const ApiError = Type.Object({
  error: ErrorCode,
  retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type ApiError = Static<typeof ApiError>;
