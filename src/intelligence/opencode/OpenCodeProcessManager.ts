import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ACPProcessManager } from '../transports/acp/ACPProcessManager';
import type { ACPAgentProfile } from '../transports/acp/ACPAgentProfile';
/** Lazy external service, clean profile, loopback and per-process password. */
export class OpenCodeProcessManager extends ACPProcessManager {
  readonly baseUrl: string;
  readonly authorization: string;
  constructor(command: string, cwd: string, port: number, version: string, localModel?: string, localEndpoint = 'http://127.0.0.1:11434') {
    const password = randomBytes(32).toString('hex');
    const home = join(cwd, '..', `.lab-profile-${port}`); mkdirSync(home, { recursive: true });
    const profile: ACPAgentProfile = {
      id: 'opencode-lab', name: 'OpenCode lab', command, args: ['serve', '--hostname', '127.0.0.1', '--port', String(port)], version,
      capabilities: ['proposal'], authenticationMode: 'OFFICIAL_MANAGED', supportsResume: true, supportsCancel: true,
      supportsUsage: true, supportsTools: false, supportsMCP: false, workingDirectoryPolicy: 'TEMP_ONLY', environmentPolicy: 'ALLOWLIST', promptSafety: 'UNVERIFIED',
      environment: {
        HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'), XDG_STATE_HOME: join(home, 'state'),
        OPENCODE_SERVER_PASSWORD: password, OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
        OPENCODE_DISABLE_LSP_DOWNLOAD: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1', OPENCODE_DISABLE_PROJECT_CONFIG: '1',
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { '*': 'deny' }, plugin: [], mcp: {}, lsp: false, formatter: false,
          ...(localModel ? { enabled_providers: ['ollama-lab'], provider: { 'ollama-lab': { npm: '@ai-sdk/openai-compatible', name: 'Local Ollama lab',
            options: { baseURL: `${localEndpoint}/v1` }, models: { [localModel]: { name: localModel, limit: { context: 8192, output: 2048 } } } } } } : {}),
          agent: { 'jarvis-proposal': { mode: 'primary', description: 'Text proposals only; JARVIS executes validated changes', tools: { '*': false }, permission: { '*': 'deny' } } } }),
      },
    };
    super(profile, cwd); this.baseUrl = `http://127.0.0.1:${port}`;
    this.authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
  }
  async ready(timeoutMs = 30000): Promise<void> {
    await this.start(); const start = Date.now();
    while (Date.now() - start < timeoutMs && super.health()) {
      try { const r = await fetch(`${this.baseUrl}/v2/health`, { headers: { authorization: this.authorization }, signal: AbortSignal.timeout(1000) }); if (r.ok) return; } catch { /* retry bounded */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await this.stop(); throw new Error('OpenCode health timeout');
  }
}
