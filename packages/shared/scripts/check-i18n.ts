// Fails (exit 1) when a message key is missing, empty, or has different placeholders in any
// language. Runs with Node's built-in type stripping: `node scripts/check-i18n.ts`.
import { en } from '../i18n/en.ts';
import { ja } from '../i18n/ja.ts';
import { checkParity } from '../i18n/parity.ts';

const problems = checkParity({ en, ja });
const keyCount = Object.keys(en).length;

if (problems.length > 0) {
  console.error(`i18n parity check failed (${problems.length} problem(s)):`);
  for (const p of problems) {
    console.error(`  [${p.locale}] ${p.key}: ${p.problem}${p.detail ? ` ${p.detail}` : ''}`);
  }
  process.exit(1);
}
console.log(`i18n parity ok: ${keyCount} keys in en and ja`);
