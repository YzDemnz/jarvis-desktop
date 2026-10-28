import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FabricDatabase } from '../../electron/fabric/FabricDatabase';
import { SovereignMemory, memorySearchTerms } from '../../electron/connected/SovereignMemory';
import { continuityHash, type TaskOperation } from '../../electron/connected/TaskContinuity';
import { SymbolMap, symbolContentHash } from '../../electron/dev/SymbolMap';
import type { ResultVerification, VerificationState } from '../../src/fabric/Verification';
import { registerCredentialValue } from '../../src/machine/CredentialBoundary';
import { safeContextText } from '../../src/fabric/ContinuityState';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-advancement-memory-unit-'));
const file = path.join(root, 'fabric.sqlite');
let db = new FabricDatabase(file), memory = new SovereignMemory(db), count = 0, receiptSeq = 0;
const now = 1_000_000, local = { locality: 'LOCAL' as const }, remote = { locality: 'REMOTE' as const, destination: 'https://fixture.invalid' };
const pass = (name: string) => { count++; console.log('PASS ' + name); };
const operation = (id: string, taskId: string, text: string, classification = 'GENERIC', status: TaskOperation['status'] = 'SUCCESS') => {
  db.writeCheckpointRecord(taskId, { dataClass: classification });
  const op: TaskOperation = { operationId: id, taskId, kind: 'INFERENCE', status, providerId: id.includes('second') ? 'llama-cpp-local' : 'ollama-local', model: 'fixture', inputHash: continuityHash('fixture'), checkpointRevision: 0, handoffHash: continuityHash('fixture'), handoff: 'fixture', text: safeContextText(text), failure: null, messageIds: [], startedAt: now - 100, finishedAt: now - 50 };
  db.writeOperationRecord(id, taskId, op); return op;
};
const receipt = (op: TaskOperation, state: VerificationState, opts: Partial<ResultVerification> = {}) => {
  const record: ResultVerification = { id: 'verification-' + ++receiptSeq, taskId: op.taskId, operationId: op.operationId, subjectHash: continuityHash(safeContextText(op.text!)), verifierId: 'builtin:TEXT_EXACT', verifierVersion: 1, category: 'TEXT_EXACT', criteriaHash: continuityHash('criteria'), state, strength: 'DETERMINISTIC', scope: 'Exact owned fixture text only', checks: [{ name: 'fixture', passed: state === 'VERIFIED' }], createdAt: now + receiptSeq, expiresAt: now + 10_000, policyRevision: 0, authorityEpoch: 0, ...opts };
  db.writeVerificationRecord(record); return record;
};
const retrieve = (taskId = 'invoice', query = 'invoice', destination = local, maxChars = 2400, at = now + 100) => memory.retrieve({ taskId, query, destination, maxChars, now: at });

const first = operation('first', 'invoice', 'invoice normalized fixture total 29');
receipt(first, 'PRODUCED'); memory.ingestOperation(first.operationId, () => {}, now + 20);
assert.equal(retrieve().references.length, 0);
assert.equal((db.memoryRecords('invoice')[0] as { state: string }).state, 'PRODUCED');
assert.throws(() => memory.ingestOperation('renderer-authored-message'), /MEMORY_SOURCE_NOT_PRODUCED/);
const failed = operation('failed', 'failed-task', 'invoice untrusted failed text', 'GENERIC', 'BLOCKED');
assert.throws(() => memory.ingestOperation(failed.operationId), /MEMORY_SOURCE_NOT_PRODUCED/);
pass('Inference text is persisted as PRODUCED, not recalled as a verified fact; arbitrary/failed sources cannot be promoted');

receipt(first, 'VERIFIED'); memory.ingestOperation(first.operationId, () => {}, now + 25);
const verified = retrieve(); assert.equal(verified.references.length, 1); assert.equal(verified.references[0]!.state, 'VERIFIED');
assert.equal(verified.budget.usedChars, verified.text.length); assert.ok(verified.text.length <= 2400);
assert.equal(memory.expand(verified.references[0]!, { taskId: 'invoice', destination: local, now: now + 100 }).text, first.text);
const second = operation('second-intelligence', 'invoice', 'invoice verified alternate result'); receipt(second, 'VERIFIED'); memory.ingestOperation(second.operationId, () => {}, now + 30);
assert.equal(retrieve().references.length, 2); assert.equal(db.memoryRecords('invoice').length, 2);
db.close(); db = new FabricDatabase(file); memory = new SovereignMemory(db);
assert.equal(retrieve().references.length, 2); pass('Real SQLite survives restart and retrieves scoped verification across two provider journal operations');

