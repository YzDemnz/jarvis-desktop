import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ACPTransport } from '../../src/intelligence/transports/acp/ACPTransport';
import { ACPProcessManager } from '../../src/intelligence/transports/acp/ACPProcessManager';
import { ACPPermissionBridge } from '../../src/intelligence/transports/acp/ACPPermissionBridge';
import { ACPSessionManager } from '../../src/intelligence/transports/acp/ACPSessionManager';
import { ACPAgentProvider } from '../../src/intelligence/transports/acp/ACPAgentProvider';
import { ExternalComponentRegistry } from '../../src/intelligence/lab/ExternalComponentRegistry';
import { MCPFabric, MCPServerRegistry, MCPConnectionManager } from '../../src/intelligence/mcp/MCPFabric';
import { ExperimentalContextAdapter } from '../../src/intelligence/lab/ExperimentalContextAdapter';
import { ContextBudgetManager, HandoffContextBuilder } from '../../src/fabric/ContextBudgetManager';
import { ConversationLedger } from '../../src/fabric/ConversationLedger';
import { UsageLedger } from '../../src/fabric/UsageLedger';
import { LedgerMapping } from '../../src/intelligence/lab/LedgerMapping';
import type { ConversationMessage } from '../../src/fabric/types';
import { tempLab, harness, fakeProfile, repo } from './lab-harness';
const root = tempLab(); const project = path.join(root, 'project'); fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'package.json'), '{"name":"lab","scripts":{"test":"node test.cjs"}}');
fs.writeFileSync(path.join(project, 'sum.ts'), 'export const sum = (a: number, b: number) => a - b;\n');
fs.writeFileSync(path.join(project, 'test.cjs'), "const fs=require('fs');if(!fs.readFileSync('sum.ts','utf8').includes('a + b'))process.exit(1);\n");
const h = await harness(root); await h.broker.execute({ runId: h.runId, toolId: 'project.open', args: { project: 'lab' } });
let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`PASS ${name}`); }
const processManager = new ACPProcessManager(fakeProfile(), project, path.join(repo, 'tools/intelligence-lab/supervisor.mjs'));
const bridge = new ACPPermissionBridge(h.broker, h.runId);
const transport = new ACPTransport(processManager, bridge, 3000);
const sessions = new ACPSessionManager(transport);
try {
  await check('fake initialize/auth state', async () => { const init = await transport.connect(); assert.equal(init.protocolVersion, 1); assert.equal(init.authMethods?.[0]?.id, 'fake'); await transport.connection!.authenticate({ methodId: 'fake' }); });
  const session = await sessions.create('jarvis-conversation');
  await check('session ownership and resume', async () => { assert.notEqual(session.sessionId, 'jarvis-conversation'); await sessions.resume('jarvis-conversation', session.sessionId); });
  await check('prompt/stream/context usage', async () => { assert.equal((await transport.prompt(session.sessionId, 'hello')).stopReason, 'end_turn'); assert.ok(transport.events.events.some(e => e.text?.includes('sum'))); assert.equal(transport.events.events.at(-1)?.contextUsed, 17); });
  await check('deny external raw execution', async () => { await transport.prompt(session.sessionId, 'permission'); assert.deepEqual(bridge.denied, ['external-shell']); });
  await check('STOP preserves healthy process', async () => { const pending = transport.prompt(session.sessionId, 'wait'); await new Promise(r => setTimeout(r, 80)); await transport.cancel(session.sessionId); assert.equal((await pending).stopReason, 'cancelled'); assert.ok(processManager.health()); await transport.prompt(session.sessionId, 'again'); });
  await check('expired session', async () => { await assert.rejects(sessions.resume('jarvis-conversation', 'expired')); });
  await check('malformed event ignored', () => { assert.equal(transport.events.accept({ update: {} } as never), null); assert.equal(transport.events.malformed, 1); });
  await check('read and patch through production broker', async () => {
    assert.match(await bridge.read('sum.ts'), /a - b/);
    const patch = await h.broker.execute({ runId: h.runId, toolId: 'file.patch', args: { path: 'sum.ts', ops: [{ kind: 'edit', edit: { oldText: 'a - b', newText: 'a + b' } }] } });
    assert.equal(patch.ok, true, patch.error); assert.ok(h.dev.files.changes.get(h.runId)?.changes.length);
    const test = await h.broker.execute<{ exitCode: number }>({ runId: h.runId, toolId: 'terminal.execute', args: { executable: 'node', args: ['test.cjs'] } });
    assert.equal(test.ok, true, test.error); assert.equal(test.data?.exitCode, 0);
  });
  await check('create/write/rename/trash mediated', async () => {
    for (const [toolId, args] of [ ['file.create', { path: 'new.txt', content: 'fixture' }], ['file.read', { path: 'new.txt' }], ['file.write', { path: 'new.txt', content: 'changed' }], ['file.rename', { path: 'new.txt', to: 'renamed.txt' }], ['file.trash', { path: 'renamed.txt' }] ] as const) {
      const r = await h.broker.execute({ runId: h.runId, toolId, args }); assert.ok(r.ok, r.error);
    }
    assert.ok(!fs.existsSync(path.join(project, 'renamed.txt'))); assert.ok(fs.readdirSync(path.join(root, 'trash')).length);
  });
  await check('traversal and invalid patch do not mutate', async () => {
    const before = fs.readFileSync(path.join(project, 'sum.ts'), 'utf8');
    assert.equal((await h.broker.execute({ runId: h.runId, toolId: 'file.write', args: { path: '../../outside.txt', content: 'bad' } })).ok, false);
    assert.equal((await h.broker.execute({ runId: h.runId, toolId: 'file.patch', args: { path: 'sum.ts', ops: [{ kind: 'edit', edit: { oldText: 'missing', newText: 'bad' } }] } })).ok, false);
    assert.equal(fs.readFileSync(path.join(project, 'sum.ts'), 'utf8'), before);
  });
  await check('terminal raw shell denied', async () => { assert.equal((await h.broker.execute({ runId: h.runId, toolId: 'terminal.execute', args: { executable: 'powershell.exe', args: ['-Command', 'Remove-Item /'] } })).ok, false); });
  await check('PAUSE_EXECUTION gates calls, not provider', async () => {
    h.broker.pauseRun(h.runId); let done = false; const pending = bridge.read('sum.ts').then(() => { done = true; });
    await new Promise(r => setTimeout(r, 60)); assert.equal(done, false); h.broker.resumeRun(h.runId); await pending;
  });
  await check('crash recovery', async () => { await assert.rejects(transport.prompt(session.sessionId, 'crash')); await transport.connect(); const next = await sessions.create('restart'); await transport.prompt(next.sessionId, 'hello'); });
  await check('oversized wire frame retires process safely', async () => { await assert.rejects(transport.prompt((await sessions.create('oversize')).sessionId, 'oversize')); await transport.close(); await transport.connect(); });
  await check('timeout retires unhealthy process', async () => { await assert.rejects(transport.deadline(transport.prompt((await sessions.create('timeout')).sessionId, 'hang'), 100), /timeout/); await transport.close(); });
  await check('version mismatch', async () => { const p = new ACPProcessManager(fakeProfile(['--mismatch']), project); const t = new ACPTransport(p, bridge); await assert.rejects(t.connect(), /version mismatch/); await t.close(); });
  await check('auth required', async () => { const p = new ACPProcessManager(fakeProfile(['--auth']), project); const t = new ACPTransport(p, bridge); const s = new ACPSessionManager(t); try { await t.connect(); await assert.rejects(s.create('auth')); assert.equal(s.authState, 'AUTH_REQUIRED'); } finally { await t.close(); } });
  await check('experimental provider only', () => { assert.equal(new ACPAgentProvider(transport).experimentalProvider, true); });
  await check('provider streaming and busy guard', async () => {
    const provider = new ACPAgentProvider(transport); let output = '';
    for await (const chunk of provider.stream({ taskId: 'stream', prompt: 'hello' })) output += chunk;
    assert.match(output, /Retained fact/);
    const first = provider.execute({ taskId: 'pending', prompt: 'wait' });
    await assert.rejects(provider.execute({ taskId: 'other', prompt: 'hello' }), /busy/);
    await new Promise(r => setTimeout(r, 100)); await provider.cancel('pending'); await assert.rejects(first);
    assert.ok(processManager.health());
  });
  await check('component mismatch detection without update', () => { const registry = new ExternalComponentRegistry(); registry.register({ component: 'fake', installedVersion: '2', testedVersion: '1', protocolVersion: '1', compatibleRange: '=1', lastSuccessfulValidation: null }); assert.equal(registry.compatible('fake'), false); assert.throws(() => registry.validated('fake')); });
  await check('MCP harmless tool mediated; risk escalation denied', async () => {
    const registry = new MCPServerRegistry(); registry.register('fake', [{ name: 'read', description: 'Fake read', risk: 'SAFE', brokerTool: 'file.read' }, ...(['SENSITIVE', 'DESTRUCTIVE', 'CRITICAL'] as const).map(risk => ({ name: risk, description: '', risk, brokerTool: 'file.read' }))]);
    const mcp = new MCPFabric(registry, h.broker); assert.ok((await mcp.call('fake', 'read', { path: 'sum.ts' }, h.runId, 'ADMIN')).ok);
    for (const risk of ['SENSITIVE', 'DESTRUCTIVE', 'CRITICAL']) await assert.rejects(mcp.call('fake', risk, {}, h.runId, 'ADMIN'));
    assert.throws(() => registry.register('fake', []));
  });
  await check('lease reference count and grace shutdown', async () => {
    let starts = 0, stops = 0; const manager = new MCPConnectionManager(async () => { starts++; }, async () => { stops++; });
    const [a, b] = await Promise.all([manager.leases.acquire(), manager.leases.acquire()]); assert.equal(starts, 1); a(); a(); assert.equal(manager.leases.leases, 1); b();
    await new Promise(r => setTimeout(r, 300)); assert.equal(stops, 1); await manager.leases.dispose();
  });
  const messages: ConversationMessage[] = []; const records: any[] = [];
  const ledger = new ConversationLedger({ appendMessage: m => messages.push(m), messagePage: () => messages.map((message, seq) => ({ message, seq })).reverse(), saveTask: () => {}, task: () => null });
  const usage = new UsageLedger({ recordUsage: u => records.push(u), usagePage: () => records, setQuota: () => {}, quota: () => ({ used: null, remaining: null, state: 'UNKNOWN', source: 'UNKNOWN' } as never) });
  await check('ledgers external identity and unknown quota', () => {
    const map = new LedgerMapping(ledger, usage);
    map.record({ conversationId: '42', taskId: 'task', provider: 'codex-fake', agent: 'ACP', model: null, session: 'A', text: 'sum must add', routingId: 'route', artifacts: ['sum.ts'], tools: ['file.patch'] }, { input: 12, output: 6, source: 'OBSERVED' });
    map.record({ conversationId: '42', taskId: 'task', provider: 'mock', agent: 'mock', model: null, session: 'B', text: 'retained', routingId: 'route2', artifacts: [], tools: [] });
    assert.equal(records.length, 2); assert.equal(messages.length, 2); assert.equal(usage.quota('codex-fake', null, 'SUBSCRIPTION_PERCENT').state, 'UNKNOWN');
    assert.notEqual(messages[0]!.contextRefs[1], messages[1]!.contextRefs[1]);
    const handoff = new HandoffContextBuilder().build({ taskId: 'task', conversationId: '42', goal: 'repair', currentTask: 'sum', findings: ['sum must add'], instructions: [], decisions: [], artifacts: [], openQuestions: [], pendingSteps: [], updatedAt: Date.now() }, messages, 8192, 8192);
    assert.ok(handoff.findings.includes('sum must add')); assert.ok(!JSON.stringify(handoff.findings).includes('external-session'));
  });
  await check('compaction A/B bounded facts', () => {
    const history = Array.from({ length: 40 }, (_, i) => ({ ...messages[0], messageId: String(i), taskId: `task-${Math.floor(i / 2)}`, role: i % 2 ? 'tool' : 'assistant', content: i === 0 ? 'sum must add' : 'noise '.repeat(1000) } as ConversationMessage));
    const current = new ContextBudgetManager().select(history, 4096, 4096);
    const experimental = new ExperimentalContextAdapter().select(history, 4096, ['sum must add']);
    assert.ok(experimental.estimatedTokens <= experimental.budget); assert.ok(experimental.retainedFacts.includes('sum must add'));
    fs.mkdirSync(path.join(repo, 'docs/evidence/phase-a'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/evidence/phase-a/context-ab.json'), JSON.stringify({ sameInputHistory: true, factSource: 'oldest message in the same history', current: { tokens: current.estimatedTokens, messages: current.selected.length, factsRetained: current.selected.filter(m => m.content.includes('sum must add')).length }, experimental: { tokens: experimental.estimatedTokens, messages: experimental.selected.length, factsRetained: experimental.retainedFacts.length }, taskCompletion: 'NOT_MEASURED_SYNTHETIC_CONTEXT_ONLY', conclusion: 'No quality or completion advantage established' }, null, 2));
  });
  console.log(`${passed} Phase A contract groups PASS`);
} finally { await transport.close(); await processManager.leases.dispose(); h.broker.closeRun(h.runId); await h.dev.cancelRun(h.runId); console.log(`TEMP evidence: ${root}`); }
