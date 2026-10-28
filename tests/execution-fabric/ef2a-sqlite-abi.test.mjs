import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron');
const electronVersion = require('electron/package.json').version;
const nodeApi = Number(require('better-sqlite3/package.json').version.split('.')[0]) >= 13;
const node = spawnSync(process.execPath, ['tools/sqlite-abi-preflight.mjs'], { encoding: 'utf8' });
if (nodeApi) { assert.equal(node.status, 0, node.stderr); assert.match(node.stdout, /binding=NODE_API/); }
else { assert.equal(node.status, 1); assert.match(node.stderr, new RegExp(`SQLITE_ABI_MISMATCH.*expected=${process.versions.modules}.*actual=\\d+.*remedy=`)); }
const devElectron = spawnSync(electron, ['tools/sqlite-abi-preflight.mjs'],
  { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
assert.equal(devElectron.status, 0, devElectron.stderr);
assert.ok(devElectron.stdout.includes(`SQLITE_ABI_OK runtime=Electron ${electronVersion}`));
if (nodeApi) {
  // The installed app now contains Node-API SQLite. Preserve the actual ABI130
  // baseline independently so future runs do not mistake the new app for it.
  const old = process.env.JARVIS_LEGACY_SQLITE_BINARY ?? path.resolve('../Dependencias/NativeArtifacts/verified-0.4.1/better-sqlite3-abi130.node');
  assert.ok(fs.existsSync(old), 'Pinned old V8-ABI SQLite binary is required for the negative compatibility probe');
  for (const executable of [process.execPath, electron]) {
    const wrong = spawnSync(executable, ['tools/sqlite-abi-preflight.mjs', old], {encoding: 'utf8', env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, windowsHide: true});
    assert.equal(wrong.status, 1); assert.match(wrong.stderr, /SQLITE_ABI_MISMATCH/);assert.match(wrong.stderr,/actual=130/);
  }
}
console.log(`PASS SQLite native compatibility: ${nodeApi ? 'official Node-API binding loads in both runtimes; old V8 ABI rejected' : 'Node mismatch early; development Electron load succeeds'}`);