receipt(first, 'FAILED'); assert.equal(retrieve().references.some(ref => ref.sourceOperationId === first.operationId), false);
assert.throws(() => memory.expand(verified.references[0]!, { taskId: 'invoice', destination: local, now: now + 100 }), /STALE_OR_DENIED/);
receipt(first, 'VERIFIED'); receipt(first, 'PRODUCED'); assert.equal(retrieve().references.some(ref => ref.sourceOperationId === first.operationId), false);
receipt(first, 'VERIFIED', { strength: 'MODEL_REVIEW' }); assert.equal(retrieve().references.some(ref => ref.sourceOperationId === first.operationId), false);
receipt(first, 'VERIFIED', { verifierVersion: 2 }); assert.equal(retrieve().references.some(ref => ref.sourceOperationId === first.operationId), false);
receipt(first, 'VERIFIED', { verifierId: 'unknown-provider-self-verdict' }); assert.equal(retrieve().references.some(ref => ref.sourceOperationId === first.operationId), false);
receipt(first, 'VERIFIED', { createdAt: now + 200 }); assert.equal(retrieve().references.some(ref => ref.sourceOperationId === first.operationId), false);
pass('Latest failed/produced receipt supersedes older success; model agreement does not promote memory');

receipt(first, 'VERIFIED', { expiresAt: now + 50 }); assert.equal(retrieve().references.some(ref => ref.sourceOperationId === first.operationId), false);
assert.equal(retrieve('invoice', 'invoice', local, 2400, now + 8 * 24 * 3600 * 1000).references.length, 0);
assert.equal(retrieve('invoice', 'invoice', local, 2400, Number.NaN).references.length, 0);
assert.equal(retrieve('different-task').references.length, 0);
assert.equal(retrieve('invoice', 'invoice', local, 0).text, '');
assert.equal(retrieve('invoice', 'invoice', local, 350).references.length, 0);
assert.equal(retrieve('invoice', 'invoice" OR nonexistent*').references.length, 0);
assert.equal(memorySearchTerms('invoice" OR another*'), 'invoice OR another');
pass('Freshness/task boundaries fail closed; full metadata counts toward measured char budget; search grammar is literal');

const privateOp = operation('private', 'client-task', 'client invoice confidential fixture', 'CLIENT_DATA'); receipt(privateOp, 'VERIFIED'); memory.ingestOperation(privateOp.operationId, () => {}, now + 40);
assert.equal(memory.retrieve({ taskId: 'client-task', query: 'invoice', destination: remote, now: now + 100 }).references.length, 0);
assert.equal(memory.retrieve({ taskId: 'client-task', query: 'invoice', destination: { ...remote, clientDestinations: [remote.destination] }, now: now + 100 }).references.length, 1);
db.writeCheckpointRecord('client-task', { dataClass: 'LOCAL_ONLY' });
assert.equal(memory.retrieve({ taskId: 'client-task', query: 'invoice', destination: { ...remote, clientDestinations: [remote.destination] }, now: now + 100 }).references.length, 0);
memory.ingestOperation(privateOp.operationId, () => {}, now + 50); db.writeCheckpointRecord('client-task', { dataClass: 'GENERIC' });
assert.equal(memory.retrieve({ taskId: 'client-task', query: 'invoice', destination: remote, now: now + 100 }).references.length, 0);
pass('CLIENT_DATA requires an approved remote destination; privacy can strengthen but remembered context cannot declassify');

const secret = 'synthetic-memory-opaque-credential'; registerCredentialValue(secret);
const secretOp = operation('secret-boundary', 'secret-task', 'invoice observation ' + secret); receipt(secretOp, 'VERIFIED'); memory.ingestOperation(secretOp.operationId, () => {}, now + 55);
const secretRefs = memory.retrieve({ taskId: 'secret-task', query: 'invoice', destination: local, now: now + 100 });
assert.equal(secretRefs.references.length, 1); assert.ok(!JSON.stringify(db.memoryRecords('secret-task')).includes(secret));
assert.ok(!secretRefs.text.includes(secret)); assert.ok(!memory.expand(secretRefs.references[0]!, { taskId: 'secret-task', destination: local, now: now + 100 }).text.includes(secret));
secretOp.text = 'invoice source changed'; db.writeOperationRecord(secretOp.operationId, secretOp.taskId, secretOp);
assert.equal(memory.retrieve({ taskId: 'secret-task', query: 'invoice', destination: local, now: now + 100 }).references.length, 0);
assert.throws(() => memory.expand(secretRefs.references[0]!, { taskId: 'secret-task', destination: local, now: now + 100 }), /STALE_OR_DENIED/);
assert.throws(() => memory.ingestOperation(second.operationId, () => { throw Error('fixture revoked'); }, now + 100), /fixture revoked/);
pass('Known secrets are masked across SQLite/reference/recovery; changed bytes and revoked ingestion do not reuse verification');

