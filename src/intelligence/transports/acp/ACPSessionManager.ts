import type { NewSessionResponse } from '@agentclientprotocol/sdk';
import type { ACPTransport } from './ACPTransport';
export class ACPSessionManager {
  readonly sessions = new Map<string, string>();
  authState: 'UNKNOWN' | 'AUTH_REQUIRED' | 'SESSION_AVAILABLE' = 'UNKNOWN';
  constructor(readonly transport: ACPTransport) {}
  async create(conversationId: string): Promise<NewSessionResponse> {
    try {
      const r = await this.transport.deadline(this.transport.connection!.newSession({ cwd: this.transport.process.cwd, mcpServers: [] }));
      this.sessions.set(conversationId, r.sessionId); this.authState = 'SESSION_AVAILABLE'; return r;
    } catch (e) { if ((e as { code?: number }).code === -32000 || /auth|login/i.test(String(e))) this.authState = 'AUTH_REQUIRED'; throw e; }
  }
  async resume(conversationId: string, sessionId: string): Promise<void> {
    if (!this.transport.initialized?.agentCapabilities?.loadSession) throw new Error('Resume unsupported');
    await this.transport.deadline(this.transport.connection!.loadSession({ sessionId, cwd: this.transport.process.cwd, mcpServers: [] }));
    this.sessions.set(conversationId, sessionId);
  }
}
