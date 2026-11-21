/** WCAG contrast helpers over the kit's CSS role tokens. Pure; no DOM needed. */

export type Theme = 'light' | 'dark';

export function parseDeclarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

/** `selector { body }` blocks, outermost only (no at-rules needed here). */
export function parseRules(css: string): { selectors: string[]; body: string }[] {
  const rules: { selectors: string[]; body: string }[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({
      selectors: m[1]!.split(',').map((s) => s.trim()),
      body: m[2]!,
    });
  }
  return rules;
}

/** Resolved `--name` → `#rrggbb` for one theme. Dark overrides the light/root roles. */
export function loadTokens(tokensCss: string, theme: Theme): Record<string, string> {
  const base: Record<string, string> = {};
  let dark: Record<string, string> = {};
  for (const rule of parseRules(tokensCss)) {
    const isDark = rule.selectors.some((s) => s.includes("data-theme='dark'"));
    const isOtherTheme = rule.selectors.some(
      (s) => s.includes('data-theme') && !s.includes("data-theme='light'") && !isDark,
    );
    if (isOtherTheme) continue;
    if (isDark) dark = { ...dark, ...parseDeclarations(rule.body) };
    else Object.assign(base, parseDeclarations(rule.body));
  }
  return theme === 'dark' ? { ...base, ...dark } : base;
}

export function resolve(tokens: Record<string, string>, name: string): string {
  let value = tokens[name.startsWith('--') ? name : `--${name}`];
  for (let i = 0; value !== undefined && i < 10; i++) {
    const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (!ref) break;
    value = tokens[ref[1]!];
  }
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`token ${name} does not resolve to a hex colour (got ${String(value)})`);
  }
  return value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The role a shell rule assigns to `property` (`color` or `--bc`) for `selector`, if any. */
export function roleOf(
  rules: ReturnType<typeof parseRules>,
  selector: string,
  property: string,
): string | null {
  let found: string | null = null;
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue;
    const m = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*var\\((--[a-z0-9-]+)\\)`).exec(rule.body);
    if (m) found = m[1]!;
  }
  return found;
}
