import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FabricDatabase } from '../../electron/fabric/FabricDatabase';
import { TaskContinuity } from '../../electron/connected/TaskContinuity';
import { VerificationService } from '../../electron/connected/VerificationService';
import { ConciliusCoordinator, validateConciliusPlan } from '../../electron/connected/ConciliusCoordinator';
import type { ConciliusHost, ConciliusPlan, ConciliusGraph } from '../../electron/connected/ConciliusCoordinator';
import type { VerificationContract } from '../../src/fabric/Verification';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-adv-concilius-'));
const db = new FabricDatabase(path.join(root, 'fabric.sqlite'));
const continuity = new TaskContinuity(db, path.join(root, 'artifacts'));
const verification = new VerificationService(db);
let count = 0;
const pass = (message: string) => { count++; console.log('PASS ' + message); };
const producer = { id: 'produce', role: 'producer' as const, dependsOn: [], providerId: 'ollama-local' as const, model: 'fixture-model', prompt: 'Produce the requested bounded fixture.' };
const exact: VerificationContract = { kind: 'TEXT_EXACT', expected: 'correct' };
const critic = { id: 'critic', role: 'critic' as const, dependsOn: ['produce'], providerId: 'llama-cpp-local' as const, model: 'fixture-critic', prompt: 'Critique the produced candidate.', verification: { kind: 'MODEL_REVIEW' as const } };
const plan = (nodes: ConciliusPlan['nodes']): ConciliusPlan => ({ version: 1, dataClass: 'LOCAL_ONLY', nodes });
function hostFor(id: string, responses: (string | null)[]) {
  let stopped = false;
  const calls: { operationId: string; taskId: string; revision: number | null }[] = [];
  db.saveTask({ taskId: id, conversationId: id, goal: 'Own synthetic coordinator fixture', currentTask: 'new', instructions: [], findings: [], decisions: [], artifacts: [], openQuestions: [], pendingSteps: [], updatedAt: Date.now() });
  const host: ConciliusHost = {
    gate: () => { if (stopped) throw Error('ROOT_REVOKED'); },
    stop: () => { stopped = true; },
    checkpoint: taskId => continuity.checkpoint(taskId),
    execute: async (operationId, prompt, selection) => {
      host.gate();
      const operation = continuity.begin(operationId, prompt, selection.providerId, selection.model, 'LOCAL_ONLY', selection.continuation);
      calls.push({ operationId, taskId: operation.taskId, revision: selection.continuation?.revision ?? null });
      const response = responses[calls.length - 1];
      continuity.finish(operationId, response === null ? 'BLOCKED' : 'SUCCESS', response ?? null, selection.providerId, selection.model);
      return { ok: response !== null, taskId: operation.taskId, operationId, ...(response === null ? {} : { text: response }) };
    },
    verify: (operationId, contract, gate) => verification.verify(operationId, contract, 1, 1, gate),
  };
  return { host, calls, stopped: () => stopped };
}

assert.equal(validateConciliusPlan(plan([{ ...producer }, { ...critic, dependsOn: [0] as unknown as string[] }])).nodes[1]?.dependsOn[0], 'produce');
for (const invalid of [
  { ...plan([producer]), dataClass: 'GENERIC' },
  plan([{ ...producer, providerId: 'openai-api' as ConciliusPlan['nodes'][number]['providerId'] }]),
  plan(Array.from({ length: 5 }, (_, i) => ({ ...producer, id: 'node' + i }))),
  plan([producer, { ...critic, dependsOn: ['missing'] }]),
  plan([producer, { ...critic, dependsOn: ['critic'] }]),
  plan([producer, { ...critic, dependsOn: [] }]),
  { ...plan([producer]), tools: ['shell'] },
]) assert.throws(() => validateConciliusPlan(invalid));
pass('Closed local-only ordered DAG validates prior dependencies and rejects remote surfaces, cycles, orphan nodes, tools and unbounded plans');

const unverified = hostFor('unverified', ['candidate', 'Looks correct']);
const unverifiedGraph = await new ConciliusCoordinator(db, unverified.host).execute('unverified', plan([producer, critic]));
assert.equal(unverifiedGraph.state, 'PRODUCED'); assert.equal(unverifiedGraph.nodes[1]?.state, 'ADVISORY');
assert.equal(unverifiedGraph.nodes[1]?.verification?.state, 'INCONCLUSIVE'); assert.equal(unverifiedGraph.finalVerificationId, null);
assert.deepEqual(unverified.calls.map(call => call.taskId), ['unverified', 'unverified']);
assert.deepEqual(unverified.calls.map(call => call.operationId), ['unverified', 'unverified-node-1']);
assert.equal(unverified.calls[1]?.revision, 1);
pass('Critic agreement never verifies an unverified candidate; nodes preserve TaskId with distinct checkpoint-bound OperationIds');

