import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

export function externalPath(value) {
  const resolved = path.resolve(value); assert.ok(resolved.toLowerCase().startsWith('e:\\codex\\'), 'EXTERNAL_CODEX_PATH_REQUIRED'); return resolved;
}
/** Read-only hashes/counts. Narrative, credentials and vault contents never leave this function. */
export function profileMetadata(file) {
  const database = new Database(externalPath(file), { readonly: true, fileMustExist: true });
  try {
    const tables = {};
    for (const [table, order] of [['conversations', 'id'], ['messages', 'seq'], ['task_states', 'task_id']]) {
      const rows = database.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
      tables[table] = { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
    }
    return { stats: { schema: database.pragma('user_version', { simple: true }), integrity: database.pragma('integrity_check', { simple: true }),
      conversations: tables.conversations.count, messages: tables.messages.count, tasks: tables.task_states.count }, tables,
      sqliteVersion: database.prepare('SELECT sqlite_version() AS version').get().version };
  } finally { database.close(); }
}
