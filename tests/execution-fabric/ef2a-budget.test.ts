import assert from 'node:assert/strict';
import { defaultRunBudget, evaluateRunBudget, type RunUsageSnapshot } from '../../src/execution/RunBudget';
import { executionPolicy } from '../../src/execution/ExecutionPolicy';
import { ExecutionLedger, MemoryExecutionStore } from '../../src/execution/ExecutionLedger';

const budget = defaultRunBudget();
assert.deepEqual(Object.keys(budget).sort(), ['maxDurationMs', 'maxInputTokens', 'maxOutputTokens', 'maxToolCalls', 'maxRetries', 'maxCostUsd'].sort());
assert.ok(Object.values(budget).every(item => item.enforcement === 'NOT_ENFORCEABLE'));
assert.deepEqual(executionPolicy().budget, budget);
for (const key of Object.keys(budget) as Array<keyof typeof budget>) budget[key] = { value: 1, enforcement: 'NOT_ENFORCEABLE' };
const base: RunUsageSnapshot = { durationMs: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0, retries: 0,
  costUsd: 0, acceptedArtifacts: 0, objectiveMet: false };
const all = evaluateRunBudget(budget, { ...base, durationMs: 2, inputTokens: 2, outputTokens: 2,
  toolCalls: 2, retries: 2, costUsd: 2 });
assert.equal(all.budgetHits.length, 6); assert.equal(all.wastedRun, true); assert.ok(all.wastedReason);
assert.equal(evaluateRunBudget(budget, { ...base, inputTokens: 1 }).wastedRun, true);
assert.equal(evaluateRunBudget(budget, { ...base, costUsd: 0.01, acceptedArtifacts: 1 }).wastedRun, false);
assert.equal(evaluateRunBudget(budget, { ...base, outputTokens: 2, objectiveMet: true }).wastedRun, false);
assert.equal(evaluateRunBudget(budget, { ...base, outputTokens: 0, durationMs: 2 }).wastedRun, false);
const ledger = new ExecutionLedger(new MemoryExecutionStore());
ledger.budget('fixture-run', { ...base, inputTokens: 2 }, evaluateRunBudget(budget, { ...base, inputTokens: 2 }));
assert.equal(ledger.events('fixture-run').filter(event => event.kind === 'BUDGET').length, 1);
console.log('PASS EF-2A budgets: six declared fields, honest enforcement, hits and wasted-run predicate');
