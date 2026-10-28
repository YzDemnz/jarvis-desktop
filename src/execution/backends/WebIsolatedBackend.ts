import { ExecutionBackendBase } from '../ExecutionBackendBase';
import type { ExecutionArtifact, ExecutionCapability, ExecutionProbe, ExecutionRequest, ExecutionResult, ExecutionSession } from '../types';

export interface WebRuntimePort {
  probe(): Promise<{ available: boolean; evidence: string[] }>;
  run(request: ExecutionRequest): Promise<{ summary: string; artifacts: ExecutionArtifact[]; durationMs: number }>;
  cancel(runId: string): Promise<void>;
}
const CAP: ExecutionCapability = {
  filesystemIsolation: 'VIRTUAL', processIsolation: 'BROWSER', networkIsolation: 'BROWSER', credentialIsolation: 'VIRTUAL',
  uiIsolation: 'BROWSER', shell: true, git: false, packageManager: true, browser: true, artifacts: true,
  persistence: false, resume: false, pause: false, startupCostMs: null, trust: 'LIMITED_ISOLATION',
};

/** Real WebContainer license/runtime remains a separate ephemeral PoC, not a bundled dependency. */
export class WebIsolatedBackend extends ExecutionBackendBase {
  readonly id = 'web-isolated-poc'; readonly realm = 'WEB_ISOLATED' as const;
  private artifacts = new Map<string, ExecutionArtifact[]>();
  constructor(private readonly runtime: WebRuntimePort | null = null) { super(); }
  capabilities(): ExecutionCapability { return CAP; }
  async probe(): Promise<ExecutionProbe> { const p = await this.runtime?.probe(); return {
    backendId: this.id, realm: this.realm, status: p?.available ? 'AVAILABLE' : 'NOT_AVAILABLE',
    evidence: p?.evidence ?? ['No licensed/attested Web runtime bundled'], at: Date.now(), capabilities: CAP,
  }; }
  async execute(session: ExecutionSession, request: ExecutionRequest): Promise<ExecutionResult> {
    if (!this.runtime || !(await this.runtime.probe()).available) throw new Error('WEB_RUNTIME_NOT_AVAILABLE');
    const result = await this.runtime.run(request); this.artifacts.set(session.id, result.artifacts);
    return { status: 'SUCCESS', summary: result.summary, artifacts: result.artifacts, audit: [], durationMs: result.durationMs, usageRecordIds: [] };
  }
  async cancel(session: ExecutionSession): Promise<void> { if (this.runtime) await this.runtime.cancel(session.runId); session.state = 'STOPPED'; }
  async collectArtifacts(session: ExecutionSession): Promise<ExecutionArtifact[]> { return this.artifacts.get(session.id) ?? []; }
}
