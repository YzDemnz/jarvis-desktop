import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const electron = createRequire(import.meta.url)('electron'), env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
for (const args of [['tools/sqlite-abi-preflight.mjs'], ['node_modules/tsx/dist/cli.mjs', '--tsconfig', 'tests/tsconfig.json', 'tests/unit/s41-cross-surface.test.ts']]) {
  const r = spawnSync(electron, args, { env, stdio: 'inherit', windowsHide: true }); if (r.status !== 0) process.exit(r.status ?? 1);
}
