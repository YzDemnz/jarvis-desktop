import type { AuditEntry, PermissionLevel, ToolId, ToolRisk } from '@/types';
import { summarizeArgs } from './redaction';
import { uid } from '@/lib/id';

export interface AuditDraft {
  runId: string;
  stepId?: string;
  actor: AuditEntry['actor'];
  tool: ToolId;
  action: string;
  args?: unknown;
  permission: PermissionLevel;
  risk: ToolRisk;
  approval: AuditEntry['approval'];
  result: AuditEntry['result'];
  error?: string;
  durationMs: number;
}

/**
 * Append-only trail of everything the agent did or was stopped from doing.
 * Arguments are summarised and redacted on the way in, so a secret never
 * reaches the log even if a future tool receives one.
 */
export class AuditService {
  private entries: AuditEntry[] = [];
  private listeners = new Set<(entry: AuditEntry) => void>();

  constructor(private readonly limit = 2000) {}

  record(draft: AuditDraft): AuditEntry {
    const entry: AuditEntry = {
      id: uid('audit'),
      timestamp: Date.now(),
      runId: draft.runId,
      ...(draft.stepId ? { stepId: draft.stepId } : {}),
      actor: draft.actor,
      tool: draft.tool,
      action: draft.action,
      argsSummary: summarizeArgs(draft.args),
      permission: draft.permission,
      risk: draft.risk,
      approval: draft.approval,
      result: draft.result,
      ...(draft.error ? { error: summarizeArgs(draft.error, 300) } : {}),
      durationMs: Math.max(0, Math.round(draft.durationMs)),
    };
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    this.listeners.forEach((l) => l(entry));
    return entry;
  }

  list(runId?: string): AuditEntry[] {
    const all = [...this.entries].reverse();
    return runId ? all.filter((e) => e.runId === runId) : all;
  }

  subscribe(listener: (entry: AuditEntry) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  clear(): void {
    this.entries = [];
  }
}

export const auditService = new AuditService();
