export type BudgetEnforcement = 'ENFORCED_BY_JARVIS' | 'ENFORCED_BY_PROVIDER' | 'NOT_ENFORCEABLE';
export type BudgetName = 'maxDurationMs' | 'maxInputTokens' | 'maxOutputTokens' | 'maxToolCalls' | 'maxRetries' | 'maxCostUsd';
export interface BudgetLimit { value: number | null; enforcement: BudgetEnforcement }
export type RunBudget = Record<BudgetName, BudgetLimit>;
export interface RunUsageSnapshot {
  durationMs: number | null; inputTokens: number | null; outputTokens: number | null;
  toolCalls: number | null; retries: number | null; costUsd: number | null;
  acceptedArtifacts: number; objectiveMet: boolean;
}
export interface BudgetOutcome { budgetHits: BudgetName[]; wastedRun: boolean; wastedReason: string | null }
const USAGE_FIELD: Record<BudgetName, keyof RunUsageSnapshot> = {
  maxDurationMs: 'durationMs', maxInputTokens: 'inputTokens', maxOutputTokens: 'outputTokens',
  maxToolCalls: 'toolCalls', maxRetries: 'retries', maxCostUsd: 'costUsd',
};

/** Metadata only: a hit does not imply the configured limit was enforced. */
export function evaluateRunBudget(budget: RunBudget, usage: RunUsageSnapshot): BudgetOutcome {
  const hits = (Object.keys(USAGE_FIELD) as BudgetName[]).filter(key => {
    const actual = usage[USAGE_FIELD[key]];
    const limit = budget[key].value;
    return typeof actual === 'number' && typeof limit === 'number' && actual > limit;
  });
  const spent = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) > 0 || (usage.costUsd ?? 0) > 0;
  const wastedRun = spent && usage.acceptedArtifacts === 0 && !usage.objectiveMet;
  return { budgetHits: hits, wastedRun, wastedReason: wastedRun ? 'SPEND_WITHOUT_ACCEPTED_ARTIFACT_OR_OBJECTIVE' : null };
}

export function defaultRunBudget(): RunBudget {
  return {
    // Command adapters enforce their own timeouts; the general fabric does not yet.
    maxDurationMs: { value: 120_000, enforcement: 'NOT_ENFORCEABLE' },
    maxInputTokens: { value: null, enforcement: 'NOT_ENFORCEABLE' },
    maxOutputTokens: { value: null, enforcement: 'NOT_ENFORCEABLE' },
    maxToolCalls: { value: null, enforcement: 'NOT_ENFORCEABLE' },
    maxRetries: { value: null, enforcement: 'NOT_ENFORCEABLE' },
    maxCostUsd: { value: null, enforcement: 'NOT_ENFORCEABLE' },
  };
}
