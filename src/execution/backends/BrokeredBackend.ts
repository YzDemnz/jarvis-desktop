import { createHash, randomUUID } from 'node:crypto';
import type { ToolBroker } from '../../agent/ToolBroker';
import { ExecutionBackendBase } from '../ExecutionBackendBase';
import type { ExecutionArtifact, ExecutionAudit, ExecutionCapability, ExecutionProbe, ExecutionRequest, ExecutionResult, ExecutionSession } from '../types';

const CAP: ExecutionCapability = {
  filesystemIsolation: 'BROKERED', processIsolation: 'BROKERED', networkIsolation: 'BROKERED',
  credentialIsolation: 'BROKERED', uiIsolation: 'BROKERED', shell: true, git: true,
  packageManager: true, browser: true, artifacts: true, persistence: false, resume: true,
  pause: true, startupCostMs: 0, trust: 'TRUSTED_BROKERED',
};
export interface BrokeredModelPort {
  next(request: ExecutionRequest, history: Array<{ toolId: string; ok: boolean; data: unknown }>): Promise<{ toolId: string; args: Record<string, unknown> } | null>;
}

/** The model emits requests; this backend never gives it an FsPort or ProcessPort. */
export class BrokeredBackend extends ExecutionBackendBase {
  readonly id: string = 'jarvis-brokered'; readonly realm = 'BROKERED' as const;
  private artifacts = new Map<string, ExecutionArtifact[]>();
  private audits = new Map<string, ExecutionAudit[]>();
  constructor(private readonly broker: ToolBroker, private readonly model: BrokeredModelPort | null = null) {
    super(); if (!broker.authoritative) throw new Error('BROKERED_BACKEND_REQUIRES_AUTHORITATIVE_BROKER');
  }
  capabilities(): ExecutionCapability { return CAP; }
  async probe(): Promise<ExecutionProbe> { return { backendId: this.id, realm: this.realm, status: 'AVAILABLE', evidence: ['authoritative ToolBroker'], at: Date.now(), capabilities: CAP }; }
  async execute(session: ExecutionSession, request: ExecutionRequest): Promise<ExecutionResult> {
    if (!this.model && !request.brokeredCalls?.length) throw new Error('BROKERED_CALLS_REQUIRED');
    const start = Date.now(); const audit: ExecutionAudit[] = []; const artifacts: ExecutionArtifact[] = [];
    const history: Array<{ toolId: string; ok: boolean; data: unknown }> = [];
    let failed = false;
    for (let index = 0; index < 12; index++) {
      const call = this.model ? await this.model.next(request, history) : request.brokeredCalls?.[index];
      if (!call) break;
      if (session.state === 'STOPPED') break;
      const stepId = `execution:${session.id}:${index}`;
      const result = await this.broker.execute({ runId: request.runId, toolId: call.toolId, args: call.args, stepId });
      const brokerEntry = this.broker.audit.list(request.runId).find(e => e.stepId === stepId);
      const entry: ExecutionAudit = { id: randomUUID(), runId: request.runId, sessionId: session.id, at: Date.now(),
        event: call.toolId === 'terminal.execute' ? 'COMMAND' : 'TOOL_CALL', backendId: this.id, realm: this.realm,
        brokerAuditId: brokerEntry?.id ?? null, detail: call.toolId };
      if (!entry.brokerAuditId) throw new Error('BROKERED_AUDIT_CORRELATION_MISSING');
      audit.push(entry);
      history.push({ toolId: call.toolId, ok: result.ok, data: result.data ?? null });
      if (!result.ok) { failed = true; break; }
      const serialized = JSON.stringify(result.data ?? null);
      artifacts.push({ id: randomUUID(), runId: request.runId, kind: call.toolId === 'file.proposePatch' ? 'DIFF'
        : call.toolId === 'terminal.execute' ? 'TEST_REPORT' : 'TEXT', label: call.toolId, uri: null,
        contentHash: createHash('sha256').update(serialized).digest('hex'), bytes: Buffer.byteLength(serialized), createdAt: Date.now(),
        metadata: { brokerAuditId: entry.brokerAuditId, ok: true } });
    }
    this.audits.set(session.id, audit); this.artifacts.set(session.id, artifacts);
    return { status: session.state === 'STOPPED' ? 'CANCELLED' : failed ? 'PARTIAL' : 'SUCCESS',
      summary: `${audit.length} brokered tool requests; ${failed ? 'last call failed' : 'all broker-authorized'}`,
      artifacts, audit, durationMs: Date.now() - start, usageRecordIds: [] };
  }
  async *stream(session: ExecutionSession): AsyncIterable<ExecutionAudit> { for (const entry of this.audits.get(session.id) ?? []) yield entry; }
  async cancel(session: ExecutionSession): Promise<void> { this.broker.cancelRun(session.runId); session.state = 'STOPPED'; }
  async pause(session: ExecutionSession): Promise<boolean> { const ok = this.broker.pauseRun(session.runId); if (ok) session.state = 'PAUSED'; return ok; }
  async resume(session: ExecutionSession): Promise<boolean> { const ok = this.broker.resumeRun(session.runId); if (ok) session.state = 'RUNNING'; return ok; }
  async collectArtifacts(session: ExecutionSession): Promise<ExecutionArtifact[]> { return this.artifacts.get(session.id) ?? []; }
  async collectDiff(session: ExecutionSession): Promise<ExecutionArtifact | null> { return (this.artifacts.get(session.id) ?? []).find(a => a.kind === 'DIFF') ?? null; }
}
