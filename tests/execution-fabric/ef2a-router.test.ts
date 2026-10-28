import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExecutionRouter } from '../../src/execution/ExecutionRouter';
import { ExecutionSuitabilityScore } from '../../src/execution/ExecutionSuitabilityScore';
import { executionPolicy } from '../../src/execution/ExecutionPolicy';
import { ExecutionFabric } from '../../src/execution/ExecutionFabric';
import { ExecutionLedger, MemoryExecutionStore } from '../../src/execution/ExecutionLedger';
import { ExecutionBackendBase } from '../../src/execution/ExecutionBackendBase';
import { AttestationService, MemoryAssuranceStore, type AttestationSuite } from '../../src/execution/assurance/AttestationService';
import { declaredCapability, type AssuranceFingerprintInput, type AssuranceResolver, type CapabilityState } from '../../src/execution/assurance/CapabilityAssurance';
import type { ExecutionCapability, ExecutionProbe, ExecutionRequest, ExecutionResult, ExecutionSession } from '../../src/execution/types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ef2a-router-'));
const evidence = path.join(root, 'proof.txt'); fs.writeFileSync(evidence, 'independent host witness');
const input: AssuranceFingerprintInput = { backendId: 'strong-sim', backendVersion: '1', osBuild: '26200',
  policyHash: 'p1', implementationVersion: 'i1', attestationSuiteVersion: 's1' };
const strongCap: ExecutionCapability = { filesystemIsolation: 'VM', processIsolation: 'VM', networkIsolation: 'VM',
  credentialIsolation: 'VM', uiIsolation: 'VM', shell: true, git: true, packageManager: true, browser: false,
  artifacts: true, persistence: false, resume: false, pause: false, startupCostMs: 1, trust: 'STRONG_ISOLATION' };
const brokerCap: ExecutionCapability = { ...strongCap, filesystemIsolation: 'BROKERED', processIsolation: 'BROKERED',
  networkIsolation: 'BROKERED', credentialIsolation: 'BROKERED', uiIsolation: 'BROKERED', trust: 'TRUSTED_BROKERED' };
const strong: ExecutionProbe = { backendId: 'strong-sim', realm: 'STRONG_ISOLATED', status: 'AVAILABLE',
  evidence: ['simulated only'], at: Date.now(), capabilities: strongCap,
  assurance: { current: input, mechanismConfigured: true } };
const broker: ExecutionProbe = { backendId: 'broker-sim', realm: 'BROKERED', status: 'AVAILABLE',
  evidence: ['simulated only'], at: Date.now(), capabilities: brokerCap };
const request = (runId: string): ExecutionRequest => ({ runId, conversationId: 'c', task: 'UNKNOWN_UNTRUSTED_AGENT',
  prompt: 'fixture', providerId: null, agentId: null, projectRoot: root, requiredTrust: 'STRONG_ISOLATION',
  requireShell: true, allowProposalFallback: true });
const policy = executionPolicy();

