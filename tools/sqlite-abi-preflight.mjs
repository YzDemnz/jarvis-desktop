import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const runtime = process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`;
try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:', process.argv[2] ? {nativeBinding: process.argv[2]} : {}); db.close();
  const sqliteVersion = require('better-sqlite3/package.json').version;
  console.log(`SQLITE_ABI_OK runtime=${runtime} processAbi=${process.versions.modules} sqlite=${sqliteVersion} binding=${Number(sqliteVersion.split('.')[0]) >= 13 ? 'NODE_API' : 'V8_ABI'}`);
} catch (error) {
  const message = String(error);
  const compiled = message.match(/NODE_MODULE_VERSION\s+(\d+)/)?.[1] ?? 'UNKNOWN';
  const expected = message.match(/requires\s+NODE_MODULE_VERSION\s+(\d+)/)?.[1] ?? process.versions.modules;
  const remedy = process.versions.electron
    ? 'npm.cmd run build:native'
    : 'npm.cmd run test:portable-electron (development Electron binary; keep the packaged RunAsNode fuse unchanged)';
  console.error(`SQLITE_ABI_MISMATCH runtime=${runtime} expected=${expected} actual=${compiled} processAbi=${process.versions.modules} remedy=${remedy}`);
  process.exitCode = 1;
}
