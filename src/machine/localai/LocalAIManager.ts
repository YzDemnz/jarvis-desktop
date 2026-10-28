import type { Acceleration, LocalAIState, LocalRuntimeId, RuntimeDetection } from '@/types';
import type { LocalAIRuntime } from './types';
import { LocalRuntimeRegistry } from './LocalRuntimeRegistry';

/**
 * Owns runtime discovery. The app asks this, never a specific vendor: if every
 * runtime is absent the answer is NOT_CONFIGURED and everything keeps working.
 */
export class LocalAIManager {
  private state: LocalAIState = {
    status: 'NOT_CONFIGURED', runtimes: [], activeRuntimeId: null,
    routerModelId: null, generalModelId: null, acceleration: 'unknown', discoveredAt: 0,
  };
  private listeners = new Set<(state: LocalAIState) => void>();

  private readonly registry: LocalRuntimeRegistry;
  constructor(runtimes: LocalAIRuntime[] | LocalRuntimeRegistry) {
    this.registry = runtimes instanceof LocalRuntimeRegistry ? runtimes : new LocalRuntimeRegistry(runtimes);
  }

  current(): LocalAIState {
    return { ...this.state, runtimes: this.state.runtimes.map((r) => ({ ...r })) };
  }

  subscribe(listener: (state: LocalAIState) => void): () => void {
    this.listeners.add(listener);
    listener(this.current());
    return () => { this.listeners.delete(listener); };
  }

  runtime(id: LocalRuntimeId): LocalAIRuntime | undefined {
    return this.registry.get(id);
  }

  /**
   * Probes every known runtime in parallel. A probe that throws is recorded as
   * an error for that runtime and never propagates — discovery must not be
   * able to break startup.
   */
  async discover(signal?: AbortSignal): Promise<LocalAIState> {
    const detections = await Promise.all(this.registry.list().map(async (r): Promise<RuntimeDetection> => {
      try {
        return await r.detect(signal);
      } catch (error) {
        return {
          runtimeId: r.id, name: r.name, detected: false, status: 'ERROR',
          endpoint: null, version: null, models: [], capabilities: r.capabilities(),
          error: error instanceof Error ? error.message : String(error), checkedAt: Date.now(),
        };
      }
    }));

    const ready = detections.find((d) => d.status === 'READY');
    const noModels = detections.find((d) => d.status === 'NO_MODELS');
    const offline = detections.find((d) => d.status === 'OFFLINE');
    const errored = detections.find((d) => d.status === 'ERROR');

    const status: LocalAIState['status'] = ready ? 'READY'
      : noModels ? 'NO_MODELS'
      : offline ? 'OFFLINE'
      : errored ? 'ERROR'
      : 'NOT_CONFIGURED';

    const active = ready ?? noModels ?? null;
    this.state = {
      status,
      runtimes: detections,
      activeRuntimeId: active?.runtimeId ?? null,
      routerModelId: this.state.routerModelId,
      generalModelId: this.state.generalModelId,
      acceleration: this.state.acceleration,
      discoveredAt: Date.now(),
    };
    this.emit();
    return this.current();
  }

  setSelection(selection: { routerModelId?: string | null; generalModelId?: string | null; acceleration?: Acceleration; activeRuntimeId?: LocalRuntimeId | null }): LocalAIState {
    this.state = {
      ...this.state,
      ...(selection.routerModelId !== undefined ? { routerModelId: selection.routerModelId } : {}),
      ...(selection.generalModelId !== undefined ? { generalModelId: selection.generalModelId } : {}),
      ...(selection.acceleration !== undefined ? { acceleration: selection.acceleration } : {}),
      ...(selection.activeRuntimeId !== undefined ? { activeRuntimeId: selection.activeRuntimeId } : {}),
    };
    this.emit();
    return this.current();
  }

  private emit(): void {
    const snapshot = this.current();
    this.listeners.forEach((l) => l(snapshot));
  }
}
