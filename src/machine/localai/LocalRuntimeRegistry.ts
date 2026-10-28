import type { LocalRuntimeId } from '@/types';
import type { LocalAIRuntime } from './types';

/** Runtime registration is separate from model choice and provider routing. */
export class LocalRuntimeRegistry {
  private readonly entries = new Map<LocalRuntimeId, LocalAIRuntime>();
  constructor(runtimes: LocalAIRuntime[] = []) { runtimes.forEach((runtime) => this.register(runtime)); }
  register(runtime: LocalAIRuntime): void {
    if (this.entries.has(runtime.id)) throw new Error(`Duplicate runtime: ${runtime.id}`);
    this.entries.set(runtime.id, runtime);
  }
  get(id: LocalRuntimeId): LocalAIRuntime | undefined { return this.entries.get(id); }
  list(): LocalAIRuntime[] { return [...this.entries.values()]; }
}
