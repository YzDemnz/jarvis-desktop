import type { ToolDefinition, ToolRisk, PermissionLevel } from '../../types';
import { PermissionEngine } from '../../agent/permissions';
import type { ToolBroker } from '../../agent/ToolBroker';
import { LeaseManager } from '../lab/LeaseManager';
export interface MCPToolDescriptor { name: string; description: string; risk: ToolRisk; brokerTool: string | null; }
export class MCPServerRegistry {
  private servers = new Map<string, MCPToolDescriptor[]>();
  register(id: string, descriptors: MCPToolDescriptor[]): void {
    if (this.servers.has(id)) throw new Error('Duplicate MCP server');
    this.servers.set(id, descriptors.map(d => ({ ...d })));
  }
  tools(id: string): MCPToolDescriptor[] { return this.servers.get(id)?.map(d => ({ ...d })) ?? []; }
}
export class MCPToolPolicy {
  private permissions = new PermissionEngine();
  check(tool: MCPToolDescriptor, permission: PermissionLevel): boolean {
    // Phase A exports harmless fake tools only. Upstream descriptions are not trusted policy.
    if (tool.risk !== 'SAFE' || !tool.brokerTool || !['dev.tools', 'terminal.output', 'file.read'].includes(tool.brokerTool)) return false;
    const definition: ToolDefinition = { id: tool.name, name: tool.name, description: tool.description,
      risk: tool.risk, requiredPermission: 'OBSERVE', enabled: true, implemented: true, requiresApproval: false, category: 'filesystem', strategy: 'direct_api' };
    return this.permissions.check(definition, permission).allowed;
  }
}
export class MCPConnectionManager {
  readonly leases: LeaseManager;
  connected = false;
  constructor(private readonly connect: () => Promise<void>, private readonly disconnect: () => Promise<void>) {
    this.leases = new LeaseManager(async () => { if (!this.connected) { await this.connect(); this.connected = true; } }, async () => { if (this.connected) { await this.disconnect(); this.connected = false; } });
  }
}
export class MCPFabric {
  readonly experimentalProvider = true;
  readonly policy = new MCPToolPolicy();
  constructor(readonly registry: MCPServerRegistry, readonly broker: ToolBroker) { if (!broker.authoritative) throw new Error('Authoritative broker required'); }
  async call(server: string, name: string, args: unknown, runId: string, permission: PermissionLevel) {
    const tool = this.registry.tools(server).find(t => t.name === name);
    if (!tool || !this.policy.check(tool, permission)) throw new Error('MCP tool export denied');
    return this.broker.execute({ runId, toolId: tool.brokerTool!, args });
  }
}
