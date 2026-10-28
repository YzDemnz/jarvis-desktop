import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SecureAgentBridge, type AgentToolRequest, type BridgeMode } from '../../src/intelligence/bridge/SecureAgentBridge';
import { BypassDetector } from '../../src/intelligence/bridge/BypassDetector';
import { ACPPermissionBridge } from '../../src/intelligence/transports/acp/ACPPermissionBridge';
import { ACPProcessManager } from '../../src/intelligence/transports/acp/ACPProcessManager';
import { ACPTransport } from '../../src/intelligence/transports/acp/ACPTransport';
import { ACPSessionManager } from '../../src/intelligence/transports/acp/ACPSessionManager';
import { CancellationToken } from '../../src/agent/cancellation';
import { harness, tempLab, fakeProfile, repo } from './lab-harness';

const root = tempLab(); const project = path.join(root, 'fixture');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'sum.ts'), 'export const sum = (a: number, b: number) => a - b;\n');
fs.writeFileSync(path.join(project, '.env'), 'CANARY_SECRET=never-disclose-this-value\n');
fs.writeFileSync(path.join(project, 'ordinary.ts'), 'export const API_KEY="never-disclose-this-value";\n');
fs.writeFileSync(path.join(project, 'niño.ts'), 'export const niño = 1;\n');
fs.writeFileSync(path.join(project, 'large.txt'), 'x'.repeat(40_000));
fs.writeFileSync(path.join(project, 'package.json'), '{"name":"bridge-fixture","scripts":{"test":"node test.cjs"}}');
fs.writeFileSync(path.join(project, 'test.cjs'), "const fs=require('fs'); if (!fs.readFileSync('sum.ts','utf8').includes('a + b')) process.exit(1);\n");
execFileSync('git', ['init', '-q'], { cwd: project, windowsHide: true });
const h = await harness(root, 'bridge-run');
await h.broker.execute({ runId: h.runId, toolId: 'project.open', args: { project: 'bridge-fixture' } });
let passed = 0;
const check = async (name: string, fn: () => Promise<void> | void) => { await fn(); passed++; console.log(`PASS ${name}`); };
const bridges = (mode: BridgeMode) => new SecureAgentBridge(h.broker, h.dev, h.runId, project, mode);
const base = (tool: string, args: unknown): AgentToolRequest => ({ requestId: `r-${Math.random()}`, provider: 'codex-fake', agent: 'acp', session: 's', tool,
  operation: tool, arguments: args, cwd: project, projectRoot: project, risk: 'SAFE', reason: 'temporary coding test', timestamp: Date.now() });
