import type { ProjectIndexer } from './ProjectIndexer';
import { relative, isWithin } from './paths';
import type { PathFlavor } from './paths';

export interface WatchPort {
  /** Calls back with a path relative to root (any separator). Returns a closer. */
  watch(root: string, onChange: (relPath: string) => void): () => void;
}

export interface WatchEvent {
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  path: string;
  toPath?: string;
  /** True when JARVIS itself caused it. */
  self: boolean;
}

/**
 * Turns raw filesystem notifications into index updates and typed events.
 *
 * Loop protection: FileMutationService announces every write it is about to
 * make (expectSelfWrite). Events for those paths still update the index — it
 * must reflect reality — but are marked `self` and never reach the external
 * change listeners, so JARVIS never reacts to its own writes.
 */
export class ProjectWatcher {
  private close: (() => void) | null = null;
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private selfWrites = new Map<string, number>();
  private listeners = new Set<(e: WatchEvent) => void>();
  private recentDeletes: { path: string; at: number }[] = [];

  constructor(
    private readonly port: WatchPort,
    private readonly indexer: ProjectIndexer,
    private readonly flavor: PathFlavor,
    private readonly debounceMs = 80,
  ) {}

  start(): void {
    if (this.close) return;
    this.close = this.port.watch(this.indexer.root, (raw) => this.schedule(raw.split(/[\\/]/).join('/')));
  }

  stop(): void {
    this.close?.();
    this.close = null;
    this.pending.forEach((t) => clearTimeout(t));
    this.pending.clear();
  }

  /** Absolute path, as FileMutationService knows it. */
  expectSelfWrite(absPath: string): void {
    if (!isWithin(this.indexer.root, absPath, this.flavor)) return;
    this.selfWrites.set(relative(this.indexer.root, absPath, this.flavor), Date.now() + 3000);
  }

  onChange(listener: (e: WatchEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private schedule(rel: string): void {
    if (!rel) return;
    const existing = this.pending.get(rel);
    if (existing) clearTimeout(existing);
    this.pending.set(rel, setTimeout(() => { this.pending.delete(rel); void this.flush(rel); }, this.debounceMs));
  }

  private async flush(rel: string): Promise<void> {
    const outcome = await this.indexer.update(rel);
    if (outcome === 'ignored') return;
    const until = this.selfWrites.get(rel);
    const self = until !== undefined && until > Date.now();
    if (self) this.selfWrites.delete(rel);

    let event: WatchEvent = { type: outcome === 'added' ? 'created' : outcome === 'removed' ? 'deleted' : 'modified', path: rel, self };
    const now = Date.now();
    this.recentDeletes = this.recentDeletes.filter((d) => now - d.at < 500);
    if (event.type === 'deleted') this.recentDeletes.push({ path: rel, at: now });
    else if (event.type === 'created') {
      // A delete and a create of a same-named file moments apart: a rename.
      const name = rel.split('/').pop();
      const pair = this.recentDeletes.find((d) => d.path.split('/').pop() === name || d.path.split('/').slice(0, -1).join('/') === rel.split('/').slice(0, -1).join('/'));
      if (pair) {
        this.recentDeletes = this.recentDeletes.filter((d) => d !== pair);
        event = { type: 'renamed', path: pair.path, toPath: rel, self };
      }
    }
    if (!self) this.listeners.forEach((l) => l(event));
  }
}
