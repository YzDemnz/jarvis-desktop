import { ExecutionBackendBase } from '../ExecutionBackendBase';
import type { ExecutionArtifact, ExecutionAudit, ExecutionCapability, ExecutionProbe, ExecutionRequest, ExecutionResult, ExecutionSession, ExecutionUsage } from '../types';

export interface ProviderNativePort {
  providerId: string;
  probe(): Promise<{ available: boolean; evidence: string[] }>;
  run(session: ExecutionSession, request: ExecutionRequest): Promise<ExecutionResult>;
  cancel(session: ExecutionSession): Promise<void>;
  usage(session: ExecutionSession): Promise<ExecutionUsage>;
}
const CAP: ExecutionCapability = {
  filesystemIsolation: 'PROVIDER_DEFINED', processIsolation: 'PROVIDER_DEFINED', networkIsolation: 'PROVIDER_DEFINED',
  credentialIsolation: 'PROVIDER_DEFINED', uiIsolation: 'PROVIDER_DEFINED', shell: true, git: true,
  packageManager: true, browser: false, artifacts: true, persistence: false, resume: true,
  pause: false, startupCostMs: null, trust: 'PROVIDER_MANAGED',
};

/** Provider runtime and its own native tools are never labelled ToolBroker-mediated. */
export class ProviderNativeBackend extends ExecutionBackendBase {
  readonly realm = 'PROVIDER_NATIVE' as const;
  private artifacts = new Map<string, ExecutionArtifact[]>();
  private audits = new Map<string, ExecutionAudit[]>();
  constructor(readonly id: string, private readonly port: ProviderNativePort | null = null) { super(); }
  capabilities(): ExecutionCapability { return CAP; }
  async probe(): Promise<ExecutionProbe> { const p = await this.port?.probe(); return { backendId: this.id, realm: this.realm,
    status: p?.available ? 'AVAILABLE' : 'NOT_AVAILABLE', evidence: p?.evidence ?? ['No provider runner configured'], at: Date.now(), capabilities: CAP }; }
  async execute(session: ExecutionSession, request: ExecutionRequest): Promise<ExecutionResult> {
    if (!this.port || !(await this.port.probe()).available) throw new Error('PROVIDER_NATIVE_NOT_AVAILABLE');
    const result = await this.port.run(session, request); this.artifacts.set(session.id, result.artifacts); this.audits.set(session.id, result.audit); return result;
  }
  async *stream(session: ExecutionSession): AsyncIterable<ExecutionAudit> { for (const a of this.audits.get(session.id) ?? []) yield a; }
  async cancel(session: ExecutionSession): Promise<void> { await this.port?.cancel(session); session.state = 'STOPPED'; }
  async collectArtifacts(session: ExecutionSession): Promise<ExecutionArtifact[]> { return this.artifacts.get(session.id) ?? []; }
  async getUsage(session: ExecutionSession): Promise<ExecutionUsage> { return this.port?.usage(session) ?? { source: 'UNKNOWN', tokensIn: null, tokensOut: null, cost: null }; }
}
