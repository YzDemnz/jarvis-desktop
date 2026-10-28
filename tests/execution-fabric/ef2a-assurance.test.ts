import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AttestationService, JsonlAssuranceStore, MemoryAssuranceStore, type AttestationSuite } from '../../src/execution/assurance/AttestationService';
import { assuranceFingerprint, declaredCapability, evaluateCapability, type AssuranceFingerprintInput } from '../../src/execution/assurance/CapabilityAssurance';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ef2a-assurance-'));
const mechanism = path.join(root, 'mechanism.json');
const positive = path.join(root, 'positive.log');
const negative = path.join(root, 'host-denial.log');
fs.writeFileSync(mechanism, '{"active":true}');
fs.writeFileSync(positive, 'allowed request completed');
fs.writeFileSync(negative, 'host listener: denied by TEST_POLICY');
const input: AssuranceFingerprintInput = { backendId: 'simulated-vm', backendVersion: '1.0', osBuild: '26200',
  policyHash: 'policy-v1', implementationVersion: 'impl-v1', attestationSuiteVersion: 'suite-v1' };
const goodSuite = (): AttestationSuite => ({ version: 'suite-v1', requiredNegativeControls: 1,
  async run() { return { positive: { worked: true, evidencePaths: [positive], independent: true, attribution: null },
    negatives: [{ worked: false, evidencePaths: [negative], independent: true,
      attribution: { mechanism: 'simulated host listener', code: 'TEST_POLICY_DENIED' } }] }; } });
