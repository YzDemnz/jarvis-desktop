import fs from 'node:fs';
import path from 'node:path';
import type { ExecutionArtifact, ExecutionAudit, ExecutionNetwork, ExecutionRealm, ExecutionResult, ExecutionTrust } from './types';
import type { ExecutionRoute } from './ExecutionRouter';
import type { BudgetOutcome, RunUsageSnapshot } from './RunBudget';

export interface ExecutionRunRecord {
  runId: string; conversationId: string; sessionId: string; backendId: string; realm: ExecutionRealm;
  providerId: string | null; agentId: string | null; trust: ExecutionTrust; network: ExecutionNetwork;
  startedAt: number; endedAt: number | null; status: 'RUNNING' | ExecutionResult['status'];
  artifactIds: string[]; usageRecordIds: string[]; commandLabels: string[];
  securityClassification: string; durationMs: number | null;
}
export type ProjectTrustState = 'TRUSTED' | 'UNKNOWN' | 'UNTRUSTED';
export type ProjectTrustSource = 'EXPLICIT_USER' | 'JARVIS_CREATED' | 'WORKSPACE_POLICY' | 'REVOKED';
export interface ProjectTrustChange {
  id: string; runId: string | null; canonicalRoot: string; projectIdentity: string;
  state: ProjectTrustState; source: ProjectTrustSource; reason: string; at: number;
}
export interface ScratchLedgerEntry {
  id: string; runId: string; scratchId: string; at: number;
  event: 'CREATED' | 'PATCH_APPLIED' | 'COMMAND' | 'TEST_RESULT' | 'DIFF' | 'IMPORT' | 'CONFLICT' | 'STOPPED' | 'CLEANED';
  detail: Record<string, string | number | boolean | null | string[]>;
}
export interface RealVerifyLedgerEntry {
  id: string; runId: string; at: number; canonicalRoot: string;
  status: 'REAL_VERIFY_PASS' | 'REAL_VERIFY_FAIL' | 'REAL_VERIFY_SKIPPED_UNTRUSTED';
  script: string; literalScript: string | null; environmentNames: string[];
  exitCode: number | null; reason: string | null;
}
export type ExecutionLedgerEvent =
  | { kind: 'RUN'; at: number; record: ExecutionRunRecord }
  | { kind: 'ROUTE'; at: number; runId: string; route: ExecutionRoute }
  | { kind: 'PROJECT_TRUST'; at: number; change: ProjectTrustChange }
  | { kind: 'SCRATCH'; at: number; entry: ScratchLedgerEntry }
  | { kind: 'REAL_VERIFY'; at: number; entry: RealVerifyLedgerEntry }
  | { kind: 'BUDGET'; at: number; runId: string; usage: RunUsageSnapshot; outcome: BudgetOutcome }
  | { kind: 'AUDIT'; at: number; audit: ExecutionAudit }
  | { kind: 'ARTIFACT'; at: number; artifact: ExecutionArtifact };
export interface ExecutionStore { append(event: ExecutionLedgerEvent): void; list(): ExecutionLedgerEvent[] }

export class MemoryExecutionStore implements ExecutionStore {
  private events: ExecutionLedgerEvent[] = [];
  append(event: ExecutionLedgerEvent): void { this.events.push(structuredClone(event)); }
  list(): ExecutionLedgerEvent[] { return structuredClone(this.events); }
}

/** Local PoC persistence. The caller supplies a JARVIS-owned path, never a capsule path. */
export class JsonlExecutionStore implements ExecutionStore {
  constructor(private readonly file: string) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
  append(event: ExecutionLedgerEvent): void { fs.appendFileSync(this.file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' }); }
  list(): ExecutionLedgerEvent[] {
    if (!fs.existsSync(this.file)) return [];
    return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as ExecutionLedgerEvent);
  }
}

export class ExecutionLedger {
  constructor(private readonly store: ExecutionStore) {}
  route(runId: string, route: ExecutionRoute): void { this.store.append({ kind: 'ROUTE', at: Date.now(), runId, route }); }
  projectTrust(change: ProjectTrustChange): void { this.store.append({ kind: 'PROJECT_TRUST', at: change.at, change }); }
  scratch(entry: ScratchLedgerEntry): void { this.store.append({ kind: 'SCRATCH', at: entry.at, entry }); }
  realVerify(entry: RealVerifyLedgerEntry): void { this.store.append({ kind: 'REAL_VERIFY', at: entry.at, entry }); }
  budget(runId: string, usage: RunUsageSnapshot, outcome: BudgetOutcome): void {
    this.store.append({ kind: 'BUDGET', at: Date.now(), runId, usage, outcome });
  }
  projectTrustHistory(canonicalRoot: string): ProjectTrustChange[] { return this.store.list()
    .filter((e): e is Extract<ExecutionLedgerEvent, { kind: 'PROJECT_TRUST' }> =>
      e.kind === 'PROJECT_TRUST' && e.change.canonicalRoot === canonicalRoot).map(e => e.change); }
  start(record: ExecutionRunRecord): void { this.store.append({ kind: 'RUN', at: Date.now(), record: { ...record, status: 'RUNNING' } }); }
  finish(record: ExecutionRunRecord): void { this.store.append({ kind: 'RUN', at: Date.now(), record }); }
  audit(entry: ExecutionAudit): void { this.store.append({ kind: 'AUDIT', at: Date.now(), audit: entry }); }
  artifact(entry: ExecutionArtifact): void { this.store.append({ kind: 'ARTIFACT', at: Date.now(), artifact: entry }); }
  run(runId: string): ExecutionRunRecord | null {
    const entries = this.store.list().filter((e): e is Extract<ExecutionLedgerEvent, { kind: 'RUN' }> => e.kind === 'RUN' && e.record.runId === runId);
    return entries.at(-1)?.record ?? null;
  }
  events(runId: string): ExecutionLedgerEvent[] { return this.store.list().filter(e => e.kind === 'RUN' ? e.record.runId === runId
    : e.kind === 'ROUTE' ? e.runId === runId : e.kind === 'PROJECT_TRUST' ? e.change.runId === runId
      : e.kind === 'SCRATCH' ? e.entry.runId === runId
      : e.kind === 'REAL_VERIFY' ? e.entry.runId === runId
      : e.kind === 'BUDGET' ? e.runId === runId
      : e.kind === 'AUDIT' ? e.audit.runId === runId : e.artifact.runId === runId); }
}
