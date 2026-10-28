import type { ExecutionBackend, ExecutionPolicy, ExecutionProbe, ExecutionRequest, ExecutionResult, ExecutionSession } from './types';
import { ExecutionRouter, type ExecutionRoute } from './ExecutionRouter';
import { ExecutionLedger, type ExecutionRunRecord } from './ExecutionLedger';
import { validateExecutionArtifact } from './ExecutionArtifactContract';

export interface FabricDispatch { route: ExecutionRoute; session: ExecutionSession | null; result: ExecutionResult | null }

/** This PoC is not connected to CapabilityRouter or production dispatch. */
export class ExecutionFabric {
  private backends = new Map<string, ExecutionBackend>();
  private sessions = new Map<string, { backend: ExecutionBackend; session: ExecutionSession }>();
  constructor(readonly router: ExecutionRouter, readonly ledger: ExecutionLedger) {}
  register(backend: ExecutionBackend): void {
    if (this.backends.has(backend.id)) throw new Error(`EXECUTION_BACKEND_DUPLICATE:${backend.id}`);
    this.backends.set(backend.id, backend);
  }
  async probes(): Promise<ExecutionProbe[]> { return Promise.all([...this.backends.values()].map(b => b.probe())); }
  async dispatch(request: ExecutionRequest, policy: ExecutionPolicy): Promise<FabricDispatch> {
    if (this.ledger.events(request.runId).length) throw new Error('EXECUTION_RUN_ALREADY_EXISTS');
    const route = this.router.route(request, policy, await this.probes());
    this.ledger.route(request.runId, route);
    // A security fallback is a separately reviewed proposal decision, never an automatic execution downgrade.
    if (route.fallback) return { route, session: null, result: null };
    if (!route.selected || (route.status !== 'SELECTED' && route.status !== 'PROPOSAL_ONLY')) return { route, session: null, result: null };
    const backend = this.backends.get(route.selected)!;
    const session = await backend.createSession(request); this.sessions.set(request.runId, { backend, session });
    const record: ExecutionRunRecord = { runId: request.runId, conversationId: request.conversationId, sessionId: session.id,
      backendId: backend.id, realm: backend.realm, providerId: request.providerId, agentId: request.agentId,
      trust: backend.capabilities().trust, network: policy.network[backend.realm] ?? 'OFF', startedAt: Date.now(), endedAt: null,
      status: 'RUNNING', artifactIds: [], usageRecordIds: [], commandLabels: [], securityClassification: backend.capabilities().trust, durationMs: null };
    this.ledger.start(record);
    try {
      session.state = 'RUNNING'; const result = await backend.execute(session, request);
      session.state = result.status === 'CANCELLED' ? 'STOPPED' : result.status === 'FAIL' ? 'FAILED' : 'COMPLETED';
      for (const audit of result.audit) this.ledger.audit(audit);
      for (const artifact of result.artifacts) { validateExecutionArtifact(artifact, request.runId); this.ledger.artifact(artifact); }
      this.ledger.finish({ ...record, endedAt: Date.now(), status: result.status, artifactIds: result.artifacts.map(a => a.id),
        usageRecordIds: [...result.usageRecordIds], commandLabels: result.audit.filter(a => a.event === 'COMMAND').map(a => a.detail ?? ''),
        durationMs: result.durationMs });
      return { route, session, result };
    } catch (error) {
      session.state = 'FAILED'; this.ledger.finish({ ...record, endedAt: Date.now(), status: 'FAIL', durationMs: Date.now() - record.startedAt });
      throw error;
    }
  }
  async cancel(runId: string): Promise<boolean> { const found = this.sessions.get(runId); if (!found) return false; await found.backend.cancel(found.session); return true; }
  async pause(runId: string): Promise<boolean> { const found = this.sessions.get(runId); return found ? found.backend.pause(found.session) : false; }
  async resume(runId: string): Promise<boolean> { const found = this.sessions.get(runId); return found ? found.backend.resume(found.session) : false; }
}
