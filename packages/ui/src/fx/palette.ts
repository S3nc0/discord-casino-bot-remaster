export const CONFETTI_ROLE_VARS = [
  '--primary',
  '--secondary',
  '--tertiary',
  '--success',
  '--warning',
  '--error',
] as const;

export const COIN_ROLE_VARS = [
  '--warning',
  '--yellow-accent',
  '--amber-accent',
  '--secondary',
] as const;

const ROLE_FALLBACKS: Readonly<Record<string, string>> = {
  '--primary': '#006a64',
  '--secondary': '#9e4200',
  '--tertiary': '#753ec4',
  '--success': '#006e19',
  '--warning': '#835500',
  '--error': '#bc151b',
  '--yellow-accent': '#6b5f00',
  '--amber-accent': '#835500',
};

const DEFAULT_FALLBACK_COLOR = '#006a64';

function resolveVarValue(style: CSSStyleDeclaration, rawName: string, depth = 0): string {
  if (depth > 4) return '';
  const value = style.getPropertyValue(rawName).trim();
  if (!value) return '';
  const varMatch = /^var\(\s*(--[A-Za-z0-9_-]+)(?:\s*,\s*([^)]+))?\s*\)$/.exec(value);
  if (varMatch) {
    const refName = varMatch[1];
    const refFallback = varMatch[2]?.trim() ?? '';
    if (refName) {
      const resolved = resolveVarValue(style, refName, depth + 1);
      if (resolved) return resolved;
    }
    return refFallback;
  }
  return value;
}

export function resolveCssRoleColor(varName: string, element?: Element | null): string {
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    if (element && element !== document.documentElement) {
      const elStyle = window.getComputedStyle(element);
      const elResolved = resolveVarValue(elStyle, varName);
      if (elResolved) {
        return elResolved;
      }
    }
    const root = document.documentElement;
    if (root) {
      const rootStyle = window.getComputedStyle(root);
      const rootResolved = resolveVarValue(rootStyle, varName);
      if (rootResolved) {
        return rootResolved;
      }
    }
  }
  return ROLE_FALLBACKS[varName] ?? DEFAULT_FALLBACK_COLOR;
}

export function resolveRolePalette(
  roleVars: readonly string[] = CONFETTI_ROLE_VARS,
  element?: Element | null,
): string[] {
  const colors: string[] = [];
  for (const varName of roleVars) {
    const color = resolveCssRoleColor(varName, element);
    if (color) {
      colors.push(color);
    }
  }
  return colors.length > 0 ? colors : [DEFAULT_FALLBACK_COLOR];
}
