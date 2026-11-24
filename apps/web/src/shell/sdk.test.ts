import { describe, expect, it } from 'vitest';
import { readConfig } from './config.ts';
import { createActivitySdk, isHttpUrl } from './sdk.ts';

describe('ActivitySdk.openExternalLink', () => {
  it('accepts only http and https URLs', () => {
    expect(isHttpUrl('https://example.com/watch')).toBe(true);
    expect(isHttpUrl('http://example.com/live')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,hi')).toBe(false);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('/relative/path')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });

  it('delegates http(s) URLs to the Discord SDK command and rejects other schemes', async () => {
    const sdk = createActivitySdk(readConfig('', { VITE_MOCK_DISCORD: '1' }));
    await expect(sdk.openExternalLink('https://example.com/live')).resolves.toBeUndefined();
    await expect(sdk.openExternalLink('http://example.com/live')).resolves.toBeUndefined();
    await expect(sdk.openExternalLink('javascript:alert(1)')).rejects.toThrow('invalid_url');
    await expect(sdk.openExternalLink('not-a-url')).rejects.toThrow('invalid_url');
  });
});
