import type { BenchmarkRating, BenchmarkResult, LocalRuntimeId } from '@/types';
import type { LocalAIRuntime } from './localai/types';
import { CancellationToken, CancelledError } from '@/agent';

export interface BenchmarkOptions {
  /** Deliberately tiny. This measures responsiveness, not throughput. */
  maxTokens?: number;
  timeoutMs?: number;
  /** Memory sampler, injected so the renderer and main can both supply one. */
  sampleMemory?: () => { ram: number | null; vram: number | null };
}

const STRUCTURED_PROMPT =
  'Devuelve exactamente este JSON y nada más: {"ok":true,"n":7}';

const COMPLETION_PROMPT = 'Responde en una sola frase corta: ¿para qué sirve un enrutador de tareas?';

/**
 * A short, controlled probe — never a stress test. Two small prompts are enough
 * to learn the two things that matter for a router: how fast it answers, and
 * whether it can be trusted to emit valid JSON.
 *
 * Honours the same cancellation primitive as the agent, so STOP AGENT aborts it.
 */
export class LocalModelBenchmark {
  async run(
    runtime: LocalAIRuntime,
    modelId: string,
    token: CancellationToken = new CancellationToken(),
    options: BenchmarkOptions = {},
  ): Promise<BenchmarkResult> {
    const base: BenchmarkResult = {
      modelId,
      runtimeId: runtime.id as LocalRuntimeId,
      available: false,
      timeToFirstTokenMs: null,
      tokensPerSecond: null,
      structuredOutputSuccess: false,
      completionSuccess: false,
      ramDeltaBytes: null,
      vramDeltaBytes: null,
      rating: 'NOT_RECOMMENDED',
      cancelled: false,
      error: null,
      ranAt: Date.now(),
    };

    if (token.cancelled) return { ...base, cancelled: true, error: 'Cancelado antes de empezar.' };
    if (!runtime.generate) {
      return { ...base, error: `${runtime.name} todavía no soporta ejecución medible.` };
    }

    const before = options.sampleMemory?.() ?? { ram: null, vram: null };

    try {
      const health = await runtime.health();
      token.throwIfCancelled();
      if (!health.online) return { ...base, error: health.error ?? 'El runtime no responde.' };

      // 1) Structured output. A router that cannot do this is unusable as one.
      const structuredStart = Date.now();
      const structured = await runtime.generate(
        { model: modelId, prompt: STRUCTURED_PROMPT, json: true },
        token.signal,
      );
      const structuredLatency = Date.now() - structuredStart;
      token.throwIfCancelled();
      const structuredOk = isValidStructured(structured);

      // 2) A short completion, to estimate throughput.
      const completionStart = Date.now();
      const completion = await runtime.generate(
        { model: modelId, prompt: COMPLETION_PROMPT },
        token.signal,
      );
      const elapsed = Math.max(1, Date.now() - completionStart);
      token.throwIfCancelled();

      const completionOk = completion.trim().length > 0;

      const after = options.sampleMemory?.() ?? { ram: null, vram: null };
      const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.max(0, b - a));

      return {
        ...base,
        available: true,
        // String-only adapters expose neither first-token events nor tokenizer
        // counts. End-to-end duration is not TTFT; words are not tokens.
        timeToFirstTokenMs: null,
        tokensPerSecond: null,
        structuredOutputSuccess: structuredOk,
        completionSuccess: completionOk,
        ramDeltaBytes: delta(before.ram, after.ram),
        vramDeltaBytes: delta(before.vram, after.vram),
        rating: !structuredOk || !completionOk ? 'NOT_RECOMMENDED' : Math.max(structuredLatency, elapsed) > 30000 ? 'SLOW' : 'USABLE',
      };
    } catch (error) {
      if (token.cancelled || error instanceof CancelledError) {
        return { ...base, cancelled: true, error: 'Benchmark cancelado.' };
      }
      return { ...base, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** Valid JSON with the shape asked for. Prose around it counts as a failure. */
export function isValidStructured(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (!parsed || typeof parsed !== 'object') return false;
    const value = parsed as Record<string, unknown>;
    return value.ok === true && value.n === 7;
  } catch {
    return false;
  }
}

export function rate(
  timeToFirstTokenMs: number,
  tokensPerSecond: number,
  structuredOk: boolean,
  completionOk: boolean,
): BenchmarkRating {
  // A model that cannot hold the JSON contract is not a router at any speed.
  if (!structuredOk || !completionOk) return 'NOT_RECOMMENDED';
  if (timeToFirstTokenMs <= 400 && tokensPerSecond >= 30) return 'EXCELLENT';
  if (timeToFirstTokenMs <= 1200 && tokensPerSecond >= 15) return 'GOOD';
  if (timeToFirstTokenMs <= 3000 && tokensPerSecond >= 6) return 'USABLE';
  return 'SLOW';
}

export const localModelBenchmark = new LocalModelBenchmark();
