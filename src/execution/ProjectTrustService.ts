import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { PathGuard } from '../dev/PathGuard';
import type { GitService } from '../dev/GitService';
import { ExecutionLedger, type ProjectTrustSource, type ProjectTrustState } from './ExecutionLedger';

export type HostExecutionMode = 'BROKERED_SCRATCH_APPLY' | 'REAL_VERIFY' | 'UI_SCRATCH_PREVIEW';
export interface ProjectIdentityPort { identify(canonicalRoot: string): Promise<string | null> }
export interface ProjectTrustDecision {
  state: ProjectTrustState; canonicalRoot: string; projectIdentity: string | null;
  source: ProjectTrustSource | null; reason: string;
}

/** Git root history or Windows filesystem object identity; never name/location-based trust. */
export class NodeProjectIdentity implements ProjectIdentityPort {
  constructor(private readonly git: Pick<GitService, 'rootCommits'>) {}
  async identify(canonicalRoot: string): Promise<string | null> {
    const roots = await this.git.rootCommits(canonicalRoot);
    if (roots.length) return `git:${createHash('sha256').update(JSON.stringify(roots)).digest('hex')}`;
    const stat = fs.statSync(canonicalRoot, { bigint: true });
    if (!stat.isDirectory() || (stat.dev === 0n && stat.ino === 0n)) return null;
    const identity = [String(stat.dev), String(stat.ino), String(stat.birthtimeNs)];
    return `fs:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
  }
}

export function mayExecuteProjectCode(decision: ProjectTrustDecision, mode: HostExecutionMode): boolean {
  return decision.state === 'TRUSTED' && ['BROKERED_SCRATCH_APPLY', 'REAL_VERIFY', 'UI_SCRATCH_PREVIEW'].includes(mode);
}

/** Trust changes use the shared append-only ExecutionLedger; no production routing is wired here. */
export class ProjectTrustService {
  constructor(private readonly guard: PathGuard, private readonly identity: ProjectIdentityPort,
    private readonly ledger: ExecutionLedger) {}
  private async resolve(project: string): Promise<{ canonicalRoot: string; projectIdentity: string | null }> {
    const canonicalRoot = await this.guard.canonical(project);
    const checked = await this.guard.check(canonicalRoot, { write: false });
    if (!checked.root || !fs.statSync(canonicalRoot).isDirectory()) throw new Error('PROJECT_TRUST_ROOT_NOT_AUTHORIZED');
    return { canonicalRoot, projectIdentity: await this.identity.identify(canonicalRoot) };
  }
  async status(project: string): Promise<ProjectTrustDecision> {
    const { canonicalRoot, projectIdentity } = await this.resolve(project);
    if (!projectIdentity) return { state: 'UNKNOWN', canonicalRoot, projectIdentity: null, source: null, reason: 'PROJECT_IDENTITY_UNAVAILABLE' };
    const last = this.ledger.projectTrustHistory(canonicalRoot).at(-1);
    if (!last) return { state: 'UNKNOWN', canonicalRoot, projectIdentity, source: null, reason: 'NO_TRUST_GRANT' };
    if (last.projectIdentity !== projectIdentity) return { state: 'UNKNOWN', canonicalRoot, projectIdentity,
      source: null, reason: 'PROJECT_IDENTITY_CHANGED' };
    return { state: last.state, canonicalRoot, projectIdentity, source: last.source, reason: last.reason };
  }
  async grant(project: string, source: Exclude<ProjectTrustSource, 'REVOKED'>, reason: string, runId: string | null = null): Promise<ProjectTrustDecision> {
    if (!reason.trim()) throw new Error('PROJECT_TRUST_REASON_REQUIRED');
    const { canonicalRoot, projectIdentity } = await this.resolve(project);
    if (!projectIdentity) throw new Error('PROJECT_IDENTITY_UNAVAILABLE');
    this.ledger.projectTrust({ id: randomUUID(), runId, canonicalRoot, projectIdentity,
      state: 'TRUSTED', source, reason, at: Date.now() });
    return this.status(project);
  }
  async revoke(project: string, reason: string, runId: string | null = null): Promise<ProjectTrustDecision> {
    if (!reason.trim()) throw new Error('PROJECT_TRUST_REASON_REQUIRED');
    const { canonicalRoot, projectIdentity } = await this.resolve(project);
    if (!projectIdentity) throw new Error('PROJECT_IDENTITY_UNAVAILABLE');
    this.ledger.projectTrust({ id: randomUUID(), runId, canonicalRoot, projectIdentity,
      state: 'UNTRUSTED', source: 'REVOKED', reason, at: Date.now() });
    return this.status(project);
  }
}
