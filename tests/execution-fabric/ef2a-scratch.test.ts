import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { harness, tempLab } from '../intelligence-lab/lab-harness';
import { ExecutionLedger, MemoryExecutionStore } from '../../src/execution/ExecutionLedger';
import { NodeProjectIdentity, ProjectTrustService } from '../../src/execution/ProjectTrustService';
import { TrustedScratchService, scratchEnvironment } from '../../src/execution/TrustedScratchService';
import { AgentCapsuleImportGate } from '../../src/intelligence/capsule/AgentCapsuleImportGate';
import { NodeProcessPort } from '../../electron/dev/nodePorts';

const root = tempLab(); const project = path.join(root, 'real-fixture'); fs.mkdirSync(project);
const lock = { name: 'scratch-fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
  packages: { '': { name: 'scratch-fixture', version: '1.0.0' } } };
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'scratch-fixture', version: '1.0.0',
  scripts: { test: 'node test.cjs', build: 'node test.cjs', dev: 'node test.cjs' } }));
fs.writeFileSync(path.join(project, 'package-lock.json'), JSON.stringify(lock));
fs.writeFileSync(path.join(project, 'sum.js'), 'module.exports.sum = (a, b) => a + b;\n');
fs.writeFileSync(path.join(project, 'test.cjs'), "const{sum}=require('./sum');if(sum(2,3)!==5)process.exit(1);\n");
fs.writeFileSync(path.join(project, 'slow.cjs'), 'setTimeout(() => process.exit(0), 10000);\n');
fs.writeFileSync(path.join(project, '.gitignore'), 'ignored.txt\n');
const git = (...args: string[]) => { const r = spawnSync('git', args, { cwd: project, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr || r.stdout); };
git('init', '-q'); git('add', 'package.json', 'package-lock.json', 'sum.js', 'test.cjs', 'slow.cjs', '.gitignore');
git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-q', '-m', 'baseline');
fs.writeFileSync(path.join(project, 'sum.js'), 'module.exports.sum = (a, b) => a - b;\n'); // dirty tracked state
fs.writeFileSync(path.join(project, 'note.txt'), 'untracked nonignored\n');
fs.writeFileSync(path.join(project, 'ignored.txt'), 'should not copy\n');
fs.writeFileSync(path.join(project, '.env'), 'API_KEY=fictional-fixture-token\n');
fs.writeFileSync(path.join(project, '.npmrc'), '//registry.npmjs.org/:_authToken=fictional-fixture-token\n');
const previousToken = process.env.EF2A_API_KEY; process.env.EF2A_API_KEY = 'fixture-environment-secret';
const h = await harness(root, 'ef2a-scratch', { allowTerminal: true });
const ledger = new ExecutionLedger(new MemoryExecutionStore());
const trust = new ProjectTrustService(h.dev.guard, new NodeProjectIdentity(h.dev.git), ledger);
const scratch = new TrustedScratchService(trust, h.dev.git, new NodeProcessPort(), ledger, 30_000);
const gate = new AgentCapsuleImportGate(h.broker, h.dev);
let firstId: string | null = null; let secondId: string | null = null;
try {
  await assert.rejects(scratch.create({ project, runId: h.runId, conversationId: 'c' }), /NOT_TRUSTED/);
  await trust.grant(project, 'EXPLICIT_USER', 'fixture explicit grant', h.runId);
  assert.equal((await h.broker.execute({ runId: h.runId, toolId: 'project.open', args: { project } })).ok, true);
  const first = await scratch.create({ project, runId: h.runId, conversationId: 'c' }); firstId = first.id;
  assert.equal(first.gitCloneNoHardlinks, true); assert.equal(fs.existsSync(path.join(first.projectDir, '.git')), false);
  assert.equal(fs.readFileSync(path.join(first.projectDir, 'sum.js'), 'utf8').includes('a - b'), true);
  assert.equal(fs.readFileSync(path.join(first.projectDir, 'note.txt'), 'utf8'), 'untracked nonignored\n');
  for (const secret of ['.env', '.npmrc', 'ignored.txt']) assert.equal(fs.existsSync(path.join(first.projectDir, secret)), false, secret);
  assert.ok(first.excluded.some(item => item.path === 'ignored.txt' && item.reason === 'GIT_IGNORED_EXCLUDED'));
  assert.ok(first.excluded.some(item => item.path === '.env'));
  assert.ok(first.environmentNames.includes('NPM_CONFIG_USERCONFIG'));
  assert.equal(first.environmentNames.includes('EF2A_API_KEY'), false);
  assert.equal(fs.readFileSync(path.join(first.root, 'meta', 'empty.npmrc'), 'utf8'), '');
  assert.equal(fs.statSync(path.join(first.projectDir, 'sum.js')).nlink, 1);
  const clean = scratchEnvironment(process.env, first.root);
  assert.equal(clean.EF2A_API_KEY, undefined); assert.equal(clean.USERPROFILE?.startsWith(first.root), true);
  await scratch.applyPatch(first.id, 'sum.js', [{ kind: 'edit', edit: { oldText: 'a - b', newText: 'a + b' } }]);
  assert.equal(fs.readFileSync(path.join(project, 'sum.js'), 'utf8').includes('a - b'), true);
  assert.equal((await scratch.npmCi(first.id)).exitCode, 0);
  assert.equal((await scratch.runScript(first.id, 'test')).status, 'SCRATCH_TEST_PASS');
  await assert.rejects(scratch.runScript(first.id, 'dev'), /NOT_ALLOWLISTED/);
  const diff = await scratch.diff(first.id);
  assert.deepEqual(diff.changes.map(c => c.path), ['sum.js']);
  const imported = await scratch.import(first.id, gate, true);
  assert.equal(imported.applied, 1);
  assert.equal(fs.readFileSync(path.join(project, 'sum.js'), 'utf8').includes('a + b'), true);
  await scratch.close(first.id); firstId = null;
  assert.equal(fs.existsSync(first.root), false);
  assert.ok(ledger.events(h.runId).some(e => e.kind === 'SCRATCH' && e.entry.event === 'CLEANED'));
  assert.ok(ledger.events(h.runId).some(e => e.kind === 'SCRATCH' && e.entry.event === 'COMMAND'
    && e.entry.detail.literalScript === 'node test.cjs'));
  assert.ok(ledger.events(h.runId).some(e => e.kind === 'SCRATCH' && e.entry.event === 'TEST_RESULT'
    && e.entry.detail.status === 'SCRATCH_TEST_PASS'));

  const second = await scratch.create({ project, runId: h.runId, conversationId: 'c' }); secondId = second.id;
  await scratch.applyPatch(second.id, 'sum.js', [{ kind: 'edit', edit: { oldText: 'a + b', newText: 'a - b' } }]);
  fs.writeFileSync(path.join(project, 'note.txt'), 'user changed during scratch\n');
  await assert.rejects(scratch.import(second.id, gate, true), /CONFLICT:PROJECT_BASE_CHANGED/);
  assert.equal(fs.readFileSync(path.join(project, 'sum.js'), 'utf8').includes('a + b'), true);
  await scratch.close(second.id); secondId = null;
  assert.equal(fs.existsSync(second.root), false);
  let failureRoot = '';
  await assert.rejects(scratch.withScratch({ project, runId: h.runId, conversationId: 'c' }, async session => {
    failureRoot = session.root; throw new Error('fixture workflow failure');
  }), /fixture workflow failure/);
  assert.equal(fs.existsSync(failureRoot), false);
  let stopRoot = '';
  const stop = new AbortController();
  await scratch.withScratch({ project, runId: h.runId, conversationId: 'c' }, async session => {
    stopRoot = session.root;
    await scratch.applyPatch(session.id, 'package.json', [{ kind: 'edit', edit: { oldText: '"test":"node test.cjs"', newText: '"test":"node slow.cjs"' } }]);
    const timer = setTimeout(() => stop.abort(), 250);
    try { assert.equal((await scratch.runScript(session.id, 'test', stop.signal)).status, 'CANCELLED'); }
    finally { clearTimeout(timer); }
  }, stop.signal);
  assert.equal(fs.existsSync(stopRoot), false);
  assert.ok(ledger.events(h.runId).some(e => e.kind === 'SCRATCH' && e.entry.event === 'STOPPED'));
  let privateRoot = '';
  await scratch.withScratch({ project, runId: h.runId, conversationId: 'c' }, async session => {
    privateRoot = session.root;
    const privateLock = { ...lock, packages: { '': lock.packages[''], private: { resolved: 'https://private.example.test/package.tgz' } } };
    fs.writeFileSync(path.join(session.projectDir, 'package-lock.json'), JSON.stringify(privateLock));
    await assert.rejects(scratch.npmCi(session.id), /PRIVATE_REGISTRY_REQUIRES_PROXY/);
  });
  assert.equal(fs.existsSync(privateRoot), false);
  const plain = path.join(root, 'plain-fixture'); fs.mkdirSync(plain); fs.writeFileSync(path.join(plain, 'hello.txt'), 'non-git\n');
  await trust.grant(plain, 'JARVIS_CREATED', 'fixture plain project');
  await scratch.withScratch({ project: plain, runId: h.runId, conversationId: 'c' }, async session => {
    assert.equal(session.gitCloneNoHardlinks, false);
    assert.equal(fs.readFileSync(path.join(session.projectDir, 'hello.txt'), 'utf8'), 'non-git\n');
  });
  console.log('PASS EF-2A trusted scratch: clone-no-hardlinks, dirty copy, secret/env scrub, npm ci/test, A.6 import, CONFLICT, cleanup');
} finally {
  if (firstId) await scratch.close(firstId).catch(() => {});
  if (secondId) await scratch.close(secondId).catch(() => {});
  if (previousToken === undefined) delete process.env.EF2A_API_KEY; else process.env.EF2A_API_KEY = previousToken;
  h.broker.closeRun(h.runId); fs.rmSync(root, { recursive: true, force: true });
}