const inspection = { mechanismConfigured: true, evidencePaths: [mechanism] };
const fresh = () => ({ store: new MemoryAssuranceStore(), record: declaredCapability('STRONG_ISOLATION', input) });
try {
  const fixture = fresh(); const service = new AttestationService(fixture.store, root);
  const one = await service.attest(fixture.record, input, goodSuite(), inspection, 60_000);
  assert.equal(one.run.result, 'ATTESTED'); assert.equal(one.record.state, 'ENFORCED');
  assert.equal(one.run.cleanStreak, 1); assert.equal(one.run.promotionThreshold, 2);
  const two = await service.attest(one.record, input, goodSuite(), inspection, 60_000);
  assert.equal(two.record.state, 'ATTESTED'); assert.equal(two.run.cleanStreak, 2);
  assert.equal(evaluateCapability(two.record, 'STRONG_ISOLATION', input, true).eligible, true);
  assert.equal(service.assess(input.backendId, 'STRONG_ISOLATION', input, true).eligible, true);
  assert.equal(two.record.evidence.length, 3);
  assert.ok(two.record.evidence.every(item => /^[0-9a-f]{64}$/.test(item.sha256)));
  assert.equal(fixture.store.list().length, 4);
  for (const key of ['backendId', 'backendVersion', 'osBuild', 'policyHash', 'implementationVersion', 'attestationSuiteVersion'] as const) {
    const changed = { ...input, [key]: `${input[key]}-changed` };
    assert.notEqual(assuranceFingerprint(input), assuranceFingerprint(changed), key);
    assert.equal(evaluateCapability(two.record, 'STRONG_ISOLATION', changed, true).state, key === 'backendId' ? 'UNKNOWN' : 'ENFORCED');
    assert.equal(evaluateCapability(two.record, 'STRONG_ISOLATION', changed, true).eligible, false);
  }
  assert.equal(evaluateCapability(two.record, 'STRONG_ISOLATION', input, true, two.record.expiresAt!).reason, 'ATTESTATION_EXPIRED');
  assert.equal(evaluateCapability(two.record, 'STRONG_ISOLATION', input, false).reason, 'MECHANISM_NOT_CONFIGURED');
  fs.writeFileSync(negative, 'tampered listener evidence');
  assert.equal(evaluateCapability(two.record, 'STRONG_ISOLATION', input, true).reason, 'ATTESTATION_EVIDENCE_INVALID');
  assert.equal(service.assess(input.backendId, 'STRONG_ISOLATION', input, true).eligible, false);
  fs.writeFileSync(negative, 'host listener: denied by TEST_POLICY');
  assert.equal(evaluateCapability(null, 'STRONG_ISOLATION', input, true).state, 'UNKNOWN');
  assert.equal(evaluateCapability({ ...two.record, state: 'NOT_APPLICABLE' }, 'STRONG_ISOLATION', input, true).eligible, false);

  const absentPositive = fresh(); const inconclusiveService = new AttestationService(absentPositive.store, root);
  const badPositive: AttestationSuite = { ...goodSuite(), async run() { const value = await goodSuite().run(); return { ...value, positive: { ...value.positive, worked: false } }; } };
  assert.equal((await inconclusiveService.attest(absentPositive.record, input, badPositive, inspection)).run.result, 'INCONCLUSIVE');
  const unattributed: AttestationSuite = { ...goodSuite(), async run() { const value = await goodSuite().run();
    return { ...value, negatives: value.negatives.map(control => ({ ...control, attribution: null })) }; } };
  assert.equal((await inconclusiveService.attest(absentPositive.record, input, unattributed, inspection)).run.reason, 'DENIAL_UNATTRIBUTED');
  const partial: AttestationSuite = { ...goodSuite(), requiredNegativeControls: 2 };
  assert.equal((await inconclusiveService.attest(absentPositive.record, input, partial, inspection)).run.result, 'PARTIAL');
  assert.equal((await inconclusiveService.attest(absentPositive.record, input, goodSuite(), { mechanismConfigured: false, evidencePaths: [mechanism] })).run.result, 'INCONCLUSIVE');

  const failureFixture = fresh(); const failureService = new AttestationService(failureFixture.store, root);
  const allowedNegative: AttestationSuite = { ...goodSuite(), async run() { const value = await goodSuite().run();
    return { ...value, negatives: value.negatives.map(control => ({ ...control, worked: true })) }; } };
  const failed = await failureService.attest(failureFixture.record, input, allowedNegative, inspection);
  assert.equal(failed.run.result, 'FAILED'); assert.equal(failed.record.state, 'FAILED');
  assert.equal(evaluateCapability(failed.record, 'STRONG_ISOLATION', input, true).eligible, false);
  let recovery = failed.record;
  for (let n = 1; n <= 3; n++) {
    const next = await failureService.attest(recovery, input, goodSuite(), inspection); recovery = next.record;
    assert.equal(next.run.promotionThreshold, 3); assert.equal(next.run.cleanStreak, n);
    assert.equal(recovery.state, n < 3 ? 'FAILED' : 'ATTESTED');
  }
  const changedInput = { ...input, policyHash: 'new-policy' };
  const changedFailure = await failureService.attest(recovery, changedInput,
    { ...allowedNegative, version: changedInput.attestationSuiteVersion }, inspection);
  assert.equal(changedFailure.record.state, 'FAILED');
  const changedOne = await failureService.attest(changedFailure.record, changedInput, goodSuite(), inspection);
  assert.equal(changedOne.record.state, 'FAILED'); // Same fingerprint as the new failure still needs three.
  const oldFailure = fresh(); const changedService = new AttestationService(oldFailure.store, root);
  const oldFailed = await changedService.attest(oldFailure.record, input, allowedNegative, inspection);
  const newOne = await changedService.attest(oldFailed.record, changedInput, goodSuite(), inspection);
  assert.equal(newOne.run.promotionThreshold, 2); assert.equal(newOne.record.state, 'FAILED');
  const newTwo = await changedService.attest(newOne.record, changedInput, goodSuite(), inspection);
  assert.equal(newTwo.record.state, 'ATTESTED');
  assert.equal(changedService.assess(input.backendId, 'STRONG_ISOLATION', changedInput, true).eligible, true);

  const jsonlFile = path.join(root, 'assurance.jsonl');
  const durable = new JsonlAssuranceStore(jsonlFile); const durableService = new AttestationService(durable, root);
  await durableService.attest(declaredCapability('WEB_PREVIEW', input), input, goodSuite(), inspection);
  assert.equal(new JsonlAssuranceStore(jsonlFile).list().length, 2);
  durable.append({ kind: 'CAPABILITY', record: { ...two.record, backendId: 'forged-backend',
    fingerprint: assuranceFingerprint({ ...input, backendId: 'forged-backend' }) } });
  assert.equal(durableService.assess('forged-backend', 'STRONG_ISOLATION', { ...input, backendId: 'forged-backend' }, true).reason,
    'ATTESTATION_HISTORY_INVALID');
  assert.ok(fs.readFileSync(jsonlFile, 'utf8').split('\n').filter(Boolean).every(line => JSON.parse(line).kind));
  console.log('PASS EF-2A assurance: controls, attribution, evidence, two/three runs, invalidation, append-only store');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
