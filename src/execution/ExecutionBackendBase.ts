import { randomUUID } from 'node:crypto';
import type { ExecutionArtifact, ExecutionAudit, ExecutionBackend, ExecutionCapability, ExecutionHealth, ExecutionProbe, ExecutionRealm, ExecutionRequest, ExecutionResult, ExecutionSession, ExecutionUsage } from './types';

export abstract class ExecutionBackendBase implements ExecutionBackend {
  abstract readonly id: string;
  abstract readonly realm: ExecutionRealm;
  abstract probe(): Promise<ExecutionProbe>;
  abstract capabilities(): ExecutionCapability;
  async createSession(request: ExecutionRequest): Promise<ExecutionSession> {
    return { id: randomUUID(), runId: request.runId, conversationId: request.conversationId,
      backendId: this.id, realm: this.realm, createdAt: Date.now(), state: 'CREATED' };
  }
  abstract execute(session: ExecutionSession, request: ExecutionRequest): Promise<ExecutionResult>;
  async *stream(_session: ExecutionSession): AsyncIterable<ExecutionAudit> { /* no events for contract-only backends */ }
  async cancel(session: ExecutionSession): Promise<void> { session.state = 'STOPPED'; }
  async pause(_session: ExecutionSession): Promise<boolean> { return false; }
  async resume(_session: ExecutionSession): Promise<boolean> { return false; }
  async collectArtifacts(_session: ExecutionSession): Promise<ExecutionArtifact[]> { return []; }
  async collectDiff(_session: ExecutionSession): Promise<ExecutionArtifact | null> { return null; }
  async getUsage(_session: ExecutionSession): Promise<ExecutionUsage> { return { source: 'UNKNOWN', tokensIn: null, tokensOut: null, cost: null }; }
  async getHealth(): Promise<ExecutionHealth> { const p = await this.probe(); return { healthy: p.status === 'AVAILABLE', detail: p.status, at: Date.now() }; }
  async shutdown(session: ExecutionSession): Promise<void> { session.state = 'STOPPED'; }
  async destroy(session: ExecutionSession): Promise<void> { session.state = 'STOPPED'; }
}
