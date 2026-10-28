import { ExecutionBackendBase } from '../ExecutionBackendBase';
import type { ExecutionCapability, ExecutionProbe, ExecutionRequest, ExecutionResult, ExecutionSession, ExecutionStatus } from '../types';

export interface StrongBackendDetector { detect(): Promise<{ status: ExecutionStatus; evidence: string[] }> }
const CAP: ExecutionCapability = {
  filesystemIsolation: 'VM', processIsolation: 'VM', networkIsolation: 'VM', credentialIsolation: 'VM', uiIsolation: 'VM',
  shell: true, git: true, packageManager: true, browser: false, artifacts: true, persistence: false,
  resume: false, pause: false, startupCostMs: null, trust: 'LIMITED_ISOLATION',
};

/** Detection is not attestation. No executable strong backend is supplied in EF-1. */
export class StrongLocalBackend extends ExecutionBackendBase {
  readonly id = 'strong-local-detector'; readonly realm = 'STRONG_ISOLATED' as const;
  constructor(private readonly detector: StrongBackendDetector) { super(); }
  capabilities(): ExecutionCapability { return CAP; }
  async probe(): Promise<ExecutionProbe> { const detected = await this.detector.detect(); return {
    backendId: this.id, realm: this.realm, status: detected.status === 'AVAILABLE' ? 'UNVERIFIED' : detected.status,
    evidence: detected.evidence, at: Date.now(), capabilities: CAP,
  }; }
  async execute(_session: ExecutionSession, _request: ExecutionRequest): Promise<ExecutionResult> { throw new Error('STRONG_BACKEND_NOT_ATTESTED'); }
}
