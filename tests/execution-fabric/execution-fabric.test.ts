import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { harness, tempLab } from '../intelligence-lab/lab-harness';
import { ExecutionFabric } from '../../src/execution/ExecutionFabric';
import { ExecutionRouter } from '../../src/execution/ExecutionRouter';
import { executionPolicy } from '../../src/execution/ExecutionPolicy';
import { ExecutionLedger, JsonlExecutionStore } from '../../src/execution/ExecutionLedger';
import { BrokeredBackend, type BrokeredModelPort } from '../../src/execution/backends/BrokeredBackend';
import { WebIsolatedBackend } from '../../src/execution/backends/WebIsolatedBackend';
import { StrongLocalBackend } from '../../src/execution/backends/StrongLocalBackend';
import { ProviderNativeBackend } from '../../src/execution/backends/ProviderNativeBackend';
import { FullNativeBackend } from '../../src/execution/backends/FullNativeBackend';
import { LocalStrongDetector } from '../../src/execution/StrongLocalDetector';
import { FakeCredentialProxy, PackageRegistryProxy, SandboxGitProxy } from '../../src/execution/CredentialProxy';
import { validateExecutionArtifact } from '../../src/execution/ExecutionArtifactContract';
import type { ExecutionRequest } from '../../src/execution/types';

const root = tempLab(); const project = path.join(root, 'ef-fixture'); fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'ef-fixture', scripts: { test: 'node test.cjs' } }));
fs.writeFileSync(path.join(project, 'sum.js'), 'module.exports.sum = (a, b) => a - b;\n');
fs.writeFileSync(path.join(project, 'test.cjs'), "const {sum}=require('./sum'); if(sum(2,3)!==5) process.exit(1);\n");
fs.writeFileSync(path.join(project, '.env'), 'API_KEY=fixture-secret-never-release\n');
const h = await harness(root, 'ef-broker', { allowTerminal: true });
assert.equal((await h.broker.execute({ runId: h.runId, toolId: 'project.open', args: { project: 'ef-fixture' } })).ok, true);
const model: BrokeredModelPort = { async next(_request, history) {
  if (!history.length) return { toolId: 'file.read', args: { project: 'ef-fixture', path: 'sum.js' } };
  if (history.length === 1) {
    const read = history[0]?.data as { content?: string } | null;
    assert.match(read?.content ?? '', /a - b/);
    return { toolId: 'file.proposePatch', args: { project: 'ef-fixture', path: 'sum.js', ops: [{ kind: 'edit', edit: { oldText: 'a - b', newText: 'a + b' } }] } };
  }
  if (history.length === 2) return { toolId: 'file.patch', args: { project: 'ef-fixture', path: 'sum.js', ops: [{ kind: 'edit', edit: { oldText: 'a - b', newText: 'a + b' } }] } };
  if (history.length === 3) return { toolId: 'terminal.execute', args: { project: 'ef-fixture', executable: 'npm', args: ['test'], cwd: project } };
  return null;
} };
const brokered = new BrokeredBackend(h.broker, model);
const web = new WebIsolatedBackend();
const strong = new StrongLocalBackend({ async detect() { return { status: 'NOT_AVAILABLE', evidence: ['test fixture: no VM'] }; } });
const native = new ProviderNativeBackend('codex-native-fake', {
  providerId: 'codex', async probe() { return { available: true, evidence: ['fake provider contract'] }; },
  async run(session) { return { status: 'SUCCESS' as const, summary: 'fake native result', artifacts: [], audit: [], durationMs: 1, usageRecordIds: [`usage-${session.id}`] }; },
  async cancel() {}, async usage() { return { source: 'OBSERVED' as const, tokensIn: 4, tokensOut: 2, cost: null }; },
});
const full = new FullNativeBackend();
const ledgerFile = path.join(root, 'execution-ledger.jsonl');
const ledger = new ExecutionLedger(new JsonlExecutionStore(ledgerFile));
const fabric = new ExecutionFabric(new ExecutionRouter(), ledger);
for (const b of [brokered, web, strong, native, full]) fabric.register(b);
const request = (runId: string, task: ExecutionRequest['task']): ExecutionRequest => ({ runId, conversationId: 'conversation-ef', task,
  prompt: 'Find the bug, propose a patch and run the test', providerId: 'fake-model', agentId: 'brokered-poc', projectRoot: project,
  requiredTrust: null, requireShell: task === 'CODING_WITH_SHELL', allowProposalFallback: true });

