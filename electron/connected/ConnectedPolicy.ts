import fs from 'node:fs';
import path from 'node:path';
export type DataClass = 'GENERIC' | 'CLIENT_DATA' | 'LOCAL_ONLY';
export interface ConnectedPolicy { version: 1; dataClass: DataClass; allowPaidApi: boolean; allowPaidFallback: boolean; enabled: string[]; clientDestinations: string[];economyModel?:string;mcpModel?:string;documentModel?:string }
export class ConnectedPolicyStore {
  private policy: ConnectedPolicy = { version: 1, dataClass: 'GENERIC', allowPaidApi: false, allowPaidFallback: false, enabled: ['ollama-local'], clientDestinations: [] };
  revision = 0;
  constructor(private readonly file: string, private readonly changed: () => void) {
    try { if (fs.existsSync(file)) {
      const p = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (p.version !== 1 || !['GENERIC', 'CLIENT_DATA', 'LOCAL_ONLY'].includes(p.dataClass) || typeof p.allowPaidApi !== 'boolean'
        || !Array.isArray(p.enabled) || !Array.isArray(p.clientDestinations)) throw Error('INVALID_CONNECTED_POLICY');
      this.policy = { version: 1, dataClass: p.dataClass, allowPaidApi: p.allowPaidApi, allowPaidFallback: p.allowPaidFallback === true, enabled: p.enabled.filter((id: unknown) => ['ollama-local', 'openai-api', 'codex-app-server', 'llama-cpp-local', 'bootstrap-local', 'claude-api', 'gemini-api', 'grok-api', 'groq-api', 'openrouter-api'].includes(String(id))), clientDestinations: p.clientDestinations.filter((s: unknown) => typeof s === 'string').slice(0, 64) };
      if(typeof p.economyModel==='string'&&/^[a-zA-Z0-9._:/-]{1,200}$/.test(p.economyModel))this.policy.economyModel=p.economyModel;
      if(typeof p.mcpModel==='string'&&/^[a-zA-Z0-9._:/-]{1,200}$/.test(p.mcpModel))this.policy.mcpModel=p.mcpModel;
      if(typeof p.documentModel==='string'&&/^[a-zA-Z0-9._:/-]{1,200}$/.test(p.documentModel))this.policy.documentModel=p.documentModel;
    } } catch { /* Corrupt policy fails to safe defaults; never grants remote/cost permission. */ }
  }
  snapshot(): ConnectedPolicy { return structuredClone(this.policy); }
  /** Called by native menu choices, never a renderer setter. */
  userChange(update: Partial<Omit<ConnectedPolicy, 'version'>>) {
    this.policy = { ...this.policy, ...update }; this.revision++; this.changed();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.policy)); fs.renameSync(this.file + '.tmp', this.file);
  }
}