try {
  for (const state of ['DECLARED', 'ENFORCED', 'FAILED', 'UNKNOWN', 'NOT_APPLICABLE', 'ATTESTED'] as CapabilityState[]) {
    const resolver: AssuranceResolver = { assess(_id, capability) { return { capability, state,
      fingerprint: 'fixture', eligible: state === 'ATTESTED', reason: state, record: null }; } };
    const route = new ExecutionRouter(new ExecutionSuitabilityScore(), resolver).route(request(`state-${state}`), policy, [strong, broker]);
    assert.equal(route.status, state === 'ATTESTED' ? 'SELECTED' : 'FAIL', state);
    if (state !== 'ATTESTED') {
      assert.equal(route.reason, 'NO_ELIGIBLE_BACKEND');
      assert.equal(route.eligibilityReport.backends.find(b => b.backendId === strong.backendId)?.failedRequirements[0]?.state, state);
    }
  }
  const deceptive: AssuranceResolver = { assess(_id, capability) { return { capability, state: 'ENFORCED',
    fingerprint: 'fixture', eligible: true, reason: 'forged', record: null }; } };
  assert.equal(new ExecutionRouter(new ExecutionSuitabilityScore(), deceptive).route(request('deceptive'), policy, [strong]).status, 'FAIL');

  const store = new MemoryAssuranceStore(); const service = new AttestationService(store, root);
  const suite: AttestationSuite = { version: 's1', requiredNegativeControls: 1, async run() { return {
    positive: { worked: true, evidencePaths: [evidence], independent: true, attribution: null },
    negatives: [{ worked: false, evidencePaths: [evidence], independent: true,
      attribution: { mechanism: 'host listener', code: 'DENIED' } }],
  }; } };
  const inspection = { mechanismConfigured: true, evidencePaths: [evidence] };
  const first = await service.attest(declaredCapability('STRONG_ISOLATION', input), input, suite, inspection, 60_000);
  const realRouter = new ExecutionRouter(new ExecutionSuitabilityScore(), service);
  assert.equal(realRouter.route(request('one-run'), policy, [strong]).status, 'FAIL');
  const second = await service.attest(first.record, input, suite, inspection, 60_000);
  assert.equal(second.record.state, 'ATTESTED');
  assert.equal(realRouter.route(request('two-runs'), policy, [strong, broker]).selected, strong.backendId);
  const changed: ExecutionProbe = { ...strong, assurance: { current: { ...input, backendVersion: '2' }, mechanismConfigured: true } };
  assert.equal(realRouter.route(request('version-changed'), policy, [changed]).eligibilityReport.backends[0]?.failedRequirements[0]?.reason, 'FINGERPRINT_CHANGED');
  const expired = service.assess(input.backendId, 'STRONG_ISOLATION', input, true, second.record.expiresAt!);
  assert.equal(expired.reason, 'ATTESTATION_EXPIRED');
  const extraRequest = { ...request('two-requirements'), requiredCapabilities: ['NETWORK_DENY' as const] };
  assert.equal(realRouter.route(extraRequest, policy, [strong]).eligibilityReport.backends[0]?.failedRequirements[0]?.capability, 'NETWORK_DENY');
  const policyRequirement = { ...policy, securityRequirements: { UNKNOWN_UNTRUSTED_AGENT: ['NETWORK_DENY' as const] } };
  assert.equal(realRouter.route(request('policy-requirement'), policyRequirement, [strong]).status, 'FAIL');
  await service.attest(second.record, input, suite, inspection, 0);
  assert.equal(realRouter.route(request('expired-router'), policy, [strong]).eligibilityReport.backends[0]?.failedRequirements[0]?.reason,
    'ATTESTATION_EXPIRED');

  const noAssurance = new ExecutionRouter();
  const blocked = noAssurance.route(request('no-fallback'), policy, [strong, broker]);
  assert.equal(blocked.status, 'FAIL'); assert.equal(blocked.fallback, null);
  const fallbackPolicy = { ...policy, securityFallback: 'BROKERED_PROPOSAL' as const };
  const fallback = noAssurance.route(request('with-fallback'), fallbackPolicy, [strong, broker]);
  assert.equal(fallback.status, 'PROPOSAL_ONLY'); assert.equal(fallback.fallback?.to, 'BROKERED');
  assert.equal(noAssurance.route({ ...request('not-allowed'), allowProposalFallback: false }, fallbackPolicy, [strong, broker]).status, 'FAIL');

  let executed = false;
  class TrapBroker extends ExecutionBackendBase {
    readonly id = 'broker-sim'; readonly realm = 'BROKERED' as const;
    capabilities() { return brokerCap; }
    async probe() { return broker; }
    async execute(_session: ExecutionSession, _request: ExecutionRequest): Promise<ExecutionResult> {
      executed = true; throw new Error('FALLBACK_MUST_NOT_EXECUTE');
    }
  }
  const ledger = new ExecutionLedger(new MemoryExecutionStore());
  const fabric = new ExecutionFabric(noAssurance, ledger); fabric.register(new TrapBroker());
  const decision = await fabric.dispatch(request('ledger-fallback'), fallbackPolicy);
  assert.equal(decision.result, null); assert.equal(decision.session, null); assert.equal(executed, false);
  assert.equal(ledger.events('ledger-fallback').find(e => e.kind === 'ROUTE')?.kind, 'ROUTE');
  assert.equal(ledger.events('ledger-fallback').length, 1);
  console.log('PASS EF-2A router: attested-only, current fingerprint, eligibility report, explicit logged fallback');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
