import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import { SERVER_ENV_KEYS, ServerEnv } from '@casino/shared';

// .env.example must list every key of the env contract, and its placeholders must have the
// right shape, so a copied .env only needs real values filled in.
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m?.[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

describe('.env.example', () => {
  const env = parseEnvFile(fileURLToPath(new URL('../../../../.env.example', import.meta.url)));

  it('lists every required key, including DISCORD_PUBLIC_KEY', () => {
    const required = SERVER_ENV_KEYS.filter((k) => k !== 'NODE_ENV');
    expect(Object.keys(env).sort()).toEqual(expect.arrayContaining(required));
    expect(env.DISCORD_PUBLIC_KEY).toBeDefined();
  });

  it('matches the ServerEnv contract', () => {
    expect([...Value.Errors(ServerEnv, env)].map((e) => e.instancePath)).toEqual([]);
  });
});
