import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PathGuard } from '../../src/dev/PathGuard';
import { TerminalService } from '../../src/dev/TerminalService';
import { GitService } from '../../src/dev/GitService';
import { NodeFsPort, NodeProcessPort } from '../../electron/dev/nodePorts';
import { ExecutionLedger, MemoryExecutionStore } from '../../src/execution/ExecutionLedger';
import { NodeProjectIdentity, ProjectTrustService, mayExecuteProjectCode } from '../../src/execution/ProjectTrustService';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ef2a-trust-'));
const gitProject = path.join(root, 'git-project'); fs.mkdirSync(gitProject);
const plainProject = path.join(root, 'plain-project'); fs.mkdirSync(plainProject);
const git = (...args: string[]) => { const r = spawnSync('git', args, { cwd: gitProject, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr || r.stdout); return r.stdout.trim(); };
try {
  git('init', '-q');
  fs.writeFileSync(path.join(gitProject, 'README.md'), 'fixture only\n');
  git('add', 'README.md');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-q', '-m', 'initial');
  const fsPort = new NodeFsPort(); const guard = new PathGuard(fsPort, { home: os.homedir() });
  await guard.addRoot(root);
  const gitService = new GitService(new TerminalService(new NodeProcessPort()));
  const identity = new NodeProjectIdentity(gitService);
  const ledger = new ExecutionLedger(new MemoryExecutionStore());
  const trust = new ProjectTrustService(guard, identity, ledger);
  const initial = await trust.status(gitProject);
  assert.equal(initial.state, 'UNKNOWN'); assert.equal(initial.reason, 'NO_TRUST_GRANT');
  assert.ok(initial.projectIdentity?.startsWith('git:'));
  assert.equal(mayExecuteProjectCode(initial, 'BROKERED_SCRATCH_APPLY'), false);
  const granted = await trust.grant(gitProject, 'EXPLICIT_USER', 'fixture user grant', 'trust-run');
  assert.equal(granted.state, 'TRUSTED'); assert.equal(granted.source, 'EXPLICIT_USER');
  assert.equal(mayExecuteProjectCode(granted, 'BROKERED_SCRATCH_APPLY'), true);
  assert.equal(mayExecuteProjectCode(granted, 'REAL_VERIFY'), true);
  assert.equal(mayExecuteProjectCode(granted, 'UI_SCRATCH_PREVIEW'), true);
  assert.equal(ledger.events('trust-run').filter(e => e.kind === 'PROJECT_TRUST').length, 1);
  fs.writeFileSync(path.join(gitProject, 'new.txt'), 'ordinary later commit\n');
  git('add', 'new.txt'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-q', '-m', 'later');
  assert.equal((await trust.status(gitProject)).state, 'TRUSTED'); // Root commit identity is stable.
  const moved = path.join(root, 'renamed-project'); fs.renameSync(gitProject, moved);
  assert.equal((await trust.status(moved)).state, 'UNKNOWN');
  fs.renameSync(moved, gitProject);
  const alias = path.join(root, 'project-junction');
  let junctionAvailable = false;
  try { fs.symlinkSync(gitProject, alias, 'junction'); junctionAvailable = true; } catch { /* host policy may forbid junction creation */ }
  if (junctionAvailable) {
    assert.equal((await trust.status(alias)).state, 'TRUSTED');
    assert.equal((await guard.canonical(alias)).toLowerCase(), (await guard.canonical(gitProject)).toLowerCase());
  }
  const revoked = await trust.revoke(gitProject, 'fixture revocation', 'revoke-run');
  assert.equal(revoked.state, 'UNTRUSTED'); assert.equal(mayExecuteProjectCode(revoked, 'REAL_VERIFY'), false);
  assert.equal(ledger.projectTrustHistory(await guard.canonical(gitProject)).length, 2);
  const plain = await trust.status(plainProject);
  assert.equal(plain.state, 'UNKNOWN'); assert.ok(plain.projectIdentity?.startsWith('fs:'));
  await trust.grant(plainProject, 'JARVIS_CREATED', 'fixture creation recorded');
  assert.equal((await trust.status(plainProject)).state, 'TRUSTED');
  const replaced = path.join(root, 'old-plain'); fs.renameSync(plainProject, replaced); fs.mkdirSync(plainProject);
  assert.equal((await trust.status(plainProject)).reason, 'PROJECT_IDENTITY_CHANGED');
  assert.equal((await trust.status(plainProject)).state, 'UNKNOWN');
  console.log(`PASS EF-2A project trust: explicit sources, git root, canonical path, revocation, replacement; junction=${junctionAvailable}`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
