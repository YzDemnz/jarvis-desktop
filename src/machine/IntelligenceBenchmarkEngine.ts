import type { LocalAIRuntime } from './localai/types';
import type { LocalModelConfiguration } from './ResourcePressureEngine';

export interface BenchmarkKey { hardwareFingerprint: string; runtimeId: string; modelId: string; configuration: string; }
export interface BenchmarkStore { saveBenchmark(key: BenchmarkKey, result: unknown): void; benchmark(key: BenchmarkKey): unknown | null; }
export interface BenchmarkTelemetry { ramBytes: number | null; vramBytes: number | null; cpuPercent: number | null; }
export interface IntelligenceBenchmarkResult {
  key: BenchmarkKey; startedAt: number; startupMs: number | null; timeToFirstTokenMs: number | null;
  tokensPerSecond: number | null; tokenCountEstimated: number | null; ramDeltaBytes: number | null;
  vramDeltaBytes: number | null; cpuPercent: number | null;
  structuredJsonReliable: boolean; instructionFollowed: boolean; toolSelectionReliable: boolean;
  routingReliable: boolean; trials: number; cancelled: boolean; error: string | null;
}

/** Short reproducible probes. One trial is evidence, not a model-wide guarantee. */
export class IntelligenceBenchmarkEngine {
  constructor(private readonly store: BenchmarkStore) {}
  async run(runtime: LocalAIRuntime, config: LocalModelConfiguration, hardwareFingerprint: string,
    sample: () => BenchmarkTelemetry, signal?: AbortSignal, timeoutMs = 90000): Promise<IntelligenceBenchmarkResult> {
    const key = { hardwareFingerprint, runtimeId: runtime.id, modelId: config.modelId, configuration: JSON.stringify(config) };
    const result: IntelligenceBenchmarkResult = { key, startedAt: Date.now(), startupMs: null, timeToFirstTokenMs: null,
      tokensPerSecond: null, tokenCountEstimated: null, ramDeltaBytes: null, vramDeltaBytes: null, cpuPercent: null,
      structuredJsonReliable: false, instructionFollowed: false, toolSelectionReliable: false, routingReliable: false,
      trials: 1, cancelled: false, error: null };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
    const before = sample();
    const delta = (a: number | null, b: number | null) => a === null || b === null ? null : Math.max(0, b - a);
    try {
      const startup = Date.now(); const health = await runtime.health(controller.signal);
      result.startupMs = Date.now() - startup;
      if (!health.online) throw new Error(health.error ?? 'Runtime offline');
      if (!runtime.generate) throw new Error('Generation unavailable');
      const prompt = 'Responde exactamente: JARVIS_OK';
      const streamStart = Date.now(); let output = ''; let first: number | null = null;
      if (runtime.stream) {
        for await (const part of runtime.stream({ model: config.modelId, prompt }, controller.signal)) {
          if (controller.signal.aborted) throw new Error('Cancelled');
          first ??= Date.now(); output += part;
        }
      } else output = await runtime.generate({ model: config.modelId, prompt }, controller.signal);
      const elapsed = Math.max(1, Date.now() - streamStart);
      result.timeToFirstTokenMs = first === null ? null : first - streamStart;
      result.tokenCountEstimated = Math.max(1, Math.ceil(output.length / 4));
      result.tokensPerSecond = Math.round((result.tokenCountEstimated / elapsed) * 1000 * 10) / 10;
      result.instructionFollowed = output.trim() === 'JARVIS_OK';
      const json = await runtime.generate({ model: config.modelId, prompt: 'Devuelve sólo {"ok":true,"n":7}', json: true }, controller.signal);
      try { const parsed = JSON.parse(json) as { ok?: unknown; n?: unknown }; result.structuredJsonReliable = parsed.ok === true && parsed.n === 7; } catch { /* invalid */ }
      const tool = await runtime.generate({ model: config.modelId, prompt: 'Elige herramienta para leer un archivo. Responde sólo JSON: {"tool":"file.read"}', json: true }, controller.signal);
      try { result.toolSelectionReliable = (JSON.parse(tool) as { tool?: string }).tool === 'file.read'; } catch { /* invalid */ }
      const route = await runtime.generate({ model: config.modelId, prompt: 'Clasifica "corrige test fallido". Responde sólo JSON: {"task":"coding"}', json: true }, controller.signal);
      try { result.routingReliable = (JSON.parse(route) as { task?: string }).task === 'coding'; } catch { /* invalid */ }
      const after = sample(); result.ramDeltaBytes = delta(before.ramBytes, after.ramBytes);
      result.vramDeltaBytes = delta(before.vramBytes, after.vramBytes); result.cpuPercent = after.cpuPercent;
    } catch (error) {
      result.cancelled = controller.signal.aborted || signal?.aborted === true;
      result.error = result.cancelled ? 'Cancelled or timed out' : error instanceof Error ? error.message : String(error);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    this.store.saveBenchmark(key, result);
    return result;
  }
}