try {
  const beforeEnv = fs.readFileSync(path.join(project, '.env'), 'utf8');
  const result = await fabric.dispatch(request(h.runId, 'DOCUMENT_ANALYSIS'), executionPolicy());
  assert.equal(result.route.realm, 'BROKERED'); assert.equal(result.result?.status, 'SUCCESS');
  const output = result.result!;
  assert.equal(output.audit.length, 4); assert.ok(output.audit.every(a => a.brokerAuditId));
  const brokerAudits = h.broker.audit.list(h.runId);
  assert.ok(output.audit.every(a => brokerAudits.some(b => b.id === a.brokerAuditId)));
  assert.ok(brokerAudits.some(a => a.tool === 'file.patch'));
  assert.ok(brokerAudits.some(a => a.tool === 'terminal.execute'));
  assert.match(fs.readFileSync(path.join(project, 'sum.js'), 'utf8'), /a \+ b/);
  assert.equal(fs.readFileSync(path.join(project, '.env'), 'utf8'), beforeEnv);
  assert.equal(ledger.run(h.runId)?.realm, 'BROKERED');
  assert.equal(new ExecutionLedger(new JsonlExecutionStore(ledgerFile)).run(h.runId)?.status, 'SUCCESS');
  assert.equal(ledger.events(h.runId).filter(e => e.kind === 'AUDIT').length, 4);
  assert.ok((await brokered.collectDiff(result.session!))?.kind === 'DIFF');
  await assert.rejects(fabric.dispatch(request(h.runId, 'DOCUMENT_ANALYSIS'), executionPolicy()), /ALREADY_EXISTS/);

  const probes = await fabric.probes();
  const router = new ExecutionRouter();
  assert.equal(router.route(request('untrusted', 'UNKNOWN_UNTRUSTED_AGENT'), executionPolicy(), probes).status, 'FAIL');
  assert.equal(router.route(request('untrusted', 'UNKNOWN_UNTRUSTED_AGENT'), executionPolicy('ADVANCED', { allowProviderNative: true }), probes).status, 'FAIL');
  const coding = router.route(request('coding', 'CODING_WITH_SHELL'), executionPolicy('ADVANCED', { allowProviderNative: true }), probes);
  assert.equal(coding.realm, 'PROVIDER_NATIVE');
  assert.equal(router.route(request('coding', 'CODING_WITH_SHELL'), executionPolicy(), probes).status, 'PROPOSAL_ONLY');
  assert.equal(router.route(request('native', 'CODING_WITH_SHELL'), executionPolicy('DEVELOPER', { explicitFullNative: true }), probes).realm, 'BROKERED');
  assert.equal(full.capabilities().trust, 'FULL_TRUST'); assert.equal((await full.probe()).status, 'NOT_AVAILABLE');
  assert.equal((await web.probe()).status, 'NOT_AVAILABLE'); assert.equal((await strong.probe()).status, 'NOT_AVAILABLE');

  const fakeWeb = new WebIsolatedBackend({ async probe() { return { available: true, evidence: ['fake virtual fs'] }; },
    async run() { return { summary: 'fake UI build', artifacts: [], durationMs: 1 }; }, async cancel() {} });
  assert.equal(router.route(request('ui', 'UI_GENERATION'), executionPolicy(), [await fakeWeb.probe(), await brokered.probe()]).realm, 'WEB_ISOLATED');
  const detector = new LocalStrongDetector({ windowsRoot: 'C:\\Windows', exists: () => false, command: () => false });
  assert.equal((await detector.detect()).status, 'NOT_AVAILABLE');
  assert.equal(detector.findings().find(f => f.id === 'WSL')?.status, 'NOT_AVAILABLE');

  const proxy = new FakeCredentialProxy(new Set(['https://example.test/repo']), new Set(['https://registry.example.test']));
  const git = new SandboxGitProxy(proxy); const pkg = new PackageRegistryProxy(proxy);
  assert.equal((await git.request('run', 'fetch', 'https://example.test/repo')).status, 'AUTHORIZED');
  assert.equal((await git.request('run', 'push proposal', 'https://example.test/repo')).status, 'PROPOSED');
  assert.equal((await git.request('run', 'clone', 'https://evil.example/repo')).status, 'DENIED');
  assert.equal((await pkg.request('run', 'metadata', 'https://registry.example.test')).status, 'AUTHORIZED');
  assert.ok(proxy.calls.every(c => !JSON.stringify(c).includes('fixture-secret-never-release')));
  validateExecutionArtifact(output.artifacts[0]!, h.runId);
  assert.throws(() => validateExecutionArtifact({ ...output.artifacts[0]!, uri: 'file:///C:/Users/test/secret' }, h.runId), /URI_UNTRUSTED/);
  assert.throws(() => validateExecutionArtifact({ ...output.artifacts[0]!, uri: 'C:/Users/test/secret' }, h.runId), /URI_UNTRUSTED/);
  assert.throws(() => validateExecutionArtifact({ ...output.artifacts[0]!, uri: '/Users/test/secret' }, h.runId), /URI_UNTRUSTED/);
  validateExecutionArtifact({ ...output.artifacts[0]!, uri: 'artifact://ef1-report' }, h.runId);
  const evidenceDir = path.resolve(process.env.JARVIS_EF_EVIDENCE_DIR ?? 'docs/evidence/ef1'); fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'brokered-poc.json'), JSON.stringify({ status: 'PASS', fixture: 'TEMP-only',
    model: 'DETERMINISTIC_FAKE', trust: 'TRUSTED_BROKERED', durationMs: output.durationMs,
    brokerToolEvents: output.audit.length, correlatedToolEvents: output.audit.filter(a => a.brokerAuditId && brokerAudits.some(b => b.id === a.brokerAuditId)).length,
    changedFiles: ['sum.js'], testPassed: true, hostCredentialFileUnchanged: fs.readFileSync(path.join(project, '.env'), 'utf8') === beforeEnv,
    cpuRamDisk: 'NOT_MEASURED', artifactKinds: output.artifacts.map(a => a.kind) }, null, 2));
  console.log('PASS EF-1 architecture/router/brokered POC/audit/ledger/proxy/artifact contracts');
} finally { h.broker.closeRun(h.runId); }
