import assert from 'node:assert/strict';
import { classifyRun, type RunEvidence, type RunFailureClass, type StructuredFailureSignal } from '../../src/execution/FailureTaxonomy';

const base: RunEvidence = { objectiveVerified: false, acceptedArtifactCount: 0, usefulProgressVerified: false,
  taskExecuted: false, exitCode: null, signals: [], diagnostic: null };
for (const signal of ['ENV_UNAVAILABLE', 'AUTH_REQUIRED', 'PROVIDER_ERROR', 'MODEL_INCOMPATIBLE', 'POLICY_BLOCKED',
  'TOOL_BLOCKED', 'TIMEOUT', 'CANCELLED', 'RESULT_REJECTED', 'INTERNAL_ERROR'] as StructuredFailureSignal[]) {
  const result = classifyRun({ ...base, signals: [signal], diagnostic: `attributed ${signal}` });
  assert.equal(result.classification, signal); assert.ok(result.reason);
}
const cases: Array<[RunFailureClass, Partial<RunEvidence>]> = [
  ['SUCCESS', { objectiveVerified: true, acceptedArtifactCount: 1 }],
  ['PARTIAL', { usefulProgressVerified: true }],
  ['TASK_FAILED', { taskExecuted: true, exitCode: 0 }],
  ['UNKNOWN', { exitCode: 1, diagnostic: 'Unexpected server error' }],
];
for (const [expected, change] of cases) {
  const result = classifyRun({ ...base, ...change }); assert.equal(result.classification, expected); assert.ok(result.reason);
}
assert.equal(classifyRun({ ...base, signals: ['POLICY_BLOCKED', 'PROVIDER_ERROR'] }).classification, 'UNKNOWN');
assert.equal(classifyRun({ ...base, objectiveVerified: true }).classification, 'UNKNOWN');
assert.equal(classifyRun({ ...base, signals: ['RESULT_REJECTED'], objectiveVerified: true, acceptedArtifactCount: 1 }).classification, 'RESULT_REJECTED');
console.log('PASS EF-2A failure taxonomy: all terminal classes; exit code non-diagnostic; contradictions fail closed');
