import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import type { OpenCodeProcessManager } from './OpenCodeProcessManager';
/** Only SDK endpoints; no imports of upstream core. No production registration. */
export class OpenCodeBridge {
  readonly experimentalProvider = true;
  readonly client;
  private safetyValidated = false;
  constructor(readonly server: OpenCodeProcessManager) {
    this.client = createOpencodeClient({ baseUrl: server.baseUrl, directory: server.cwd,
      headers: { Authorization: server.authorization },
      fetch: async (input, init) => {
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        return fetch(input, { ...init, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
      },
    });
  }
  async health() { return this.client.v2.health.get({ throwOnError: true }); }
  async leaseTask(): Promise<() => void> {
    const release = await this.server.leases.acquire();
    try { await this.server.ready(); return release; } catch (error) { release(); throw error; }
  }
  async createSession() { return this.client.session.create({ directory: this.server.cwd, title: 'JARVIS proposal lab', permission: [{ permission: '*', pattern: '*', action: 'deny' }] }, { throwOnError: true }); }
  async metadata() {
    return { agents: await this.client.app.agents({ directory: this.server.cwd }, { throwOnError: true }),
      providers: await this.client.provider.list({ directory: this.server.cwd }, { throwOnError: true }),
      project: await this.client.project.current({ directory: this.server.cwd }, { throwOnError: true }) };
  }
  async events(signal: AbortSignal) { return this.client.event.subscribe({ directory: this.server.cwd }, { signal }); }
  async cancel(sessionID: string) { return this.client.session.abort({ sessionID, directory: this.server.cwd }, { throwOnError: true }); }
  async context(sessionID: string) { return this.client.session.messages({ sessionID, directory: this.server.cwd }, { throwOnError: true }); }
  /** Required independent security validation, not a model-controlled flag. */
  async validateProposalConfiguration(): Promise<void> {
    const config = await this.client.config.get({ directory: this.server.cwd }, { throwOnError: true });
    const agent = config.data?.agent?.['jarvis-proposal'];
    const permission = config.data?.permission as Record<string, unknown> | undefined;
    if (!agent || agent.tools?.['*'] !== false || permission?.['*'] !== 'deny') throw new Error('SECURITY_GATE: proposal configuration not enforced');
    this.safetyValidated = true;
  }
  async propose(sessionID: string, text: string, model: { providerID: string; modelID: string }) {
    if (!this.safetyValidated) throw new Error('SECURITY_GATE: proposal configuration not validated');
    try {
      return await this.client.session.prompt({ sessionID, directory: this.server.cwd, agent: 'jarvis-proposal', model,
        parts: [{ type: 'text', text: `PROPOSAL ONLY. No tools. Return JSON {diagnosis,edits:[{path,oldText,newText}],commands,context}.\n${text}` }],
      }, { throwOnError: true });
    } catch (error) {
      try { await this.cancel(sessionID); } catch { await this.server.stop(); this.safetyValidated = false; }
      throw error;
    }
  }
}
