import type { ProxySignatureVerifier, ProxySignedRequest } from '@casino/shared';
import { REASONS, missingProxyHeaders, proxyReason } from './reasons.ts';

/** What the proxy signature check found on a request. */
export type ProxySignatureState = 'valid' | 'absent' | 'skipped';

export type ProxyDecision =
  { ok: true; state: ProxySignatureState } | { ok: false; reason: string; absent: string[] };

/**
 * The proxy signature policy for routes that are not exempt (`health`, `token`):
 * - no verifier (development): skipped;
 * - none of the three headers present: refused only when `required`, else allowed as `absent`
 *   (the route still needs our own session token);
 * - any header present: all must be present and valid, whatever `required` says.
 */
export function checkProxySignature(
  verifier: ProxySignatureVerifier | null,
  request: ProxySignedRequest,
  nowSeconds: number,
  required: boolean,
): ProxyDecision {
  if (!verifier) return { ok: true, state: 'skipped' };
  const absent = missingProxyHeaders(request);
  if (absent.length === 3) {
    return required
      ? { ok: false, reason: REASONS.proxySignatureMissing, absent }
      : { ok: true, state: 'absent' };
  }
  const result = verifier.verify(request, nowSeconds);
  return result.ok
    ? { ok: true, state: 'valid' }
    : { ok: false, reason: proxyReason(result.reason), absent };
}

/** Log reason carrying the names of the absent headers, when any. */
export const decisionReason = (d: Extract<ProxyDecision, { ok: false }>): string =>
  d.absent.length > 0 ? `${d.reason}:${d.absent.join(',')}` : d.reason;

const MAX_TRACKED = 10_000;

/**
 * One info line per session and transport saying whether Discord signed its traffic.
 * Header values never reach the log.
 */
export class ProxySignatureObserver {
  private readonly seen = new Set<string>();
  private readonly logger: { info(fields: object, message: string): void };

  constructor(logger: { info(fields: object, message: string): void }) {
    this.logger = logger;
  }

  note(sessionId: string, transport: 'http' | 'socket', state: ProxySignatureState): void {
    const key = `${transport}:${sessionId}`;
    if (this.seen.has(key)) return;
    if (this.seen.size >= MAX_TRACKED) this.seen.clear();
    this.seen.add(key);
    this.logger.info({ transport, proxySignature: state }, `proxy signature: present=${state}`);
  }
}
