import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { harness, tempLab } from '../intelligence-lab/lab-harness';
import { BrokeredProposeBackend, brokeredProposePolicy, selectBrokeredMode } from '../../src/execution/BrokeredModes';
import type { BrokeredModelPort } from '../../src/execution/backends/BrokeredBackend';
import type { ExecutionRequest } from '../../src/execution/types';
import type { ProjectTrustDecision } from '../../src/execution/ProjectTrustService';

const root = tempLab(); const project = path.join(root, 'proposal-only'); fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'sum.js'), 'module.exports.sum = (a, b) => a - b;\n');
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'proposal-only', scripts: { test: 'node test.cjs' } }));
fs.writeFileSync(path.join(project, 'test.cjs'), "require('fs').writeFileSync('executed.marker','yes');process.exit(1);\n");
const h = await harness(root, 'ef2a-propose', { allowTerminal: true });
const original = fs.readFileSync(path.join(project, 'sum.js'), 'utf8');
const model: BrokeredModelPort = { async next(_request, history) {
  if (history.length === 0) return { toolId: 'file.read', args: { project, path: 'sum.js' } };
  if (history.length === 1) return { toolId: 'file.proposePatch', args: { project, path: 'sum.js',
    ops: [{ kind: 'edit', edit: { oldText: 'a - b', newText: 'a + b' } }] } };
  if (history.length === 2) return { toolId: 'terminal.execute', args: { project, executable: 'npm', args: ['test'], cwd: project } };
  return null;
} };
const request: ExecutionRequest = { runId: h.runId, conversationId: 'ef2a', task: 'CODING_WITH_SHELL', prompt: 'propose only',
  providerId: 'fake-model', agentId: 'fake', projectRoot: project, requiredTrust: null, requireShell: false,
  allowProposalFallback: true };
try {
  assert.equal((await h.broker.execute({ runId: h.runId, toolId: 'project.open', args: { project } })).ok, true);
  const backend = new BrokeredProposeBackend(h.broker, model);
  const session = await backend.createSession(request);
  const output = await backend.execute(session, request);
  assert.equal(output.status, 'PARTIAL');
  assert.equal(output.audit.length, 3);
  assert.ok(output.audit.every(a => a.brokerAuditId));
  const audits = h.broker.audit.list(h.runId);
  assert.ok(audits.some(a => a.tool === 'terminal.execute' && a.result === 'blocked' && a.error?.includes('TOOL_BLOCKED')));
  assert.equal(fs.readFileSync(path.join(project, 'sum.js'), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(project, 'executed.marker')), false);
  assert.ok((await backend.collectDiff(session))?.kind === 'DIFF');

  const detach = h.broker.addPolicy(brokeredProposePolicy(h.runId));
  try {
    for (const call of [
      { toolId: 'terminal.execute', args: { project, executable: 'npm', args: ['install'], cwd: project } },
      { toolId: 'process.start', args: { project, executable: 'npm', args: ['run', 'dev'], cwd: project } },
      { toolId: 'file.patch', args: { project, path: 'sum.js', ops: [{ kind: 'edit', edit: { oldText: 'a - b', newText: 'a + b' } }] } },
    ]) {
      const result = await h.broker.execute({ runId: h.runId, toolId: call.toolId, args: call.args });
      assert.equal(result.ok, false, call.toolId);
      assert.equal(result.reason, 'policy_blocked', call.toolId);
      assert.match(result.error ?? '', /^TOOL_BLOCKED:BROKERED_PROPOSE:/);
    }
  } finally { detach(); }
  const trust = (state: ProjectTrustDecision['state']): ProjectTrustDecision => ({ state,
    canonicalRoot: project, projectIdentity: 'fixture', source: null, reason: 'fixture' });
  assert.equal(selectBrokeredMode(trust('TRUSTED')), 'BROKERED_PROPOSE');
  assert.equal(selectBrokeredMode(trust('UNKNOWN'), 'BROKERED_SCRATCH_APPLY'), 'BROKERED_PROPOSE');
  assert.equal(selectBrokeredMode(trust('UNTRUSTED'), 'BROKERED_SCRATCH_APPLY'), 'BROKERED_PROPOSE');
  assert.equal(selectBrokeredMode(trust('TRUSTED'), 'BROKERED_SCRATCH_APPLY'), 'BROKERED_SCRATCH_APPLY');
  console.log('PASS EF-2A brokered propose: read/propose allowed, execution/mutation TOOL_BLOCKED and audited');
} finally { h.broker.closeRun(h.runId); fs.rmSync(root, { recursive: true, force: true }); }
