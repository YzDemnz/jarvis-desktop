import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type { ToolBroker } from '../../../agent/ToolBroker';
import type { SecureAgentBridge, AgentToolRequest } from '../../bridge/SecureAgentBridge';
import { randomUUID } from 'node:crypto';

/** Permission to execute internally is NOT permission to let JARVIS execute.
 * Always cancel external operations; explicit client filesystem calls use broker.
 * No guessing a executable/action from human-readable upstream tool titles.
 */
export class ACPPermissionBridge {
  readonly denied: string[] = [];
  constructor(readonly broker: ToolBroker, readonly runId: string, readonly secure?: SecureAgentBridge) {
    if (!broker.authoritative) throw new Error('Authoritative ToolBroker required');
  }
  async requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    this.denied.push(request.toolCall.toolCallId);
    await this.broker.execute({ runId: this.runId, toolId: 'acp.external.unmediated', args: { externalToolId: request.toolCall.toolCallId } });
    return { outcome: { outcome: 'cancelled' } };
  }
  async read(path: string): Promise<string> {
    if (this.secure) {
      const r = await this.secure.request(this.normalized('filesystem.read', { path }));
      if (r.status !== 'OK') throw new Error(r.error ?? 'Permission denied');
      const value = r.structuredData as { content?: unknown } | null;
      return typeof value?.content === 'string' ? value.content : '';
    }
    const r = await this.broker.execute<{ content: string }>({ runId: this.runId, toolId: 'file.read', args: { path } });
    if (!r.ok) throw new Error(r.error ?? 'Permission denied'); return r.data?.content ?? '';
  }
  async write(path: string, content: string): Promise<void> {
    if (this.secure) {
      const r = await this.secure.request(this.normalized('filesystem.write', { path, content }));
      if (r.status !== 'OK') throw new Error(r.error ?? 'Permission denied');
      return;
    }
    const r = await this.broker.execute({ runId: this.runId, toolId: 'file.write', args: { path, content } });
    if (!r.ok) throw new Error(r.error ?? 'Permission denied');
  }
  private normalized(tool: string, args: unknown): AgentToolRequest {
    const root = this.secure!.projectRoot;
    return { requestId: randomUUID(), provider: 'acp', agent: 'external', session: this.runId,
      tool, operation: tool, arguments: args, cwd: root, projectRoot: root,
      risk: tool === 'filesystem.read' ? 'SAFE' : 'SENSITIVE', reason: 'ACP client filesystem request', timestamp: Date.now() };
  }
}
