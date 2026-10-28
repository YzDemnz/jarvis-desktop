import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { harness, tempLab } from '../intelligence-lab/lab-harness';
import { ExecutionLedger, MemoryExecutionStore } from '../../src/execution/ExecutionLedger';
import { NodeProjectIdentity, ProjectTrustService } from '../../src/execution/ProjectTrustService';
import { RealVerificationService } from '../../src/execution/RealVerificationService';
import { NodeProcessPort } from '../../electron/dev/nodePorts';

const root = tempLab(); const project = path.join(root, 'real-verify-fixture'); fs.mkdirSync(project);
const marker = path.join(project, 'executed.txt');
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'real-verify-fixture', version: '1.0.0',
  scripts: { test: 'node test.cjs', dev: 'node test.cjs' } }));
fs.writeFileSync(path.join(project, 'test.cjs'), "const fs=require('fs');fs.writeFileSync('executed.txt',String(process.env.EF2A_API_KEY||''));\n");
const h = await harness(root, 'ef2a-real-verify', { allowTerminal: true });
const ledger = new ExecutionLedger(new MemoryExecutionStore());
const trust = new ProjectTrustService(h.dev.guard, new NodeProjectIdentity(h.dev.git), ledger);
const verifier = new RealVerificationService(trust, new NodeProcessPort(), ledger, 30_000);
const oldSecret = process.env.EF2A_API_KEY; process.env.EF2A_API_KEY = 'fictional-fixture-token';
try {
  const skipped = await verifier.verify({ project, script: 'test', runId: h.runId });
  assert.equal(skipped.status, 'REAL_VERIFY_SKIPPED_UNTRUSTED'); assert.equal(fs.existsSync(marker), false);
  await trust.grant(project, 'EXPLICIT_USER', 'test fixture only', h.runId);
  await assert.rejects(verifier.verify({ project, script: 'dev', runId: h.runId }), /NOT_ALLOWLISTED/);
  const passed = await verifier.verify({ project, script: 'test', runId: h.runId });
  assert.equal(passed.status, 'REAL_VERIFY_PASS', JSON.stringify(passed)); assert.equal(passed.literalScript, 'node test.cjs');
  assert.equal(passed.environmentNames.includes('EF2A_API_KEY'), false);
  assert.equal(fs.readFileSync(marker, 'utf8'), '');
  fs.writeFileSync(path.join(project, 'test.cjs'), 'process.exit(7);\n');
  const failed = await verifier.verify({ project, script: 'test', runId: h.runId });
  assert.equal(failed.status, 'REAL_VERIFY_FAIL'); assert.equal(failed.exitCode, 7);
  await trust.revoke(project, 'fixture revoke', h.runId);
  assert.equal((await verifier.verify({ project, script: 'test', runId: h.runId })).status, 'REAL_VERIFY_SKIPPED_UNTRUSTED');
  assert.equal(ledger.events(h.runId).filter(e => e.kind === 'REAL_VERIFY').length, 4);
  console.log('PASS EF-2A real verify: unknown/revoked skipped; trusted pass/fail; scrubbed environment');
} finally {
  if (oldSecret === undefined) delete process.env.EF2A_API_KEY; else process.env.EF2A_API_KEY = oldSecret;
  h.broker.closeRun(h.runId); fs.rmSync(root, { recursive: true, force: true });
}
