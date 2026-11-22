import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as botModule from '../bot/index.ts';
import {
  EMBED_ROLES,
  EMBED_ROLE_COLORS,
  EMBED_ROLE_HEX,
  EMBED_ROLE_TOKENS,
  botColor,
  defaultEmbedTheme,
  embedColor,
} from './theme.ts';

interface TokenEntry {
  name: string;
  value: string | { light: string; dark: string };
}

interface BitbloomTokensJson {
  color: {
    tokens: TokenEntry[];
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS_JSON_PATH = resolve(HERE, '../../../../design/bitbloom/tokens.json');

function loadDarkTokens(): Map<string, string> {
  const parsed = JSON.parse(readFileSync(TOKENS_JSON_PATH, 'utf8')) as BitbloomTokensJson;
  const raw = new Map<string, string>();
  for (const token of parsed.color.tokens) {
    raw.set(token.name, typeof token.value === 'string' ? token.value : token.value.dark);
  }
  const resolveToken = (name: string, depth = 0): string => {
    if (depth > 4) throw new Error(`cyclic token reference: ${name}`);
    const val = raw.get(name);
    if (!val) throw new Error(`missing token in tokens.json: ${name}`);
    const match = /^\{(.+)\}$/.exec(val);
    return match?.[1] ? resolveToken(match[1], depth + 1) : val;
  };
  const resolved = new Map<string, string>();
  for (const name of raw.keys()) {
    resolved.set(name, resolveToken(name));
  }
  return resolved;
}

describe('Bitbloom round 2 embed theme', () => {
  it('matches design/bitbloom/tokens.json for every embed role', () => {
    const tokens = loadDarkTokens();

    for (const role of EMBED_ROLES) {
      const tokenName = EMBED_ROLE_TOKENS[role];
      const expectedHex = tokens.get(tokenName);
      expect(expectedHex, `tokens.json entry for ${role} (${tokenName})`).toMatch(
        /^#[0-9a-f]{6}$/i,
      );
      const expectedInt = Number.parseInt(expectedHex!.slice(1), 16);

      expect(EMBED_ROLE_HEX[role], `EMBED_ROLE_HEX.${role}`).toBe(expectedHex!.toLowerCase());
      expect(EMBED_ROLE_COLORS[role], `EMBED_ROLE_COLORS.${role}`).toBe(expectedInt);
      expect(embedColor(role)).toBe(expectedInt);
      expect(botColor(role)).toBe(expectedInt);
      expect(defaultEmbedTheme.color(role)).toBe(expectedInt);
      expect(defaultEmbedTheme.hex(role)).toBe(expectedHex!.toLowerCase());
    }
  });

  it('uses the round 2 green/yellow/blue/semantic palette instead of the old teal values', () => {
    const tokens = loadDarkTokens();
    expect(EMBED_ROLE_HEX.primary).toBe(tokens.get('green-70'));
    expect(EMBED_ROLE_HEX.primary).not.toBe('#00867e');
    expect(EMBED_ROLE_HEX.gold).toBe(tokens.get('yellow-80'));
    expect(EMBED_ROLE_HEX.tertiary).toBe(tokens.get('yellow-80'));
    expect(EMBED_ROLE_HEX.info).toBe(tokens.get('sky-70'));
    expect(EMBED_ROLE_HEX.secondary).toBe(tokens.get('sky-70'));
    expect(EMBED_ROLE_HEX.success).toBe(tokens.get('success'));
    expect(EMBED_ROLE_HEX.warning).toBe(tokens.get('warning'));
    expect(EMBED_ROLE_HEX.error).toBe(tokens.get('error'));
  });

  it('shares one theme module between bot and notify', () => {
    expect(botModule.EMBED_ROLE_COLORS).toBe(EMBED_ROLE_COLORS);
    expect(botModule.EMBED_ROLE_HEX).toBe(EMBED_ROLE_HEX);
    expect(botModule.embedColor).toBe(embedColor);
    expect(botModule.botColor).toBe(botColor);
  });
});