const success = hostFor('verified', ['correct', 'Looks correct']);
const successGraph = await new ConciliusCoordinator(db, success.host).execute('verified', plan([{ ...producer, verification: exact }, critic]));
assert.equal(successGraph.state, 'VERIFIED'); assert.equal(successGraph.resultOperationId, 'verified');
assert.equal(successGraph.finalVerificationId, successGraph.nodes[0]?.verification?.id);
assert.match(successGraph.nodes[0]!.verification!.scope, /not independent truth/);
assert.equal((db.graphRecord('verified') as ConciliusGraph).state, 'VERIFIED');
pass('Scoped deterministic proof, not critic approval, closes graph and persists real SQLite evidence');

const failure = hostFor('failure', ['wrong', 'must not run']);
const failureGraph = await new ConciliusCoordinator(db, failure.host).execute('failure', plan([{ ...producer, verification: exact }, critic]));
assert.equal(failureGraph.state, 'FAILED'); assert.equal(failure.calls.length, 1); assert.equal(failureGraph.nodes[1]?.state, 'SKIPPED');
pass('Failed deterministic verification stops downstream inference without implicit retries');

const repair = { id: 'repair', role: 'repair' as const, dependsOn: ['produce'], providerId: 'llama-cpp-local' as const, model: 'fixture-repair', prompt: 'Repair the failed result without changing the original criteria.', verification: exact };
const repaired = hostFor('repair', ['wrong', 'correct', 'Review is advisory']);
const repairGraph = await new ConciliusCoordinator(db, repaired.host).execute('repair', plan([{ ...producer, verification: exact }, repair, { ...critic, dependsOn: ['repair'] }]));
assert.equal(repairGraph.state, 'VERIFIED'); assert.equal(repairGraph.resultOperationId, 'repair-node-1');
assert.equal(repairGraph.nodes[0]?.state, 'FAILED'); assert.equal(repairGraph.nodes[1]?.state, 'VERIFIED'); assert.equal(repaired.calls.length, 3);
assert.throws(() => validateConciliusPlan(plan([{ ...producer, verification: exact }, { ...repair, verification: { kind: 'TEXT_EXACT', expected: 'wrong' } }])));
assert.throws(() => validateConciliusPlan(plan([{ ...producer, verification: exact }, repair, { ...repair, id: 'repairAgain', dependsOn: ['repair'] }])));
pass('One explicit repair preserves the original criteria and failure record; weakened criteria and repair loops are rejected');

const noRepairNeeded = hostFor('no-repair-needed', ['correct']);
const skippedRepair = await new ConciliusCoordinator(db, noRepairNeeded.host).execute('no-repair-needed', plan([{ ...producer, verification: exact }, repair]));
assert.equal(skippedRepair.state, 'VERIFIED'); assert.equal(skippedRepair.nodes[1]?.state, 'SKIPPED'); assert.equal(noRepairNeeded.calls.length, 1);
pass('Authorized repair is skipped when its original candidate already verifies');

const providerFailure = hostFor('provider-failure', [null, 'correct']);
const providerFailureGraph = await new ConciliusCoordinator(db, providerFailure.host).execute('provider-failure', plan([{ ...producer, verification: exact }, repair]));
assert.equal(providerFailureGraph.state, 'FAILED'); assert.equal(providerFailure.calls.length, 1); assert.equal(providerFailureGraph.nodes[1]?.state, 'SKIPPED');
pass('Transport failure is not a semantic failed check and cannot start an intelligence repair');

const missingDependencyProof = hostFor('dependency-proof', ['candidate', 'correct']);
const dependencyGraph = await new ConciliusCoordinator(db, missingDependencyProof.host).execute('dependency-proof', plan([producer, { ...producer, id: 'derived', dependsOn: ['produce'], verification: exact }]));
assert.equal(dependencyGraph.nodes[1]?.state, 'VERIFIED'); assert.equal(dependencyGraph.state, 'PRODUCED');
pass('A final node passing its own scope does not certify an unverified required production dependency');

const identity = hostFor('identity', ['correct']);
const executeIdentity = identity.host.execute;
identity.host.execute = async (...args) => ({ ...await executeIdentity(...args), taskId: 'foreign-task' });
const identityGraph = await new ConciliusCoordinator(db, identity.host).execute('identity', plan([{ ...producer, verification: exact }]));
assert.equal(identityGraph.state, 'REVIEW_REQUIRED'); assert.equal(identityGraph.finalVerificationId, null); assert.equal(identity.stopped(), true);
pass('Foreign task/operation identity is rejected and root admission revoked before any final promotion');

const revoked = hostFor('revoked', ['correct']);
const originalVerify = revoked.host.verify;
revoked.host.verify = async (...args) => { const receipt = await originalVerify(...args); revoked.host.stop(); return receipt; };
const revokedGraph = await new ConciliusCoordinator(db, revoked.host).execute('revoked', plan([{ ...producer, verification: exact }]));
assert.equal(revokedGraph.state, 'REVIEW_REQUIRED'); assert.equal(revokedGraph.finalVerificationId, null);
pass('Authority revoked during verification prevents graph promotion even if a historical receipt was produced');

