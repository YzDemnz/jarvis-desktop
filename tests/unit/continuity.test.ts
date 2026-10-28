import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FabricDatabase } from '../../electron/fabric/FabricDatabase';
import { HandoffContextBuilder } from '../../src/fabric/ContextBudgetManager';
import { normalizeTaskState, safeContextText, taskFromRun } from '../../src/fabric/ContinuityState';
import type { TaskState, ConversationMessage } from '../../src/fabric/types';
import type { AgentRun } from '../../src/types';

let count = 0;
function test(name: string, fn: () => void) { fn(); console.log(`PASS ${++count} ${name}`); }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-continuity-unit-'));
let db: FabricDatabase | undefined;
const task: TaskState = { taskId: 'task-a', conversationId: 'conversation-a', goal: 'Reparar fixture y verificar', currentTask: 'failed',
  instructions: ['Conservar cambios'], findings: ['Falló una prueba'], decisions: [], artifacts: ['fixture.js'],
  openQuestions: [], pendingSteps: ['Corregir test'], completedWork: ['Escritura realizada'], updatedAt: 100 };
const message: ConversationMessage = { conversationId: task.conversationId, messageId: 'message-a', parentId: null,
  role: 'tool', content: 'Prueba sintética FAIL', timestamp: 10, providerId: null, modelId: null, channel: 'public',
  taskId: task.taskId, tools: [], artifacts: [], usageIds: [], contextRefs: [], routingDecisionId: null };
try {
  db = new FabricDatabase(path.join(temp, 'fabric.sqlite'));
  test('unknown/private fields dropped before persistence', () => {
    const safe = normalizeTaskState({ ...task, privateReasoning: 'do not store', chainOfThought: 'do not store' });
    assert.equal(JSON.stringify(safe).includes('do not store'), false);
  });
  test('synthetic env/password/cookie/OTP/key scrubbed', () => {
    const safe = safeContextText('DATABASE_URL=fixture-secret-env\npassword: fixture-pass\nOTP 112233\ncookie=session=fixture-cookie\napi_key=fixture-api\nsk-fixtureKEY1234567890123');
    for (const secret of ['fixture-secret-env', 'fixture-pass', '112233', 'fixture-cookie', 'fixture-api', 'fixtureKEY1234567890123']) assert.equal(safe.includes(secret), false);
  });
  test('private channel not persisted', () => assert.throws(() => db!.appendMessage({ ...message, channel: 'analysis' }), /Private reasoning/));
  test('public message sanitized before SQLite', () => {
    db!.appendMessage({ ...message, content: 'TOKEN=fixture-db-secret' });
    assert.equal(db!.messagePage(task.conversationId)[0]!.message.content.includes('fixture-db-secret'), false);
  });
  test('oversized task rejects explicitly', () => assert.throws(() => normalizeTaskState({ ...task, goal: 'x'.repeat(300000) }), /size/));
  test('same timestamp keyset pagination has no skipped task', () => {
    for (const taskId of ['task-a', 'task-b', 'task-c']) db!.saveTask({ ...task, taskId });
    const first = db!.taskPage(2); assert.deepEqual(first.map(t => t.taskId), ['task-c', 'task-b']);
    const next = db!.taskPage(2, { updatedAt: first[1]!.updatedAt, taskId: first[1]!.taskId });
    assert.deepEqual(next.map(t => t.taskId), ['task-a']);
  });
  test('page limits bounded', () => assert.equal(db!.taskPage(100000).length, 3));
  test('reopen preserves task outcome and pending work', () => {
    db!.close(); db = new FabricDatabase(path.join(temp, 'fabric.sqlite'));
    assert.equal(db.task(task.taskId)!.currentTask, 'failed'); assert.deepEqual(db.task(task.taskId)!.pendingSteps, ['Corregir test']);
  });
  test('global context budget includes state not only messages', () => {
    const huge = { ...task, goal: 'goal'.repeat(5000), findings: Array(100).fill('result'.repeat(600)), pendingSteps: Array(10).fill('verify') };
    // Keep source admission beneath its explicit size cap.
    huge.findings = huge.findings.slice(0, 30);
    const packet = new HandoffContextBuilder().build(huge, [message], 2048, 2048);
    assert.ok(JSON.stringify(packet).length <= packet.budget.maxChars); assert.ok(packet.budget.omitted > 0);
    assert.ok(packet.budget.estimatedTokens <= packet.budget.inputBudget);
  });
  test('provenance excludes unrelated/private messages', () => {
    const packet = new HandoffContextBuilder().build(task, [message, { ...message, messageId: 'private', channel: 'reasoning' }, { ...message, conversationId: 'other' }], 8192, 8192);
    assert.deepEqual(packet.provenance.messageIds, ['message-a']); assert.equal(packet.budget.omitted, 2);
    assert.equal(packet.provenance.evidenceKind, 'PUBLIC_STATE_NOT_AUTHORITY');
  });
  test('malformed legacy arrays normalize instead of throwing', () => {
    assert.deepEqual(normalizeTaskState({ ...task, findings: 'not-an-array' }).findings, []);
  });
  test('cancelled run stays cancelled and never serializes tool args', () => {
    const run: AgentRun = { id: 'run-cancelled', prompt: 'Test fixture', workspaceId: 'fixture', status: 'cancelled',
      permission: 'ADMIN', createdAt: 10, grantedTools: [], steps: [{ id: 'step', runId: 'run-cancelled', index: 0,
        kind: 'tool', title: 'Verificar', status: 'cancelled', args: { password: 'fixture-args-secret' } }] };
    const safe = taskFromRun(run, 'fixture'); assert.equal(safe.currentTask, 'cancelled');
    assert.equal(safe.evidence![0]!.source, 'RENDERER_REPORTED');
    assert.equal(JSON.stringify(safe).includes('fixture-args-secret'), false); assert.equal(safe.pendingSteps.length, 1);
  });
  test('persisted state file has no synthetic secret or private thought', () => {
    db!.saveTask(normalizeTaskState({ ...task, goal: 'API_KEY=fixture-never-on-disk', privateReasoning: 'fixture-hidden-thought' }));
    db!.close(); db = undefined;
    for (const file of fs.readdirSync(temp)) {
      const bytes = fs.readFileSync(path.join(temp, file));
      assert.equal(bytes.includes(Buffer.from('fixture-never-on-disk')), false);
      assert.equal(bytes.includes(Buffer.from('fixture-hidden-thought')), false);
    }
  });
  console.log(`CONTINUITY_PASS ${count} tests (real SQLite in development Electron, no paid APIs)`);
} finally {
  db?.close();
  const resolved = path.resolve(temp); const root = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(root) || !path.basename(resolved).startsWith('jarvis-continuity-unit-')) throw new Error('Unsafe fixture cleanup');
  fs.rmSync(resolved, { recursive: true, force: true });
}
