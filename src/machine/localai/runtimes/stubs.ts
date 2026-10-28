import type { InstalledModel, LocalRuntimeCapabilities, LocalRuntimeId, RuntimeDetection } from '@/types';
import type { LocalAIRuntime } from '../types';

/**
 * Declared runtimes with no implementation yet. They exist so the manager, the
 * recommendation engine and the UI are written against several runtimes from
 * the start. Main now uses the real LlamaCppRuntime; this legacy factory is
 * retained for compatibility tests only.
 *
 * They report NOT_CONFIGURED rather than pretending to be absent, which is the
 * truthful state: we have not looked.
 */
class UnimplementedRuntime implements LocalAIRuntime {
  constructor(
    readonly id: LocalRuntimeId,
    readonly name: string,
    private readonly accel: LocalRuntimeCapabilities['acceleration'],
  ) {}

  capabilities(): LocalRuntimeCapabilities {
    return { structuredOutput: false, streaming: false, embeddings: false, acceleration: this.accel };
  }

  async detect(): Promise<RuntimeDetection> {
    return {
      runtimeId: this.id, name: this.name, detected: false, status: 'NOT_CONFIGURED',
      endpoint: null, version: null, models: [], capabilities: this.capabilities(),
      error: 'Detección todavía no implementada para este runtime.', checkedAt: Date.now(),
    };
  }

  async health() { return { online: false, version: null, error: 'No implementado.' }; }
  async listModels(): Promise<InstalledModel[]> { return []; }
  async getVersion(): Promise<string | null> { return null; }
}

export const llamaCppRuntime = () => new UnimplementedRuntime('llamacpp', 'llama.cpp', ['unknown']);
export const lmStudioRuntime = () => new UnimplementedRuntime('lmstudio', 'LM Studio', ['unknown']);
export const openAICompatibleRuntime = () => new UnimplementedRuntime('openai-compatible', 'Servidor compatible OpenAI', ['unknown']);
