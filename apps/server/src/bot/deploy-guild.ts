import { runDeployCli } from './deploy.ts';

runDeployCli('guild').catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
