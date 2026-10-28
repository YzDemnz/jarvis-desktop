import type { InteractionStrategyName, StrategyAttempt, StrategyOutcome } from '@/types';

export const STRATEGY_ORDER: InteractionStrategyName[] = ['DIRECT', 'DOM', 'UI_AUTOMATION', 'VISION', 'INPUT'];

export interface StrategyStep<T> {
  strategy: InteractionStrategyName;
  /** Returns false when this strategy does not apply here (skipped, not failed). */
  applicable?: () => boolean | Promise<boolean>;
  run: (signal: AbortSignal) => Promise<T>;
  /** Did it actually work? Never assume a click means success. */
  verify?: (result: T, signal: AbortSignal) => Promise<boolean>;
}

export interface RetryPolicy {
  /** Attempts per strategy, including the first. Hard-capped. */
  maxAttempts: number;
  /** Total attempts across all strategies, as a second backstop. */
  maxTotalAttempts: number;
  delayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 2, maxTotalAttempts: 6, delayMs: 150 };
const HARD_ATTEMPT_CAP = 3;

/**
 * Tries the ladder top-down and stops at the first rung that works *and
 * verifies*. A lower rung never runs when a higher one succeeded, retries are
 * bounded twice over, and cancellation is honoured between every attempt —
 * so there is no path to an infinite loop.
 */
export async function runWithStrategies<T>(
  steps: StrategyStep<T>[],
  signal: AbortSignal,
  policy: RetryPolicy = DEFAULT_RETRY,
): Promise<StrategyOutcome<T>> {
  const perStrategy = Math.max(1, Math.min(HARD_ATTEMPT_CAP, policy.maxAttempts));
  const ordered = [...steps].sort((a, b) => STRATEGY_ORDER.indexOf(a.strategy) - STRATEGY_ORDER.indexOf(b.strategy));
  const attempts: StrategyAttempt[] = [];
  let total = 0;

  for (const step of ordered) {
    if (signal.aborted) return { ok: false, strategyUsed: null, attempts, error: 'Cancelado.' };
    if (step.applicable && !(await step.applicable())) continue;

    for (let attempt = 1; attempt <= perStrategy; attempt++) {
      if (signal.aborted) return { ok: false, strategyUsed: null, attempts, error: 'Cancelado.' };
      if (total >= policy.maxTotalAttempts) {
        return { ok: false, strategyUsed: null, attempts, error: 'Se agotó el número máximo de intentos.' };
      }
      total += 1;
      try {
        const result = await step.run(signal);
        const verified = step.verify ? await step.verify(result, signal) : true;
        attempts.push({ strategy: step.strategy, attempt, ok: true, verified });
        if (verified) return { ok: true, strategyUsed: step.strategy, attempts, result };
      } catch (error) {
        attempts.push({ strategy: step.strategy, attempt, ok: false, verified: false, error: error instanceof Error ? error.message : String(error) });
        // Permission and policy refusals will not change on retry.
        if (error instanceof Error && /no expone el patrón|credenciales|reservado|bloqueado|aprobación/i.test(error.message)) break;
      }
      if (attempt < perStrategy && policy.delayMs > 0) await delay(policy.delayMs, signal);
    }
  }

  const last = attempts.at(-1);
  return { ok: false, strategyUsed: null, attempts, error: last?.error ?? 'Ninguna estrategia aplicable.' };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
