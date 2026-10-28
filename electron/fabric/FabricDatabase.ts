import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { ConversationMessage, QuotaSnapshot, RoutingAudit, TaskState, UsageRecord, UsageUnit } from '../../src/fabric/types';
import { normalizeTaskState, publicMessage } from '../../src/fabric/ContinuityState';
import type { ResultVerification } from '../../src/fabric/Verification';

/** Per-user SQLite store. No credential columns. WAL, indexed bounded reads and transactional writes. */
export class FabricDatabase {
  private readonly db: Database.Database;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }

  close(): void { this.db.close(); }
  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version > 4) throw new Error(`Unsupported Intelligence Fabric database version ${version}`);
    if (version === 4) return;
    if (version === 0) this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE usage_records (
          id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, account_id TEXT, model_id TEXT, task_id TEXT,
          unit TEXT NOT NULL, amount REAL NOT NULL CHECK(amount >= 0), input REAL, output REAL, cached REAL,
          estimated_cost REAL, currency TEXT, timestamp INTEGER NOT NULL, reset_at INTEGER, source TEXT NOT NULL
        );
        CREATE INDEX usage_provider_time ON usage_records(provider_id, timestamp DESC);
        CREATE INDEX usage_task ON usage_records(task_id, timestamp DESC);
        CREATE TABLE quota_snapshots (
          provider_id TEXT NOT NULL, account_key TEXT NOT NULL, unit TEXT NOT NULL,
          used REAL, limit_value REAL, remaining REAL, reset_at INTEGER, source TEXT NOT NULL, state TEXT NOT NULL,
          PRIMARY KEY(provider_id, account_key, unit)
        );
        CREATE TABLE conversations (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE messages (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id),
          message_id TEXT NOT NULL UNIQUE, parent_id TEXT, role TEXT NOT NULL, content TEXT NOT NULL,
          timestamp INTEGER NOT NULL, provider_id TEXT, model_id TEXT, channel TEXT, task_id TEXT,
          tools_json TEXT NOT NULL, artifacts_json TEXT NOT NULL, usage_json TEXT NOT NULL,
          refs_json TEXT NOT NULL, routing_decision_id TEXT
        );
        CREATE INDEX messages_page ON messages(conversation_id, seq DESC);
        CREATE INDEX messages_task ON messages(task_id, seq DESC);
        CREATE TABLE task_states (task_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX task_states_conversation ON task_states(conversation_id, updated_at DESC);
        CREATE TABLE routing_audits (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, audit_json TEXT NOT NULL, timestamp INTEGER NOT NULL);
        CREATE INDEX routing_audits_task ON routing_audits(task_id, timestamp DESC);
        CREATE TABLE benchmarks (
          hardware_fingerprint TEXT NOT NULL, runtime_id TEXT NOT NULL, model_id TEXT NOT NULL, config_key TEXT NOT NULL,
          result_json TEXT NOT NULL, ran_at INTEGER NOT NULL,
          PRIMARY KEY(hardware_fingerprint, runtime_id, model_id, config_key)
        );
      `);
      this.db.pragma('user_version = 1');
    })();
    if (version < 2) this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE task_checkpoints (task_id TEXT PRIMARY KEY, checkpoint_json TEXT NOT NULL);
        CREATE TABLE task_operations (operation_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, operation_json TEXT NOT NULL);
        CREATE INDEX task_operations_task ON task_operations(task_id);
        CREATE TABLE task_effects (effect_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, effect_json TEXT NOT NULL);
      `);
      this.db.pragma('user_version = 2');
    })();
    if (version < 3) this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS result_verifications (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, verification_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS result_verification_operation ON result_verifications(operation_id);
        CREATE TABLE IF NOT EXISTS memory_records (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, text TEXT NOT NULL, record_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS memory_task ON memory_records(task_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, text, tokenize='unicode61');
      `);
      this.db.pragma('user_version = 3');
    })();
    this.db.transaction(() => {
      this.db.exec('CREATE TABLE IF NOT EXISTS task_graphs (id TEXT PRIMARY KEY, graph_json TEXT NOT NULL)');
      this.db.pragma('user_version = 4');
    })();
  }

  /** Main-only continuity journal; none of these mutation methods are IPC APIs. */
  atomic<T>(work: () => T): T { return this.db.transaction(work)(); }
  graphRecord(id: string): unknown | null {
    const row = this.db.prepare('SELECT graph_json AS json FROM task_graphs WHERE id=?').get(id) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }
  graphRecords(): unknown[] {
    return (this.db.prepare('SELECT graph_json AS json FROM task_graphs LIMIT 1000').all() as { json: string }[]).map(r => JSON.parse(r.json));
  }
  writeGraphRecord(id: string, graph: unknown): void {
    this.db.prepare('INSERT INTO task_graphs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET graph_json=excluded.graph_json').run(id, JSON.stringify(graph));
  }
  writeVerificationRecord(record: ResultVerification): void {
    this.db.prepare('INSERT INTO result_verifications VALUES (?,?,?)').run(record.id, record.operationId, JSON.stringify(record));
  }
  verificationRecords(operationId?: string): ResultVerification[] {
    const rows = (operationId ? this.db.prepare('SELECT verification_json AS json FROM result_verifications WHERE operation_id=? ORDER BY rowid DESC LIMIT 100').all(operationId)
      : this.db.prepare('SELECT verification_json AS json FROM result_verifications ORDER BY rowid DESC LIMIT 5000').all()) as { json: string }[];
    return rows.map(r => JSON.parse(r.json));
  }
  writeMemoryRecord(id: string, taskId: string, record: { text: string }): void {
    this.atomic(() => {
      this.db.prepare('INSERT INTO memory_records VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,record_json=excluded.record_json').run(id, taskId, record.text, JSON.stringify(record));
      this.db.prepare('DELETE FROM memory_fts WHERE id=?').run(id);
      this.db.prepare('INSERT INTO memory_fts(id,text) VALUES (?,?)').run(id, record.text);
    });
  }
  memoryRecords(taskId?: string): unknown[] {
    const rows = (taskId ? this.db.prepare('SELECT record_json AS json FROM memory_records WHERE task_id=? LIMIT 5000').all(taskId)
      : this.db.prepare('SELECT record_json AS json FROM memory_records LIMIT 5000').all()) as { json: string }[];
    return rows.map(r => JSON.parse(r.json));
  }
  searchMemoryRecords(query: string, limit: number, taskId?: string): unknown[] {
    const terms = query.slice(0, 256).match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) ?? [];
    if (!terms.length) return [];
    const expression = terms.map(t => '"' + t + '"').join(' AND ');
    const sql = 'SELECT m.record_json AS json FROM memory_fts f JOIN memory_records m ON m.id=f.id WHERE memory_fts MATCH ?' + (taskId ? ' AND m.task_id=?' : '') + ' ORDER BY bm25(memory_fts) LIMIT ?';
    return (this.db.prepare(sql).all(expression, ...(taskId ? [taskId] : []), Math.max(1, Math.min(30, limit))) as { json: string }[]).map(r => JSON.parse(r.json));
  }
  checkpointRecord(taskId: string): unknown | null {
    const row = this.db.prepare('SELECT checkpoint_json AS json FROM task_checkpoints WHERE task_id=?').get(taskId) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }
  writeCheckpointRecord(taskId: string, record: unknown): void {
    this.db.prepare('INSERT INTO task_checkpoints VALUES (?,?) ON CONFLICT(task_id) DO UPDATE SET checkpoint_json=excluded.checkpoint_json').run(taskId, JSON.stringify(record));
  }
  operationRecord(operationId: string): unknown | null {
    const row = this.db.prepare('SELECT operation_json AS json FROM task_operations WHERE operation_id=?').get(operationId) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }
  operationRecords(taskId?: string): unknown[] {
    const rows = (taskId ? this.db.prepare('SELECT operation_json AS json FROM task_operations WHERE task_id=?').all(taskId) : this.db.prepare('SELECT operation_json AS json FROM task_operations').all()) as { json: string }[];
    return rows.map(r => JSON.parse(r.json));
  }
  writeOperationRecord(operationId: string, taskId: string, record: unknown): void {
    this.db.prepare('INSERT INTO task_operations VALUES (?,?,?) ON CONFLICT(operation_id) DO UPDATE SET operation_json=excluded.operation_json').run(operationId, taskId, JSON.stringify(record));
  }
  effectRecord(effectId: string): unknown | null {
    const row = this.db.prepare('SELECT effect_json AS json FROM task_effects WHERE effect_id=?').get(effectId) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }
  effectRecords(taskId: string): unknown[] {
    return (this.db.prepare('SELECT effect_json AS json FROM task_effects WHERE task_id=?').all(taskId) as { json: string }[]).map(r => JSON.parse(r.json));
  }
  writeEffectRecord(effectId: string, taskId: string, record: unknown): void {
    this.db.prepare('INSERT INTO task_effects VALUES (?,?,?) ON CONFLICT(effect_id) DO UPDATE SET effect_json=excluded.effect_json').run(effectId, taskId, JSON.stringify(record));
  }

  recordUsage(record: UsageRecord): void {
    if (!Number.isFinite(record.amount) || record.amount < 0) throw new Error('Invalid usage amount');
    this.db.prepare(`INSERT INTO usage_records VALUES (@id,@providerId,@accountId,@modelId,@taskId,@unit,@amount,@input,@output,@cached,@estimatedCost,@currency,@timestamp,@resetAt,@source)`).run(record);
  }
  usagePage(providerId: string, limit = 100, before = Number.MAX_SAFE_INTEGER): UsageRecord[] {
    const rows = this.db.prepare('SELECT * FROM usage_records WHERE provider_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?')
      .all(providerId, before, Math.max(1, Math.min(limit, 500))) as Record<string, unknown>[];
    return rows.map((r) => ({ id: r.id, providerId: r.provider_id, accountId: r.account_id, modelId: r.model_id, taskId: r.task_id,
      unit: r.unit, amount: r.amount, input: r.input, output: r.output, cached: r.cached,
      estimatedCost: r.estimated_cost, currency: r.currency, timestamp: r.timestamp, resetAt: r.reset_at, source: r.source } as UsageRecord));
  }
  setQuota(snapshot: QuotaSnapshot): void {
    this.db.prepare(`INSERT INTO quota_snapshots VALUES (@providerId,@accountKey,@unit,@used,@limit,@remaining,@resetAt,@source,@state)
      ON CONFLICT(provider_id,account_key,unit) DO UPDATE SET used=excluded.used,limit_value=excluded.limit_value,
      remaining=excluded.remaining,reset_at=excluded.reset_at,source=excluded.source,state=excluded.state`)
      .run({ ...snapshot, accountKey: snapshot.accountId ?? '', limit: snapshot.limit });
  }
  quota(providerId: string, accountId: string | null, unit: UsageUnit): QuotaSnapshot {
    const row = this.db.prepare('SELECT * FROM quota_snapshots WHERE provider_id=? AND account_key=? AND unit=?')
      .get(providerId, accountId ?? '', unit) as Record<string, unknown> | undefined;
    if (!row) return { providerId, accountId, unit, used: null, limit: null, remaining: null, resetAt: null, source: 'UNKNOWN', state: 'UNKNOWN' };
    return { providerId, accountId, unit, used: row.used as number | null, limit: row.limit_value as number | null,
      remaining: row.remaining as number | null, resetAt: row.reset_at as number | null,
      source: row.source as QuotaSnapshot['source'], state: row.state as QuotaSnapshot['state'] };
  }

  appendMessage(message: ConversationMessage): void {
    message = publicMessage(message);
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO conversations VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at')
        .run(message.conversationId, message.timestamp, message.timestamp);
      this.db.prepare(`INSERT INTO messages(conversation_id,message_id,parent_id,role,content,timestamp,provider_id,model_id,channel,task_id,tools_json,artifacts_json,usage_json,refs_json,routing_decision_id)
        VALUES (@conversationId,@messageId,@parentId,@role,@content,@timestamp,@providerId,@modelId,@channel,@taskId,@tools,@artifacts,@usage,@refs,@routingDecisionId)`)
        .run({ ...message, tools: JSON.stringify(message.tools), artifacts: JSON.stringify(message.artifacts),
          usage: JSON.stringify(message.usageIds), refs: JSON.stringify(message.contextRefs) });
    })();
  }
  messagePage(conversationId: string, limit = 100, beforeSeq = Number.MAX_SAFE_INTEGER): { seq: number; message: ConversationMessage }[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE conversation_id=? AND seq < ? ORDER BY seq DESC LIMIT ?')
      .all(conversationId, beforeSeq, Math.max(1, Math.min(limit, 500))) as Record<string, unknown>[];
    return rows.map((r) => ({ seq: r.seq as number, message: {
      conversationId: r.conversation_id, messageId: r.message_id, parentId: r.parent_id, role: r.role,
      content: r.content, timestamp: r.timestamp, providerId: r.provider_id, modelId: r.model_id,
      channel: r.channel, taskId: r.task_id, tools: JSON.parse(r.tools_json as string),
      artifacts: JSON.parse(r.artifacts_json as string), usageIds: JSON.parse(r.usage_json as string),
      contextRefs: JSON.parse(r.refs_json as string), routingDecisionId: r.routing_decision_id,
    } as ConversationMessage }));
  }
  saveTask(state: TaskState): void {
    state = normalizeTaskState(state);
    this.db.prepare(`INSERT INTO task_states VALUES (@taskId,@conversationId,@json,@updatedAt)
      ON CONFLICT(task_id) DO UPDATE SET conversation_id=excluded.conversation_id,state_json=excluded.state_json,updated_at=excluded.updated_at`)
      .run({ taskId: state.taskId, conversationId: state.conversationId, json: JSON.stringify(state), updatedAt: state.updatedAt });
  }
  task(taskId: string): TaskState | null {
    const row = this.db.prepare('SELECT state_json FROM task_states WHERE task_id=?').get(taskId) as { state_json: string } | undefined;
    return row ? normalizeTaskState(JSON.parse(row.state_json)) : null;
  }
  taskPage(limit = 50, before: { updatedAt: number; taskId: string } | null = null): TaskState[] {
    const rows = this.db.prepare(`SELECT state_json FROM task_states
      WHERE updated_at < ? OR (updated_at = ? AND task_id < ?)
      ORDER BY updated_at DESC, task_id DESC LIMIT ?`)
      .all(before?.updatedAt ?? Number.MAX_SAFE_INTEGER, before?.updatedAt ?? Number.MAX_SAFE_INTEGER,
        before?.taskId ?? '', Math.max(1, Math.min(limit, 100))) as { state_json: string }[];
    return rows.map(row => normalizeTaskState(JSON.parse(row.state_json)));
  }
  recordRouting(audit: RoutingAudit): void {
    this.db.prepare('INSERT INTO routing_audits VALUES (?, ?, ?, ?)').run(audit.id, audit.taskId, JSON.stringify(audit), audit.timestamp);
  }
  routingPage(taskId: string, limit = 100): RoutingAudit[] {
    return (this.db.prepare('SELECT audit_json FROM routing_audits WHERE task_id=? ORDER BY timestamp DESC LIMIT ?')
      .all(taskId, Math.max(1, Math.min(limit, 500))) as { audit_json: string }[]).map((r) => JSON.parse(r.audit_json) as RoutingAudit);
  }
  saveBenchmark(key: { hardwareFingerprint: string; runtimeId: string; modelId: string; configuration: string }, result: unknown): void {
    this.db.prepare(`INSERT INTO benchmarks VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(hardware_fingerprint,runtime_id,model_id,config_key) DO UPDATE SET result_json=excluded.result_json,ran_at=excluded.ran_at`)
      .run(key.hardwareFingerprint, key.runtimeId, key.modelId, key.configuration, JSON.stringify(result), Date.now());
  }
  benchmark(key: { hardwareFingerprint: string; runtimeId: string; modelId: string; configuration: string }): unknown | null {
    const row = this.db.prepare('SELECT result_json FROM benchmarks WHERE hardware_fingerprint=? AND runtime_id=? AND model_id=? AND config_key=?')
      .get(key.hardwareFingerprint, key.runtimeId, key.modelId, key.configuration) as { result_json: string } | undefined;
    return row ? JSON.parse(row.result_json) : null;
  }
}
