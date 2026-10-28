import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron');
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
const tests = [
  'unit/logic.test.ts', 'unit/machine.test.ts', 'unit/desktop.test.ts', 'unit/dev.test.ts',
  'electron-double/browser.test.ts', 'electron-double/agent.test.ts', 'electron-double/helper-bridge.test.ts',
  'electron-double/dev-fs.test.ts', 'electron-double/dev-index.test.ts', 'electron-double/dev-process.test.ts',
  'electron-double/dev-agent.test.ts', 'unit/fabric.test.ts',
];
const preflight = spawnSync(electron, ['tools/sqlite-abi-preflight.mjs'], { cwd: process.cwd(), env, stdio: 'inherit' });
if (preflight.status !== 0) process.exit(preflight.status ?? 1);
for (const file of tests) {
  const r = spawnSync(electron, ['node_modules/tsx/dist/cli.mjs', '--tsconfig', 'tests/tsconfig.json',
    path.posix.join('tests', file)], { cwd: process.cwd(), env, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`PORTABLE_ELECTRON_FAIL ${file}`); process.exit(r.status ?? 1); }
}
console.log(`PORTABLE_ELECTRON_PASS ${tests.length} suites`);
