import type { ChangeSet, ChangeSetSummary, FileChange } from '@/types';
import type { Hunk } from './patch';

/**
 * Every file operation JARVIS makes during a run, in order. The store holds
 * metadata and hunks only; pre-change contents live in the SnapshotPort, and
 * only for the files actually touched.
 */
export class ChangeSetStore {
  private sets = new Map<string, ChangeSet>();
  private hunks = new Map<string, Hunk[]>();
  private order: string[] = [];

  begin(runId: string, projectRoot: string | null, preExisting: string[] = []): ChangeSet {
    const existing = this.sets.get(runId);
    if (existing) {
      existing.preExisting = [...new Set([...existing.preExisting, ...preExisting])];
      return existing;
    }
    const set: ChangeSet = { runId, projectRoot, created: Date.now(), updated: Date.now(), changes: [], preExisting, reverted: false };
    this.sets.set(runId, set);
    this.order.push(runId);
    return set;
  }

  record(runId: string, change: FileChange, hunks?: Hunk[]): void {
    const set = this.begin(runId, null);
    set.changes.push(change);
    set.updated = Date.now();
    if (hunks) this.hunks.set(`${runId}#${set.changes.length - 1}`, hunks);
  }

  hunksOf(runId: string, index: number): Hunk[] | undefined { return this.hunks.get(`${runId}#${index}`); }
  get(runId: string): ChangeSet | undefined { return this.sets.get(runId); }
  list(): ChangeSet[] { return this.order.map((id) => this.sets.get(id)!).filter(Boolean); }

  /** Most recent run with un-reverted changes. */
  latest(): ChangeSet | undefined {
    return [...this.list()].reverse().find((s) => !s.reverted && s.changes.some((c) => !c.undone));
  }

  /** Files touched, collapsed to their net status, for Review Changes. */
  summary(runId: string): ChangeSetSummary | null {
    const set = this.sets.get(runId);
    if (!set) return null;
    const files = new Map<string, ChangeSetSummary['files'][number]>();
    let totalBytes = 0;
    for (const c of set.changes) {
      if (c.undone) continue;
      totalBytes += Math.abs(c.bytesAfter - c.bytesBefore);
      switch (c.operation) {
        case 'create': case 'mkdir': files.set(c.path, { path: c.path, status: 'A' }); break;
        case 'write': case 'patch': if (files.get(c.path)?.status !== 'A') files.set(c.path, { path: c.path, status: 'M' }); break;
        case 'rename': case 'move': files.delete(c.path); files.set(c.toPath!, { path: c.path, status: 'R', toPath: c.toPath! }); break;
        case 'copy': files.set(c.toPath!, { path: c.toPath!, status: 'C' }); break;
        case 'trash': files.set(c.path, { path: c.path, status: 'T' }); break;
      }
    }
    return { runId, projectRoot: set.projectRoot, preExisting: [...set.preExisting], files: [...files.values()], totalBytes, reverted: set.reverted };
  }

  forget(runId: string): void {
    const set = this.sets.get(runId);
    if (!set) return;
    set.changes.forEach((_c, i) => this.hunks.delete(`${runId}#${i}`));
    this.sets.delete(runId);
    this.order = this.order.filter((id) => id !== runId);
  }

  markReverted(runId: string): void {
    const set = this.sets.get(runId);
    if (set) set.reverted = true;
  }
}

/** Pure mass-change evaluation over a whole run, not one call at a time. */
export interface MassLimits { maxFiles: number; maxBytes: number; maxTrash: number }
export const DEFAULT_MASS_LIMITS: MassLimits = { maxFiles: 50, maxBytes: 100 * 1024 * 1024, maxTrash: 10 };

export function massChangeReason(set: ChangeSet | undefined, pending: { path: string; bytes: number; trash: boolean; files?: number }, limits: MassLimits = DEFAULT_MASS_LIMITS): string | null {
  const paths = new Set((set?.changes ?? []).map((c) => c.toPath ?? c.path));
  paths.add(pending.path);
  const fileCount = paths.size + Math.max(0, (pending.files ?? 1) - 1);
  const bytes = (set?.changes ?? []).reduce((n, c) => n + Math.max(c.bytesAfter, c.bytesBefore), 0) + pending.bytes;
  const trashed = (set?.changes ?? []).filter((c) => c.operation === 'trash').length + (pending.trash ? pending.files ?? 1 : 0);
  if (fileCount > limits.maxFiles) return `Esta tarea ya afecta a ${fileCount} archivos (límite ${limits.maxFiles}).`;
  if (bytes > limits.maxBytes) return `Esta tarea mueve ${Math.round(bytes / 1048576)} MB (límite ${Math.round(limits.maxBytes / 1048576)} MB).`;
  if (trashed > limits.maxTrash) return `Esta tarea enviaría ${trashed} elementos a la papelera (límite ${limits.maxTrash}).`;
  return null;
}