const ro = bridges('READ_ONLY'); const proposal = bridges('PROPOSAL'); const controlled = bridges('CONTROLLED');
const effects = new BypassDetector(project);
try {
  await check('read routes to authoritative broker and correlates audit', async () => {
    const result = await ro.request(base('filesystem.read', { path: 'sum.ts' }));
    assert.equal(result.status, 'OK', result.error ?? ''); assert.match(result.output, /a - b/);
    const entry = ro.audit.at(-1)!; assert.equal(entry.correlationId, result.auditId);
    assert.ok(entry.brokerAuditId); assert.ok(h.broker.audit.list(h.runId).some(e => e.id === entry.brokerAuditId && e.tool === 'file.read'));
  });
  await check('generic ACP client fs uses same secure bridge; write is denied', async () => {
    const acp = new ACPPermissionBridge(h.broker, h.runId, ro);
    assert.match(await acp.read('sum.ts'), /a - b/);
    await assert.rejects(acp.write('sum.ts', 'direct overwrite'), /UNMAPPED_EXTERNAL_TOOL/);
    assert.match(fs.readFileSync(path.join(project, 'sum.ts'), 'utf8'), /a - b/);
  });
  await check('ACP SDK fake agent client fs reaches secure bridge over transport', async () => {
    const p = new ACPProcessManager(fakeProfile(), project, path.join(repo, 'tools/intelligence-lab/supervisor.mjs'));
    const transport = new ACPTransport(p, new ACPPermissionBridge(h.broker, h.runId, ro), 5000);
    try {
      await transport.connect(); const session = await new ACPSessionManager(transport).create('bridge-fixture');
      assert.equal((await transport.prompt(session.sessionId, 'secure-read')).stopReason, 'end_turn');
      assert.ok(transport.events.events.some(e => e.text?.includes('a - b')));
      await transport.prompt(session.sessionId, 'secure-write-denied');
      assert.ok(transport.events.events.some(e => e.text === 'denied'));
      assert.match(fs.readFileSync(path.join(project, 'sum.ts'), 'utf8'), /a - b/);
    } finally { await transport.close(); await p.leases.dispose(); }
  });
  await check('default deny unknown, shell, destructive git, browser and malformed', async () => {
    for (const tool of ['shell', 'exec anything', 'git.push', 'git.reset', 'browser.navigate', 'windows.anything', 'env.get', 'toString', 'constructor', '__proto__']) {
      const result = await ro.request(base(tool, {})); assert.equal(result.status, 'DENIED'); assert.equal(result.error, 'UNMAPPED_EXTERNAL_TOOL');
    }
    assert.equal((await ro.request(base('filesystem.read', null))).status, 'DENIED');
  });
  await check('credential boundary and path escapes', async () => {
    for (const p of ['.env', '../../outside.txt', path.join(os.homedir(), '.codex', 'auth.json')])
      assert.equal((await ro.request(base('filesystem.read', { path: p }))).status, 'DENIED');
    assert.ok(!JSON.stringify(ro.audit).includes('never-disclose-this-value'));
    assert.ok(!JSON.stringify(ro.audit).includes('auth.json'));
    const ordinary = await ro.request(base('filesystem.read', { path: 'ordinary.ts' }));
    assert.equal(ordinary.status, 'OK'); assert.equal(ordinary.redacted, true);
    assert.ok(!JSON.stringify(ordinary).includes('never-disclose-this-value'));
    assert.equal((await ro.request(base('filesystem.read', { path: 'niño.ts' }))).status, 'OK');
    if (process.platform === 'win32') assert.equal((await ro.request(base('filesystem.read', { path: 'NIÑO.TS' }))).status, 'OK');
    const large = await ro.request(base('filesystem.read', { path: 'large.txt' }));
    assert.equal(large.status, 'OK'); assert.equal(large.truncated, true); assert.ok(large.output.length <= 16_384);
  });
  await check('symlink and junction escape denied when supported', async () => {
    const link = path.join(project, 'escape');
    try { fs.symlinkSync(os.homedir(), link, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch { console.log('NOT_AVAILABLE symlink/junction privilege'); return; }
    try { assert.equal((await ro.request(base('filesystem.read', { path: 'escape/.codex/auth.json' }))).status, 'DENIED'); }
    finally { fs.unlinkSync(link); }
  });
  await check('proposal computes without writing; controlled patch writes through ChangeSet', async () => {
    const args = { path: 'sum.ts', ops: [{ kind: 'edit', edit: { oldText: 'a - b', newText: 'a + b' } }] };
    assert.equal((await ro.request(base('file.proposePatch', args))).status, 'DENIED');
    const before = fs.readFileSync(path.join(project, 'sum.ts'), 'utf8');
    const proposed = await proposal.request(base('file.proposePatch', args)); assert.equal(proposed.status, 'OK', proposed.error ?? '');
    assert.equal(fs.readFileSync(path.join(project, 'sum.ts'), 'utf8'), before);
    assert.equal((await proposal.request(base('file.patch', args))).status, 'DENIED');
    const applied = await controlled.request(base('file.patch', args)); assert.equal(applied.status, 'OK', applied.error ?? '');
    assert.match(fs.readFileSync(path.join(project, 'sum.ts'), 'utf8'), /a \+ b/);
    assert.ok(h.dev.files.changes.get(h.runId)?.changes.length);
    assert.deepEqual(effects.verify(['sum.ts'], controlled.audit).bypass, []);
  });
  await check('direct persistent write without matching broker audit is security failure', async () => {
    fs.writeFileSync(path.join(project, 'rogue.txt'), 'direct effect');
    assert.deepEqual(effects.verify(['sum.ts'], controlled.audit).bypass, ['rogue.txt']);
  });
  await check('terminal fixed command only; execution audited', async () => {
    const version = await ro.request(base('terminal.nodeVersion', {}));
    assert.equal(version.status, 'OK', version.error ?? ''); assert.match(version.output, /v\d+\./);
    for (const args of [{ executable: 'cmd', args: ['/c', 'whoami'] }, { executable: 'npm', args: ['test', '&&', 'whoami'] },
      { executable: 'powershell', args: ['-Command', 'whoami'] }, { executable: 'node', args: ['-e', 'process.exit()'] },
      { executable: 'npm', args: ['test'], envSubset: { MY_TOKEN: 'never-disclose-this-value' } }]) {
      assert.equal((await controlled.request(base('terminal.runTests', args))).status, 'DENIED');
    }
    const tested = await controlled.request(base('terminal.runTests', { executable: 'npm', args: ['test'] }));
    assert.equal(tested.status, 'OK', tested.error ?? ''); assert.equal((tested.structuredData as { exitCode: number }).exitCode, 0);
    assert.ok(h.dev.commandLog.some(e => e.runId === h.runId && e.status === 'passed'));
  });
  await check('git status mapped; destructive git remains unmapped', async () => {
    assert.equal((await ro.request(base('git.status', {}))).status, 'OK');
    assert.equal((await ro.request(base('git.show', { ref: 'HEAD' }))).status, 'DENIED');
  });
  await check('pause holds next broker operation; resume releases it', async () => {
    assert.equal(controlled.pause(), true); let settled = false;
    const pending = controlled.request(base('filesystem.read', { path: 'sum.ts' })).then(r => { settled = true; return r; });
    await new Promise(r => setTimeout(r, 80)); assert.equal(settled, false);
    assert.equal(controlled.resume(), true); assert.equal((await pending).status, 'OK');
  });
  await check('STOP prevents further tool calls and leaves ledger/audit consistent', async () => {
    controlled.stop(); const after = await controlled.request(base('filesystem.read', { path: 'sum.ts' }));
    assert.equal(after.status, 'CANCELLED'); assert.equal(controlled.audit.at(-1)?.result, 'CANCELLED');
    assert.ok(!JSON.stringify(controlled.audit).includes('never-disclose-this-value'));
  });
  await check('STOP cancels active TerminalService command and future bridge requests', async () => {
    const stopRun = 'bridge-active-stop'; const token = new CancellationToken();
    h.broker.openRun(stopRun, 'ADMIN', token);
    await h.broker.execute({ runId: stopRun, toolId: 'project.open', args: { project: 'bridge-fixture' } });
    const originalTest = fs.readFileSync(path.join(project, 'test.cjs'), 'utf8');
    fs.writeFileSync(path.join(project, 'test.cjs'), 'setTimeout(() => process.exit(0), 10000);\n');
    const active = new SecureAgentBridge(h.broker, h.dev, stopRun, project, 'CONTROLLED');
    try {
      const pending = active.request(base('terminal.runTests', { executable: 'npm', args: ['test'] }));
      for (let i = 0; i < 30 && !h.dev.commandLog.some(e => e.runId === stopRun && e.status === 'running'); i++) await new Promise(r => setTimeout(r, 50));
      assert.ok(h.dev.commandLog.some(e => e.runId === stopRun && e.status === 'running'));
      active.stop(); assert.equal((await pending).status, 'CANCELLED');
      assert.equal((await active.request(base('filesystem.read', { path: 'sum.ts' }))).status, 'CANCELLED');
      assert.ok(!h.dev.commandLog.some(e => e.runId === stopRun && e.status === 'running'));
    } finally { fs.writeFileSync(path.join(project, 'test.cjs'), originalTest); h.broker.closeRun(stopRun); await h.dev.cancelRun(stopRun); }
  });
  await check('owned ACP process metadata and scoped cleanup', async () => {
    const process = new ACPProcessManager(fakeProfile(), project, path.join(repo, 'tools/intelligence-lab/supervisor.mjs'));
    try {
      await process.start(); const owned = process.ownership(h.runId, 'fake-session');
      assert.ok(owned.guardianPid && owned.processPid && owned.startedAt);
      assert.equal(owned.ownerComponent, 'fake'); assert.equal(owned.runId, h.runId);
    } finally { await process.stop(); await process.leases.dispose(); }
    assert.equal(process.ownership().processPid, null);
  });
  const evidence = { phase: 'A.5', status: 'PASS_WITH_RESTRICTIONS', testsPassed: passed,
    codexRealPrompt: 'NOT_RUN_SECURITY_GATE', nativeToolMediation: 'UNPROVEN',
    bridgeAudit: [...ro.audit, ...proposal.audit, ...controlled.audit],
    brokerAudit: h.broker.audit.list(h.runId).map(e => ({ id: e.id, stepId: e.stepId ?? null, tool: e.tool, action: e.action, result: e.result, risk: e.risk })),
    injectedDirectWriteDetected: effects.verify(['sum.ts'], controlled.audit).bypass.includes('rogue.txt') };
  assert.ok(!JSON.stringify(evidence).includes('never-disclose-this-value'));
  const evidenceDir = path.join(repo, 'docs', 'evidence', 'phase-a5'); fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'security-gates.json'), JSON.stringify(evidence, null, 2));
  console.log(`${passed} Phase A.5 secure bridge groups PASS`);
} finally { h.broker.closeRun(h.runId); await h.dev.cancelRun(h.runId); console.log(`TEMP fixture retained: ${root}`); }
