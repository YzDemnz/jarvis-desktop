import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { externalPath, profileMetadata } from './electron44-profile-metadata.mjs';

const source = process.env.JARVIS_USER_DATA; assert.equal(source, 'E:\\CODEX\\DatosApps\\JARVIS', 'EXTERNAL_OWNER_PROFILE_REQUIRED');
const evidence = externalPath(process.env.JARVIS_MIGRATION_EVIDENCE_DIR ?? 'docs/evidence/electron44-20261011');
const target = externalPath(process.env.JARVIS_MIGRATION_BACKUP_DIR ?? 'E:/CODEX/Historial/Electron44-JARVIS-20261011/Perfil-antes-de-0.4.2');
assert.ok(target.toLowerCase().startsWith('e:\\codex\\historial\\'));
const backup = path.join(target, 'fabric.sqlite'), recordFile = path.join(evidence, 'owner-before.json');
assert.equal(fs.existsSync(backup), false, 'PRESERVE_EXISTING_BACKUP'); assert.equal(fs.existsSync(recordFile), false, 'PRESERVE_EXISTING_EVIDENCE');
fs.mkdirSync(target, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
const database = new Database(path.join(source, 'intelligence-fabric', 'fabric.sqlite'), { readonly: true, fileMustExist: true });
try { await database.backup(backup); } finally { database.close(); }
// Only authority/routing configuration. No vault, accounts, browser sessions or credentials.
for (const relative of ['authority/policy.json', 'connected-ai/connected-policy.json']) {
  const from = path.join(source, relative), to = path.join(target, relative);
  if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); }
}
// Inspect the completed snapshot: source may be live under WAL during backup.
const metadata = profileMetadata(backup); assert.equal(metadata.stats.integrity, 'ok');
const record = { kind: 'CONSISTENT_OWNER_BACKUP', source, backup, ...metadata, test: false, copiedVault: false, at: new Date().toISOString() };
fs.writeFileSync(recordFile, JSON.stringify(record, null, 2), { flag: 'wx' }); console.log(JSON.stringify(record));