const long = operation('long-result', 'budget-task', 'invoice ' + 'public checked observation '.repeat(230)); receipt(long, 'VERIFIED'); memory.ingestOperation(long.operationId, () => {}, now + 60);
for (let index = 0; index < 45; index++) {
  const other = operation('other-task-' + index, 'other-task-' + index, 'invoice'); receipt(other, 'VERIFIED'); memory.ingestOperation(other.operationId, () => {}, now + 60);
}
const start = performance.now(), limited = memory.retrieve({ taskId: 'budget-task', query: 'invoice', destination: local, maxChars: 1500, now: now + 100 });
assert.equal(limited.references.length, 1); assert.equal(limited.budget.candidates, 1);
assert.ok(limited.text.length < long.text!.length / 4); assert.ok(limited.budget.usedChars <= 1500);
assert.equal(memory.expand(limited.references[0]!, { taskId: 'budget-task', destination: local, maxChars: 12000, now: now + 100 }).text, long.text);
console.log('MEMORY_CONTEXT_METRICS ' + JSON.stringify({ rawChars: long.text!.length, retrievedChars: limited.budget.usedChars, candidates: limited.budget.candidates, selected: limited.budget.selected, retrievalMs: Number((performance.now() - start).toFixed(3)), charReduction: Number((1 - limited.budget.usedChars / long.text!.length).toFixed(4)) }));
pass('Task filtering occurs before FTS LIMIT; bounded previews reduce measured context without losing checked raw recovery');

const content = 'export function invoiceTotal(items: number[]) { return items.length; }\nconst marker = "invoiceTotal"; // invoiceTotal\nfunction shadow() { const invoiceTotal = 7; return invoiceTotal; }\nconst actual = invoiceTotal([]);';
const hash = symbolContentHash(content), map = new SymbolMap([{ file: 'src/invoice.ts', content, sha256: hash }]);
map.assertFresh({ 'src/invoice.ts': hash });
const refs = map.references('src/invoice.ts', content.lastIndexOf('invoiceTotal'), hash);
assert.equal(refs.length, 2); assert.ok(refs.every(ref => ref.file === 'src/invoice.ts' && ref.sha256 === hash));
const defs = map.definitions('src/invoice.ts', content.lastIndexOf('invoiceTotal'), hash); assert.equal(defs.length, 1); assert.equal(defs[0]!.line, 1);
assert.ok((content.match(/invoiceTotal/g) ?? []).length > refs.length);
assert.equal(map.references('src/invoice.ts', content.indexOf('invoiceTotal = 7'), hash).length, 2);
pass('TypeScript symbol identity ignores comments/strings and separates a shadowed declaration from actual references');

const dependency = 'export function sameTask() { return 42; }', caller = 'import { sameTask as next } from "./owner"; export const result = next();';
const linked = new SymbolMap([{ file: 'owner.ts', content: dependency, sha256: symbolContentHash(dependency) }, { file: 'caller.ts', content: caller, sha256: symbolContentHash(caller) }]);
assert.equal(linked.definitions('caller.ts', caller.lastIndexOf('next'), symbolContentHash(caller))[0]!.file, 'owner.ts');
assert.ok(linked.references('caller.ts', caller.lastIndexOf('next'), symbolContentHash(caller)).some(ref => ref.file === 'owner.ts'));
const budgeted = linked.repositoryMap('sameTask', 130, 2); assert.ok(budgeted.chars <= 130); assert.equal(budgeted.chars, budgeted.text.length); assert.ok(budgeted.symbols.length <= 2);
assert.throws(() => map.assertFresh({ 'src/invoice.ts': symbolContentHash(content + ' ') }), /STALE/);
assert.throws(() => map.assertFresh({}), /STALE/); assert.throws(() => map.assertFresh({ 'src/invoice.ts': hash, 'added.ts': hash }), /STALE/);
assert.throws(() => map.definitions('src/invoice.ts', 0, '0'.repeat(64)), /STALE/);
pass('Closed owned files resolve import aliases and expose bounded repository maps; changed/added/deleted snapshots invalidate semantic results');

for (const denied of ['../escape.ts', 'node_modules/vendor.ts', '.env', 'C:/outside.ts']) assert.throws(() => new SymbolMap([{ file: denied, content, sha256: hash }]), /DENIED/);
assert.throws(() => new SymbolMap([{ file: 'bad.ts', content, sha256: '0'.repeat(64) }]), /HASH_MISMATCH/);
assert.throws(() => new SymbolMap(Array.from({ length: 129 }, (_, index) => ({ file: index + '.ts', content, sha256: hash }))), /FILE_BUDGET/);
assert.equal(map.repositoryMap('invoice', 0, 0).text, '');
pass('Symbol service never crawls disk/loads configs/plugins and rejects escaped, ignored, secret, stale-hash or over-budget input');

db.close(); console.log('ADVANCEMENT_MEMORY_CODE_PASS ' + count);
