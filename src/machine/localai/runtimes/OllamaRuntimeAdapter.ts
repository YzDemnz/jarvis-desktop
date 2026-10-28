import type { InstalledModel, LocalRuntimeCapabilities, RuntimeDetection } from '@/types';
import type { LocalAIRuntime } from '../types';

/** What the adapter needs from the outside world, so it can be tested. */
export interface OllamaTransport {
  health(force?: boolean): Promise<{ online: boolean; endpoint: string; version?: string; models: unknown[]; error?: string }>;
  listModels(): Promise<{ name: string; size: number; family: string; parameterSize: string }[]>;
  generate?(input: { model: string; prompt: string; system?: string; format?: 'json'; timeoutMs?: number }, signal?: AbortSignal): Promise<string>;
}

/**
 * Wraps the existing OllamaProvider behind the runtime interface. Nothing here
 * assumes Ollama is present: an absent daemon is a normal, non-fatal state.
 */
export class OllamaRuntimeAdapter implements LocalAIRuntime {
  readonly id = 'ollama' as const;
  readonly name = 'Ollama';

  constructor(private readonly transport: OllamaTransport) {}

  capabilities(): LocalRuntimeCapabilities {
    return {
      structuredOutput: true,
      streaming: true,
      embeddings: true,
      // Ollama picks its own backend; what it will actually use depends on the
      // machine, so the honest answer is "any of these, decided at runtime".
      acceleration: ['cpu', 'nvidia', 'amd', 'metal'],
    };
  }

  async health(): Promise<{ online: boolean; version: string | null; error: string | null }> {
    try {
      const h = await this.transport.health();
      return { online: h.online, version: h.version ?? null, error: h.error ?? null };
    } catch (error) {
      return { online: false, version: null, error: describe(error) };
    }
  }

  async getVersion(): Promise<string | null> {
    return (await this.health()).version;
  }

  async listModels(): Promise<InstalledModel[]> {
    try {
      const models = await this.transport.listModels();
      return models.map((m) => ({
        id: `ollama:${m.name}`,
        runtimeId: 'ollama' as const,
        name: m.name,
        family: m.family || null,
        parameterSize: m.parameterSize || null,
        quantization: quantizationOf(m.name),
        diskBytes: m.size > 0 ? m.size : null,
      }));
    } catch {
      return [];
    }
  }

  async detect(): Promise<RuntimeDetection> {
    const base: RuntimeDetection = {
      runtimeId: 'ollama', name: 'Ollama', detected: false, status: 'NOT_CONFIGURED',
      endpoint: null, version: null, models: [], capabilities: this.capabilities(),
      error: null, checkedAt: Date.now(),
    };

    let endpoint: string | null = null;
    try {
      const h = await this.transport.health();
      endpoint = h.endpoint ?? null;
      if (!h.online) {
        return { ...base, endpoint, status: 'OFFLINE', error: h.error ?? 'Sin respuesta.' };
      }
    } catch (error) {
      return { ...base, endpoint, status: 'OFFLINE', error: describe(error) };
    }

    const models = await this.listModels();
    const version = await this.getVersion();
    return {
      ...base,
      detected: true,
      status: models.length ? 'READY' : 'NO_MODELS',
      endpoint,
      version,
      models,
    };
  }

  async generate(input: { model: string; prompt: string; system?: string; json?: boolean; timeoutMs?: number }, signal?: AbortSignal): Promise<string> {
    if (!this.transport.generate) throw new Error('El transporte no soporta generación.');
    return this.transport.generate({
      model: input.model,
      prompt: input.prompt,
      ...(input.system ? { system: input.system } : {}),
      ...(input.json ? { format: 'json' as const } : {}),
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    }, signal);
  }
}

function quantizationOf(name: string): string | null {
  const match = name.match(/\b(q\d(?:_[a-z0-9]+)*|f16|f32|bf16)\b/i);
  return match ? match[0].toUpperCase() : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