const stale = hostFor('expired', ['correct', 'critique']);
const staleVerify = stale.host.verify;
stale.host.verify = async (...args) => {
  const receipt = await staleVerify(...args);
  return { ...receipt, expiresAt: Date.now() - 1 };
};
const staleGraph = await new ConciliusCoordinator(db, stale.host).execute('expired', plan([{ ...producer, verification: exact }, critic]));
assert.notEqual(staleGraph.state, 'VERIFIED'); assert.equal(staleGraph.finalVerificationId, null);
pass('Expired scoped receipts cannot certify final graph results');

const unsupportedVerifier = hostFor('unsupported-verifier', ['correct']);
const supportedVerify = unsupportedVerifier.host.verify;
unsupportedVerifier.host.verify = async (...args) => ({ ...await supportedVerify(...args), verifierId: 'model:self-approval' });
const unsupportedGraph = await new ConciliusCoordinator(db, unsupportedVerifier.host).execute('unsupported-verifier', plan([{ ...producer, verification: exact }]));
assert.equal(unsupportedGraph.state, 'REVIEW_REQUIRED'); assert.equal(unsupportedGraph.finalVerificationId, null);
pass('Unsupported verifier identity cannot promote a graph even if its response claims deterministic VERIFIED');

const cancelledFixture = hostFor('cancelled', ['correct']);
let release!: () => void;
let entered!: () => void;
const inFlight = new Promise<void>(resolve => { entered = resolve; });
const waitForRelease = new Promise<void>(resolve => { release = resolve; });
cancelledFixture.host.execute = async (operationId) => {
  entered(); await waitForRelease;
  return { ok: true, operationId, taskId: 'cancelled', text: 'correct' };
};
const cancelledCoordinator = new ConciliusCoordinator(db, cancelledFixture.host);
const cancelledRun = cancelledCoordinator.execute('cancelled', plan([{ ...producer, verification: exact }, critic]));
await inFlight; cancelledCoordinator.stop('cancelled');
const cancelledGraph = await cancelledRun; assert.equal(cancelledGraph.state, 'STOPPED'); assert.equal(cancelledFixture.stopped(), true);
assert.equal(cancelledGraph.nodes[0]?.state, 'STOPPED'); assert.equal(cancelledGraph.nodes[1]?.state, 'SKIPPED');
release(); await Promise.resolve(); assert.equal((db.graphRecord('cancelled') as ConciliusGraph).state, 'STOPPED');
pass('STOP settles a running graph and late provider completion cannot resurrect it or execute downstream nodes');

const timeoutFixture = hostFor('timeout', []);
timeoutFixture.host.execute = async () => new Promise(() => {});
const timeoutGraph = await new ConciliusCoordinator(db, timeoutFixture.host, { durationMs: 20 }).execute('timeout', plan([producer]));
assert.equal(timeoutGraph.state, 'STOPPED'); assert.equal(timeoutFixture.stopped(), true);
pass('Bounded graph duration revokes a hanging host operation without an infinite coordinator loop');

const cleanupFailure = hostFor('cleanup-failure', []);
cleanupFailure.host.execute = async () => new Promise(() => {});
cleanupFailure.host.stop = () => { throw Error('Cleanup failed'); };
const cleanupGraph = await new ConciliusCoordinator(db, cleanupFailure.host, { durationMs: 20 }).execute('cleanup-failure', plan([producer]));
assert.equal(cleanupGraph.state, 'REVIEW_REQUIRED'); assert.match(cleanupGraph.reason!, /cleanup failed/);
pass('Host cleanup failure is review-required, not a fabricated successful STOP or uncaught timer exception');

const prior = structuredClone(successGraph); prior.graphId = 'restart'; prior.taskId = 'restart'; prior.state = 'STARTED'; prior.nodes[0]!.state = 'STARTED';
db.writeGraphRecord('restart', prior);
const recovered = new ConciliusCoordinator(db, success.host).recover('restart');
assert.equal(recovered?.state, 'INTERRUPTED'); assert.equal(recovered?.nodes[0]?.state, 'INTERRUPTED');
assert.equal(success.calls.length, 2);
await assert.rejects(new ConciliusCoordinator(db, success.host).execute('restart', plan([producer])), /ALREADY_USED/);
pass('Recovered STARTED graph becomes INTERRUPTED; read/restart never invokes providers and graph IDs cannot replay');

db.close();
const reopened = new FabricDatabase(path.join(root, 'fabric.sqlite'));
assert.equal((reopened.graphRecord('repair') as ConciliusGraph).state, 'VERIFIED');
assert.equal((reopened.graphRecord('failure') as ConciliusGraph).state, 'FAILED');
assert.equal((reopened.graphRecord('restart') as ConciliusGraph).state, 'INTERRUPTED');
reopened.close();
pass('Terminal, repaired and interrupted graph records survive real SQLite close/reopen');
console.log('ADV_CONCILIUS_PASS ' + count);
