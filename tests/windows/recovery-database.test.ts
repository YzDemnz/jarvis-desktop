import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Sqlite from 'better-sqlite3';
import { FabricDatabase } from '../../electron/fabric/FabricDatabase';

const original = path.join(process.env.JARVIS_USER_DATA!, 'intelligence-fabric', 'fabric.sqlite');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-database-recovery-'));
const copy = path.join(root, 'fabric.sqlite');
const source = new Sqlite(original, { readonly: true });
const count = (db: Sqlite.Database) => Object.fromEntries(['conversations', 'messages', 'task_states'].map(t => [t, (db.prepare('SELECT count(*) AS n FROM ' + t).get() as { n: number }).n]));
const before = count(source);
await source.backup(copy); source.close();
const migrated = new FabricDatabase(copy); migrated.close();
const check = new Sqlite(copy, { readonly: true });
assert.deepEqual(count(check), before);
assert.equal(check.pragma('quick_check', { simple: true }), 'ok');
for (const table of ['result_verifications', 'memory_fts', 'task_graphs']) {
  assert.ok(check.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(table), table);
}
const report = { status: 'PASS', before, after: count(check), integrity: 'ok', userDatabaseModified: false, copy };
check.close();
const evidence = path.resolve('docs/evidence/recovery-20261007');
fs.writeFileSync(path.join(evidence, 'legacy-database-migration.json'), JSON.stringify(report, null, 2));
console.log('LEGACY_DATABASE_MIGRATION_PASS', JSON.stringify(report));
