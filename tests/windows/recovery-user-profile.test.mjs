import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright';
const evidence = path.resolve('docs/evidence/recovery-20261007/installed-profile');
fs.mkdirSync(evidence, { recursive: true });
const env = { ...process.env };
delete env.JARVIS_ALLOW_FIXTURES; delete env.JARVIS_TEST_USER_DATA;
let app;
try {
  app = await electron.launch({ executablePath: path.resolve(process.env.JARVIS_EXE), env, timeout: 300000 });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Home', exact: true }).waitFor({ timeout: 180000 });
  const result = await app.evaluate(({ app }) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/dist-electron/main.js');
    const path = require('node:path'), Sqlite = require('better-sqlite3');
    const profile = app.getPath('userData');
    const db = new Sqlite(path.join(profile, 'intelligence-fabric/fabric.sqlite'), { readonly: true });
    const counts = Object.fromEntries(['conversations', 'messages', 'task_states'].map(t => [t, db.prepare('SELECT count(*) AS n FROM ' + t).get().n]));
    const result = { version: app.getVersion(), profile, counts, integrity: db.pragma('quick_check', { simple: true }), schema: db.pragma('user_version', { simple: true }) };
    db.close(); return result;
  });
  assert.equal(result.version, '0.3.0-dev');
  assert.equal(path.resolve(result.profile), path.resolve(process.env.JARVIS_USER_DATA));
  assert.deepEqual(result.counts, { conversations: 1, messages: 24, task_states: 12 });
  assert.equal(result.integrity, 'ok'); assert.equal(result.schema, 4);
  await page.screenshot({ path: path.join(evidence, 'installed.png') });
  fs.writeFileSync(path.join(evidence, 'installed-profile.json'), JSON.stringify({ status: 'PASS', ...result, fixtureMode: false }, null, 2));
  console.log('INSTALLED_PROFILE_PASS ' + JSON.stringify(result));
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'installed-failure.json'), JSON.stringify({ status: 'FAIL', error: String(error) }, null, 2));
  throw error;
} finally { if (app) await app.close(); }
