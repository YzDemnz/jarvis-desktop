import type { ApprovalRequest, ApprovalVerdict } from '@/types';

interface Pending {
  request: ApprovalRequest;
  resolve: (verdict: ApprovalVerdict) => void;
}

/**
 * Holds a tool call until a human decides. Four outcomes, no "always allow
 * forever" — a destructive action has to be re-approved every run, on purpose.
 *
 * Pending approvals are resolved, never dropped: cancelling a run settles every
 * open request as `cancel_run` so no caller is left awaiting a promise.
 */
export class ApprovalEngine {
  private pending = new Map<string, Pending>();
  private listeners = new Set<(request: ApprovalRequest | null) => void>();

  request(request: ApprovalRequest): Promise<ApprovalVerdict> {
    return new Promise<ApprovalVerdict>((resolve) => {
      this.pending.set(request.id, { request, resolve });
      this.notify();
    });
  }

  resolve(id: string, verdict: ApprovalVerdict): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    entry.resolve(verdict);
    this.notify();
    return true;
  }

  /** Resolve the oldest open request — what the single-dialog UI drives. */
  resolveCurrent(verdict: ApprovalVerdict): boolean {
    const current = this.current();
    return current ? this.resolve(current.id, verdict) : false;
  }

  cancelRun(runId: string, verdict: ApprovalVerdict = 'cancel_run'): number {
    let count = 0;
    for (const [id, entry] of [...this.pending.entries()]) {
      if (entry.request.runId !== runId) continue;
      this.pending.delete(id);
      entry.resolve(verdict);
      count += 1;
    }
    if (count) this.notify();
    return count;
  }

  cancelAll(verdict: ApprovalVerdict = 'cancel_run'): number {
    let count = 0;
    for (const [id, entry] of [...this.pending.entries()]) {
      this.pending.delete(id);
      entry.resolve(verdict);
      count += 1;
    }
    if (count) this.notify();
    return count;
  }

  current(): ApprovalRequest | null {
    const first = this.pending.values().next();
    return first.done ? null : first.value.request;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  subscribe(listener: (request: ApprovalRequest | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.current());
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    const current = this.current();
    this.listeners.forEach((l) => l(current));
  }
}

export const approvalEngine = new ApprovalEngine();
