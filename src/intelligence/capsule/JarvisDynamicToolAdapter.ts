import { randomUUID } from 'node:crypto';
import type { SecureAgentBridge, AgentToolResult, AgentToolRequest } from '../bridge/SecureAgentBridge';

export type JarvisDynamicTool = 'jarvis_read_real_resource' | 'jarvis_browser_research' | 'jarvis_request_real_change';
export const JARVIS_DYNAMIC_TOOLS: JarvisDynamicTool[] = ['jarvis_read_real_resource', 'jarvis_browser_research', 'jarvis_request_real_change'];

/** Experimental App Server client-side tool contract; never a native Codex built-in override. */
export class JarvisDynamicToolAdapter {
  constructor(private readonly bridge: SecureAgentBridge) {}
  definitions() {
    return JARVIS_DYNAMIC_TOOLS.filter(name => name === 'jarvis_read_real_resource').map(name => ({ name, description: `${name} via JARVIS policy gate`,
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false } }));
  }
  async call(name: string, args: unknown): Promise<AgentToolResult> {
    if (name !== 'jarvis_read_real_resource' || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('DYNAMIC_TOOL_DENIED');
    const input: AgentToolRequest = { requestId: randomUUID(), provider: 'codex-app-server', agent: 'dynamic-tool', session: 'capsule',
      tool: 'filesystem.read', operation: 'read', arguments: args, cwd: this.bridge.projectRoot, projectRoot: this.bridge.projectRoot,
      risk: 'SAFE', reason: 'explicit JARVIS real resource read', timestamp: Date.now() };
    return this.bridge.request(input);
  }
}
