import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AgentCapsuleManager } from '../../src/intelligence/capsule/AgentCapsuleManager';
import { AgentCapsuleImportGate } from '../../src/intelligence/capsule/AgentCapsuleImportGate';
import { capsulePath } from '../../src/intelligence/capsule/AgentCapsuleWorkspace';
import { capsulePolicy, validateCapsulePolicy } from '../../src/intelligence/capsule/AgentCapsulePolicy';
import { SecureAgentBridge } from '../../src/intelligence/bridge/SecureAgentBridge';
import { JarvisDynamicToolAdapter } from '../../src/intelligence/capsule/JarvisDynamicToolAdapter';
import { harness, tempLab } from './lab-harness';

const root = tempLab(); const project = path.join(root, 'capsule-fixture'); fs.mkdirSync(project);
const put = (name: string, content: string) => { const file = path.join(project, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
put('package.json', '{"name":"capsule-fixture"}'); put('sum.ts', 'export const sum = (a: number, b: number) => a - b;\n');
put('old.ts', 'old file\n'); put('delete.ts', 'obsolete file\n'); put('.env', 'API_KEY=real-canary-value-12345\n'); put('unsafe.ts', 'const token = "real-canary-value-12345";\n');
put('node_modules/lib/index.js', 'vendor'); put('dist/output.js', 'generated');
const before = fs.readFileSync(path.join(project, 'sum.ts'), 'utf8');
const projectHash = () => {
  const hash = createHash('sha256');
  const visit = (dir: string, prefix = ''): void => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) visit(path.join(dir, item.name), rel);
      else if (item.isFile()) { hash.update(rel); hash.update(fs.readFileSync(path.join(dir, item.name))); }
    }
  }; visit(project); return hash.digest('hex');
};
const untouchedHash = projectHash();
const h = await harness(root, 'capsule-import');
const manager = new AgentCapsuleManager(h.dev.guard);
await assert.rejects(manager.create({ project: path.dirname(root), runId: 'denied', conversationId: 'test', provider: 'fake', agent: 'fake' }));
const capsule = await manager.create({ project, runId: h.runId, conversationId: 'test-conversation', provider: 'fake', agent: 'fake' });
const m = capsule.manifest;
assert.equal(m.policy.network, 'OFF'); assert.ok(m.files['sum.ts']);
assert.ok(!m.files['.env'] && !m.files['unsafe.ts'] && !m.files['node_modules/lib/index.js']);
assert.ok(m.excluded.some(x => x.reason === 'CAPSULE_SECRET_EXCLUDED'));
assert.ok(capsule.audit.some(x => x.event === 'CAPSULE_SECRET_EXCLUDED'));
assert.ok(!fs.existsSync(path.join(m.workspace, '.env')));
assert.throws(() => capsulePath(m.workspace, '../outside'), /CAPSULE_PATH_DENIED/);
assert.throws(() => capsulePath(m.workspace, path.join(root, 'outside')), /CAPSULE_PATH_DENIED/);
for (const invalid of ['..\\outside', '\\\\server\\share\\file', 'D:\\outside', '.GIT/config', 'node_modules/x.js', 'file.ts:stream', 'CON']) {
  assert.throws(() => capsulePath(m.workspace, invalid), /CAPSULE_PATH_DENIED/);
}
assert.throws(() => validateCapsulePolicy({ ...capsulePolicy(), network: 'OPEN' }), /CAPSULE_NETWORK_OPEN/);
assert.throws(() => manager.processes.launch(m), /ISOLATION_UNAVAILABLE/);
assert.equal(fs.readFileSync(path.join(project, 'sum.ts'), 'utf8'), before);
assert.equal(projectHash(), untouchedHash, 'real project unchanged after denied process launch');
const link = path.join(m.workspace, 'escape');
try {
  fs.symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => manager.diff(m.capsuleId), /CAPSULE_UNSAFE_OUTPUT/);
  fs.unlinkSync(link);
} catch (error) { if (fs.existsSync(link)) throw error; }
fs.mkdirSync(path.join(m.workspace, '.GIT')); assert.throws(() => manager.diff(m.capsuleId), /CAPSULE_UNSAFE_OUTPUT/);
fs.rmdirSync(path.join(m.workspace, '.GIT'));
fs.writeFileSync(path.join(m.workspace, 'sum.ts'), 'export const sum = (a: number, b: number) => a + b;\n');
fs.writeFileSync(path.join(m.workspace, 'new.ts'), 'export const newValue = 1;\n');
fs.renameSync(path.join(m.workspace, 'old.ts'), path.join(m.workspace, 'renamed.ts'));
fs.unlinkSync(path.join(m.workspace, 'delete.ts'));
const diff = manager.diff(m.capsuleId);
assert.deepEqual(diff.changes.map(x => x.kind).sort(), ['added', 'deleted', 'modified', 'renamed']);
const gate = new AgentCapsuleImportGate(h.broker, h.dev);
assert.equal((await gate.preflight(m, diff)).ok, true);
assert.equal(fs.readFileSync(path.join(project, 'sum.ts'), 'utf8'), before);
assert.equal(projectHash(), untouchedHash, 'real project unchanged before import gate');
await assert.rejects(gate.apply(m, diff, false), /NOT_ACCEPTED/);
assert.equal(projectHash(), untouchedHash, 'real project unchanged after rejected import');
put('sum.ts', 'concurrent user edit\n');
const conflict = await gate.preflight(m, diff); assert.equal(conflict.ok, false); assert.ok(conflict.conflicts.some(x => x.includes('sum.ts')));
await assert.rejects(gate.apply(m, diff, true), /CAPSULE_IMPORT_REJECTED/);
assert.equal(fs.readFileSync(path.join(project, 'sum.ts'), 'utf8'), 'concurrent user edit\n');
put('sum.ts', before);
const applied = await manager.import(m.capsuleId, gate, true); assert.equal(applied.applied, 4);
assert.equal(capsule.status, 'IMPORTED');
assert.match(fs.readFileSync(path.join(project, 'sum.ts'), 'utf8'), /a \+ b/);
assert.ok(fs.existsSync(path.join(project, 'new.ts')) && fs.existsSync(path.join(project, 'renamed.ts')));
assert.ok(!fs.existsSync(path.join(project, 'delete.ts')));
assert.ok(h.dev.files.changes.get(h.runId)?.changes.length);
const revert = await h.dev.files.revertRun(h.runId); assert.equal(revert.conflicts.length, 0);
assert.equal(fs.readFileSync(path.join(project, 'sum.ts'), 'utf8'), before);
assert.ok(!fs.existsSync(path.join(project, 'new.ts')) && fs.existsSync(path.join(project, 'old.ts')));
assert.ok(fs.existsSync(path.join(project, 'delete.ts')));
assert.equal(projectHash(), untouchedHash, 'revert restores complete fixture hash');
const dynamic = new JarvisDynamicToolAdapter(new SecureAgentBridge(h.broker, h.dev, h.runId, project));
assert.deepEqual(dynamic.definitions().map(x => x.name), ['jarvis_read_real_resource']);
assert.equal((await dynamic.call('jarvis_read_real_resource', { path: 'sum.ts' })).status, 'OK');
await assert.rejects(dynamic.call('jarvis_browser_research', { url: 'https://example.com' }), /DYNAMIC_TOOL_DENIED/);
await assert.rejects(dynamic.call('jarvis_request_real_change', { path: 'sum.ts' }), /DYNAMIC_TOOL_DENIED/);
manager.stop(m.capsuleId); assert.throws(() => manager.processes.launch(m), /CAPSULE_STOPPED/);
manager.cleanup(m.capsuleId, true); assert.ok(!fs.existsSync(m.workspace));
console.log('PASS capsule snapshot/secret exclusions/diff/conflict/import/revert/stop/cleanup');
