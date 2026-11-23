import type { IncomingMessage } from 'node:http';

/**
 * The client address of an upgrade request, by the same rule as Fastify's `trustProxy`:
 * `false`/`0` ignores `X-Forwarded-For`, `true` trusts the whole header (the leftmost entry is
 * the client), a number trusts that many proxies, so the entry the nearest one appended is
 * used and anything a client put in front of it is ignored.
 */
export function clientIpOf(request: IncomingMessage, trustProxy: boolean | number): string {
  const peer = request.socket.remoteAddress ?? 'unknown';
  if (trustProxy === false || trustProxy === 0) return peer;
  const header = request.headers['x-forwarded-for'];
  const chain = (typeof header === 'string' ? header : '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (chain.length === 0) return peer;
  const hops = trustProxy === true ? chain.length : trustProxy;
  return chain[Math.max(0, chain.length - hops)] ?? peer;
}
