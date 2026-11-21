// Fails the build when the bundle mentions a URL that is not on the allowlist below.
// Inside a Discord Activity only mapped paths (`/api`, `/cdn`) are reachable, so the app's own
// code must never name an external host. The entries here are inert strings in dependencies
// (XML namespaces, error-message links, the Embedded App SDK's list of Discord origins).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const ALLOWED = [
  /^https?:\/\/www\.w3\.org\//,
  /^https:\/\/react\.dev\/errors\//,
  /^https:\/\/socket\.io\/docs\//,
  /^https:\/\/github\.com\/uuidjs\//,
  /^https:\/\/([a-z]+\.)?discord(app)?\.(com|co)\b/,
  /^https:\/\/assets-global\.website-files\.com\//, // Embedded App SDK debug logo
  /^http:\/\/localhost:3333$/, // Embedded App SDK local dev origin
  /^https:\/\/\$\{/, // template literal fragment in the SDK
];

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.(html|js|css)$/.test(entry.name)) yield path;
  }
}

const found = new Set();
for (const file of files(dist)) {
  for (const match of readFileSync(file, 'utf8').matchAll(/https?:\/\/[^\s"'`<>)\\]+/g)) {
    found.add(match[0]);
  }
}
const bad = [...found].filter((url) => !ALLOWED.some((re) => re.test(url)));
if (bad.length > 0) {
  console.error(`Unexpected external URLs in the bundle:\n${bad.join('\n')}`);
  process.exit(1);
}
console.log(`bundle ok: ${found.size} URL-like strings, all allowlisted`);
