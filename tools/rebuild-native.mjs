import { createRequire } from 'node:module';
import { rebuild } from '@electron/rebuild';
import {spawnSync} from 'node:child_process';

const require = createRequire(import.meta.url);
const electronVersion = require('electron/package.json').version;
const sqliteVersion = require('better-sqlite3/package.json').version;
if (Number(sqliteVersion.split('.')[0]) >= 13) {
  // v13 ships a Node-API binary. Validate both actual runtimes instead of
  // compiling an ABI-specific V8 addon unnecessarily on every Electron bump.
  for (const executable of [process.execPath, require('electron')]) {
    const r = spawnSync(executable, ['tools/sqlite-abi-preflight.mjs'], {env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, stdio: 'inherit', windowsHide: true});
    if (r.status !== 0) throw Error('SQLITE_NODE_API_VALIDATION_FAILED');
  }
  console.log(`better-sqlite3 ${sqliteVersion} Node-API binary validated on Node and Electron ${electronVersion}`);
} else {
await rebuild({ buildPath: process.cwd(), electronVersion, arch: process.arch,
  onlyModules: ['better-sqlite3'], force: true });
console.log(`better-sqlite3 rebuilt for Electron ${electronVersion}`);
}
