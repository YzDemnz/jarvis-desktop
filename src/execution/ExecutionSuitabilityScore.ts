import type { ExecutionProbe, ExecutionRealm, ExecutionRequest } from './types';

const PREFERENCE: Record<ExecutionRequest['task'], ExecutionRealm[]> = {
  DOCUMENT_ANALYSIS: ['BROKERED'], BROWSER_RESEARCH: ['BROKERED'],
  UI_GENERATION: ['WEB_ISOLATED', 'BROKERED'], CODING_WITH_SHELL: ['STRONG_ISOLATED', 'PROVIDER_NATIVE', 'BROKERED'],
  UNKNOWN_UNTRUSTED_AGENT: ['STRONG_ISOLATED'], SYSTEM_CONTROL: ['BROKERED'], RESEARCH_MOCK: ['BROKERED'], DOCUMENT_MOCK: ['BROKERED'],
};

/** Scores only already-eligible backends; never grants trust or relaxes a policy. */
export class ExecutionSuitabilityScore {
  preference(task: ExecutionRequest['task']): ExecutionRealm[] { return [...PREFERENCE[task]]; }
  score(task: ExecutionRequest['task'], probe: ExecutionProbe): number {
    const order = PREFERENCE[task].indexOf(probe.realm);
    if (order < 0) return Number.NEGATIVE_INFINITY;
    return 100 - order * 20 - Math.min(20, Math.floor((probe.capabilities.startupCostMs ?? 0) / 1000))
      + (probe.capabilities.trust === 'STRONG_ISOLATION' ? 8 : 0) + (probe.capabilities.artifacts ? 2 : 0);
  }
}
