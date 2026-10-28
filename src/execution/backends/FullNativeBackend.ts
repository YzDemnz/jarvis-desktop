import { ExecutionBackendBase } from '../ExecutionBackendBase';
import type { ExecutionCapability, ExecutionProbe, ExecutionRequest, ExecutionResult, ExecutionSession } from '../types';

const CAP: ExecutionCapability = {
  filesystemIsolation: 'NONE', processIsolation: 'NONE', networkIsolation: 'NONE', credentialIsolation: 'NONE', uiIsolation: 'NONE',
  shell: true, git: true, packageManager: true, browser: true, artifacts: true, persistence: true,
  resume: false, pause: false, startupCostMs: null, trust: 'FULL_TRUST',
};
export class FullNativeBackend extends ExecutionBackendBase {
  readonly id = 'full-native'; readonly realm = 'FULL_NATIVE' as const;
  constructor(private readonly port?: { invoke: (tool: string, args: unknown, runId: string) => Promise<unknown>; cancel: (runId: string) => Promise<void> }) { super(); }
  capabilities(): ExecutionCapability { return CAP; }
  async probe(): Promise<ExecutionProbe> { return { backendId: this.id, realm: this.realm, status: this.port ? 'AVAILABLE' : 'NOT_AVAILABLE',
    evidence: [this.port ? 'Main-owned native service adapter; no isolation claim' : 'Host native port absent'], at: Date.now(), capabilities: CAP }; }
  async execute(session: ExecutionSession, request: ExecutionRequest): Promise<ExecutionResult> {
    if (!this.port) throw new Error('FULL_NATIVE_HOST_PORT_UNAVAILABLE');
    const start = Date.now(); const results: unknown[] = [];
    for (const call of request.brokeredCalls ?? []) results.push(await this.port.invoke(call.toolId, call.args, request.runId));
    const cancelled = session.state === 'STOPPED' || results.some(r => r && typeof r === 'object' && 'cancelled' in r && r.cancelled === true);
    const failed = results.some(r => r && typeof r === 'object' && 'exitCode' in r && r.exitCode !== 0);
    const status = cancelled ? 'CANCELLED' : failed ? 'FAIL' : 'SUCCESS';
    session.state = cancelled ? 'STOPPED' : failed ? 'FAILED' : 'COMPLETED';
    return { status, summary: 'Native host operations settled; tool results are not independent verification.',
      artifacts: [], audit: [{ id: `${session.id}:native`, runId: request.runId, sessionId: session.id, at: Date.now(), event: 'NATIVE_OPERATIONS_SETTLED', backendId: this.id, realm: this.realm, brokerAuditId: null, detail: `${results.length} operations` }], durationMs: Date.now() - start, usageRecordIds: [], toolResults: results };
  }
  async cancel(session: ExecutionSession): Promise<void> { session.state = 'STOPPED'; await this.port?.cancel(session.runId); }
}
