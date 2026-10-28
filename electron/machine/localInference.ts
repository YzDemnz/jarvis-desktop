import { ollamaProvider } from '../agent/OllamaProvider';
import { LocalAIManager } from '../../src/machine/localai/LocalAIManager';
import { OllamaRuntimeAdapter } from '../../src/machine/localai/runtimes/OllamaRuntimeAdapter';
import { lmStudioRuntime, openAICompatibleRuntime } from '../../src/machine/localai/runtimes/stubs';
import { LlamaCppRuntime } from './LlamaCppRuntime';

/** Single runtime registry for the main process. All model calls select through it. */
export const localAIManager = new LocalAIManager([
  new OllamaRuntimeAdapter({
    health: (force) => ollamaProvider.health(force),
    listModels: () => ollamaProvider.listModels(),
    generate: (input, signal) => ollamaProvider.generate({ model: input.model, prompt: input.prompt,
      ...(input.system ? { system: input.system } : {}), ...(input.format ? { format: input.format } : {}),
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}) }, signal),
  }),
  new LlamaCppRuntime(), lmStudioRuntime(), openAICompatibleRuntime(),
]);

export async function selectLocalInference(): Promise<{ runtime: NonNullable<ReturnType<typeof localAIManager.runtime>>; model: string } | null> {
  const state = await localAIManager.discover();
  const runtime = state.activeRuntimeId ? localAIManager.runtime(state.activeRuntimeId) : undefined;
  const detection = state.runtimes.find((item) => item.runtimeId === state.activeRuntimeId);
  const model = state.routerModelId ?? detection?.models[0]?.name;
  return runtime?.generate && model ? { runtime, model } : null;
}
