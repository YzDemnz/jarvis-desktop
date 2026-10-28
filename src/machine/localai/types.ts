import type { InstalledModel, LocalRuntimeCapabilities, LocalRuntimeId, RuntimeDetection } from '@/types';

/**
 * One runtime, one adapter. The app talks to this interface and never to
 * Ollama directly, so a machine running llama.cpp or LM Studio is a
 * configuration difference rather than a code change.
 */
export interface LocalAIRuntime {
  readonly id: LocalRuntimeId;
  readonly name: string;
  /** Is it installed and reachable at all? Must never throw. */
  detect(signal?: AbortSignal): Promise<RuntimeDetection>;
  health(signal?: AbortSignal): Promise<{ online: boolean; version: string | null; error: string | null }>;
  listModels(signal?: AbortSignal): Promise<InstalledModel[]>;
  capabilities(): LocalRuntimeCapabilities;
  getVersion(signal?: AbortSignal): Promise<string | null>;
  /** Used by the benchmark. Absent means the runtime cannot be measured yet. */
  generate?(input: { model: string; prompt: string; system?: string; json?: boolean; timeoutMs?: number }, signal?: AbortSignal): Promise<string>;
  stream?(input: { model: string; prompt: string; system?: string; json?: boolean }, signal?: AbortSignal): AsyncIterable<string>;
}
