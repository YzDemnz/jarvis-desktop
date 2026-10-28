import type { IntelligenceProvider, IntelligenceRequest, IntelligenceResponse, ProviderCapability, UsageRecord } from '../../../fabric/types';
import { ACPSessionManager } from './ACPSessionManager';
import type { ACPTransport } from './ACPTransport';
/** Never registered in production CapabilityRouter. Harness must own sessions. */
export class ACPAgentProvider implements IntelligenceProvider {
  readonly experimentalProvider = true;
  readonly sessions: ACPSessionManager;
  private active = new Map<string, string>();
  private currentTask: string | null = null;
  constructor(readonly transport: ACPTransport) { this.sessions = new ACPSessionManager(transport); }
  identity() { return { id: this.transport.process.profile.id, label: this.transport.process.profile.name, kind: 'CODING_AGENT' as const }; }
  async capabilities(): Promise<ProviderCapability[]> { return [{ id: 'coding', strength: 0, available: this.transport.process.profile.promptSafety === 'CLIENT_MEDIATED' }]; }
  async connectionState() { return this.transport.authKind === 'none' || this.sessions.authState === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' as const : this.transport.process.health() ? 'CONNECTED' as const : 'OFFLINE' as const; }
  async entitlement() { return { paid: false, details: 'UNKNOWN; never infers subscription entitlement' }; }
  async health() { return { ok: this.transport.process.health(), message: null }; }
  async usage(): Promise<UsageRecord[]> { return []; }
  async estimate() { return { amount: null, currency: null }; }
  async execute(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    if (this.transport.process.profile.promptSafety !== 'CLIENT_MEDIATED') throw new Error('SECURITY_GATE: direct tools not mediated');
    if (this.currentTask !== null) throw new Error('Provider busy; concurrent prompts disabled in Phase A');
    if (request.signal?.aborted) throw new Error('Cancelled');
    this.currentTask = request.taskId;
    let release: (() => void) | undefined;
    let session: string | undefined;
    const abort = () => { void this.cancel(request.taskId).catch(() => this.transport.close()); };
    request.signal?.addEventListener('abort', abort, { once: true });
    try {
      release = await this.transport.process.leases.acquire();
      if (request.signal?.aborted) throw new Error('Cancelled');
      if (!this.transport.connection || this.transport.connection.signal.aborted) await this.transport.connect();
      session = (await this.sessions.create(request.taskId)).sessionId;
      this.active.set(request.taskId, session);
      if (request.signal?.aborted) throw new Error('Cancelled');
      const before = this.transport.events.events.length;
      const result = await this.transport.prompt(session, [request.context, request.prompt].filter(Boolean).join('\n'));
      if (result.stopReason === 'cancelled' || request.signal?.aborted) throw new Error('Cancelled');
      return { text: this.transport.events.events.slice(before).filter(e => e.sessionId === session).map(e => e.text ?? '').join(''), model: null };
    } finally { request.signal?.removeEventListener('abort', abort); this.active.delete(request.taskId); this.currentTask = null; release?.(); }
  }
  async cancel(taskId: string): Promise<void> {
    const session = this.active.get(taskId);
    if (session) await this.transport.cancel(session);
    else if (this.currentTask === taskId) await this.transport.close();
  }
  async *stream(request: IntelligenceRequest): AsyncIterable<string> {
    const chunks: string[] = []; let done = false; let error: unknown; let wake = () => {};
    const unsubscribe = this.transport.events.subscribe(event => {
      if (event.text && this.active.get(request.taskId) === event.sessionId) { chunks.push(event.text); wake(); }
    });
    const completion = this.execute(request).then(() => { done = true; wake(); }, e => { error = e; done = true; wake(); });
    try {
      while (!done || chunks.length) {
        if (chunks.length) yield chunks.shift()!;
        else await new Promise<void>(resolve => { wake = resolve; });
      }
      if (error) throw error;
    } finally { unsubscribe(); if (!done) await this.cancel(request.taskId); await completion; }
  }
}
