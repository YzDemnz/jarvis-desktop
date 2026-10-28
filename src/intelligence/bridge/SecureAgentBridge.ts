import type { ToolRisk } from '../../types';
import { ToolBroker } from '../../agent/ToolBroker';
import { DevService } from '../../dev/DevService';
import { isSecretFile } from '../../dev/classify';
import { sanitizeText } from '../../machine/CredentialBoundary';
import { basename, relative } from 'node:path';
import { isWithin } from '../../dev/paths';
import { randomUUID } from 'node:crypto';

export type BridgeMode = 'READ_ONLY' | 'PROPOSAL' | 'CONTROLLED';
export interface AgentToolRequest {
  requestId: string; provider: string; agent: string; session: string;
  tool: string; operation: string; arguments: unknown; cwd: string;
  projectRoot: string; risk: ToolRisk; reason: string; timestamp: number;
}
export interface AgentToolResult {
  status: 'OK' | 'DENIED' | 'ERROR' | 'CANCELLED'; output: string;
  structuredData: unknown; error: string | null; auditId: string;
  duration: number; truncated: boolean; redacted: boolean;
}
export interface BridgeAuditEntry {
  correlationId: string; requestId: string; runId: string; provider: string;
  tool: string; mappedTool: string | null; risk: ToolRisk;
  decision: string; brokerAuditId: string | null; result: AgentToolResult['status'];
  timestamp: number;
}

const MAPPINGS: Record<string, { id: string; mode: BridgeMode; risk: ToolRisk }> = {
  'filesystem.read': { id: 'file.read', mode: 'READ_ONLY', risk: 'SAFE' },
  'filesystem.list': { id: 'filesystem.list', mode: 'READ_ONLY', risk: 'SAFE' },
  'code.search': { id: 'code.search', mode: 'READ_ONLY', risk: 'SAFE' },
  'git.status': { id: 'git.status', mode: 'READ_ONLY', risk: 'SAFE' },
  'git.diff': { id: 'git.diff', mode: 'READ_ONLY', risk: 'SAFE' },
  'git.log': { id: 'git.log', mode: 'READ_ONLY', risk: 'SAFE' },
  'git.show': { id: 'git.show', mode: 'READ_ONLY', risk: 'SAFE' },
  'file.proposePatch': { id: 'file.proposePatch', mode: 'PROPOSAL', risk: 'SAFE' },
  'file.patch': { id: 'file.patch', mode: 'CONTROLLED', risk: 'SENSITIVE' },
  'terminal.runTests': { id: 'terminal.execute', mode: 'CONTROLLED', risk: 'SENSITIVE' },
  'terminal.nodeVersion': { id: 'terminal.execute', mode: 'READ_ONLY', risk: 'SENSITIVE' },
};
const MODE_RANK = { READ_ONLY: 0, PROPOSAL: 1, CONTROLLED: 2 } as const;
const MAX_OUTPUT = 16_384;
const safeString = (value: unknown) => typeof value === 'string' ? value : '';
const redactBridgeText = (value: string): string => sanitizeText(value)
  .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
  .replace(/\b((?:api[_-]?key|token|secret|password|passwd|cookie|authorization|credential|otp)\b\s*[:=]\s*["']?)([^\s"'`,;]+)/gi, '$1[REDACTED]');
const clean = (value: unknown): unknown => {
  if (typeof value === 'string') return redactBridgeText(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, clean(item)]));
  return value;
};

/** Explicit external-tool gate. Only JARVIS's authoritative broker can execute. */
export class SecureAgentBridge {
  readonly experimentalProvider = true;
  readonly audit: BridgeAuditEntry[] = [];
  private stopped = false;
  constructor(readonly broker: ToolBroker, readonly dev: DevService, readonly runId: string,
    readonly projectRoot: string, readonly mode: BridgeMode = 'READ_ONLY') {
    if (!broker.authoritative) throw new Error('SECURITY_GATE: authoritative ToolBroker required');
  }

  stop(): void { this.stopped = true; this.broker.cancelRun(this.runId); }
  pause(): boolean { return this.broker.pauseRun(this.runId); }
  resume(): boolean { return this.broker.resumeRun(this.runId); }

  async request(input: AgentToolRequest): Promise<AgentToolResult> {
    const start = Date.now(); const correlationId = randomUUID();
    const mapping = Object.hasOwn(MAPPINGS, input?.tool) ? MAPPINGS[input.tool] : undefined;
    let decision = 'DENIED'; let brokerAuditId: string | null = null;
    const finish = (status: AgentToolResult['status'], error: string | null, value: unknown = null): AgentToolResult => {
      const cleaned = clean(value);
      const serialized = cleaned === null ? '' : typeof cleaned === 'string' ? cleaned : JSON.stringify(cleaned);
      const output = serialized.slice(0, MAX_OUTPUT);
      const result: AgentToolResult = { status, output, structuredData: serialized.length > MAX_OUTPUT ? null : cleaned,
        error: error ? redactBridgeText(error).slice(0, 500) : null, auditId: correlationId,
        duration: Date.now() - start, truncated: serialized.length > MAX_OUTPUT, redacted: serialized !== (value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value)) };
      this.audit.push({ correlationId, requestId: redactBridgeText(safeString(input?.requestId)).slice(0, 100), runId: this.runId,
        provider: redactBridgeText(safeString(input?.provider)).slice(0, 100), tool: redactBridgeText(safeString(input?.tool)).slice(0, 100),
        mappedTool: mapping?.id ?? null, risk: mapping?.risk ?? 'CRITICAL', decision, brokerAuditId, result: status, timestamp: start });
      return result;
    };
    try {
      if (this.stopped || this.broker.isRunCancelled(this.runId)) return finish('CANCELLED', 'STOP');
      if (!mapping) return finish('DENIED', 'UNMAPPED_EXTERNAL_TOOL');
      if (MODE_RANK[this.mode] < MODE_RANK[mapping.mode]) return finish('DENIED', 'MODE_RESTRICTED');
      if (!input || !input.requestId || typeof input.arguments !== 'object' || input.arguments === null || Array.isArray(input.arguments)) return finish('DENIED', 'MALFORMED_ARGUMENTS');
      const root = await this.dev.guard.canonical(this.projectRoot);
      if (await this.dev.guard.canonical(input.projectRoot) !== root) return finish('DENIED', 'PROJECT_ROOT_MISMATCH');
      const cwd = await this.dev.guard.check(input.cwd, { write: false, base: root });
      if (cwd.path !== root) return finish('DENIED', 'CWD_RESTRICTED');
      const args = input.arguments as Record<string, unknown>;
      let brokerArgs: Record<string, unknown> = {};
      if (mapping.id.startsWith('file.')) {
        if (Object.keys(args).some(k => !['path', 'ops'].includes(k))) return finish('DENIED', 'MALFORMED_ARGUMENTS');
        const file = safeString(args.path);
        if (!file || file.split(/[\\/]/).includes('..')) return finish('DENIED', 'PATH_DENIED');
        const guarded = await this.dev.guard.check(file, { write: mapping.id === 'file.patch', base: root });
        if (!isWithin(root, guarded.path, this.dev.guard.flavor) || guarded.secret || isSecretFile(basename(guarded.path))) return finish('DENIED', 'CREDENTIAL_BOUNDARY');
        brokerArgs = { path: guarded.path };
        if (mapping.id === 'file.patch' || mapping.id === 'file.proposePatch') {
          if (!Array.isArray(args.ops) || args.ops.length < 1 || args.ops.length > 20) return finish('DENIED', 'MALFORMED_PATCH');
          brokerArgs.ops = args.ops;
        }
      } else if (mapping.id === 'terminal.execute') {
        if (input.tool === 'terminal.nodeVersion') {
          if (Object.keys(args).length) return finish('DENIED', 'MALFORMED_ARGUMENTS');
          brokerArgs = { executable: 'node', args: ['--version'], cwd: root };
        } else {
          if (Object.keys(args).some(k => !['executable', 'args'].includes(k))) return finish('DENIED', 'MALFORMED_ARGUMENTS');
          if (args.executable !== 'npm' || !Array.isArray(args.args) || args.args.length !== 1 || args.args[0] !== 'test') return finish('DENIED', 'COMMAND_NOT_ALLOWLISTED');
          brokerArgs = { executable: 'npm', args: ['test'], cwd: root };
        }
      } else if (mapping.id.startsWith('git.')) {
        if (Object.keys(args).some(k => !['path', 'ref', 'limit'].includes(k))) return finish('DENIED', 'MALFORMED_GIT');
        brokerArgs = {};
        if (['git.diff', 'git.show'].includes(mapping.id) && typeof args.path !== 'string') return finish('DENIED', 'PATH_REQUIRED_FOR_GIT_CONTENT');
        if (typeof args.path === 'string') {
          const checked = await this.dev.guard.check(args.path, { write: false, base: root });
          if (!isWithin(root, checked.path, this.dev.guard.flavor) || checked.secret) return finish('DENIED', 'CREDENTIAL_BOUNDARY');
          brokerArgs.path = relative(root, checked.path);
        }
        if (mapping.id === 'git.show') {
          if (!/^[0-9a-f]{7,64}$/i.test(safeString(args.ref))) return finish('DENIED', 'REF_NOT_ALLOWLISTED');
          brokerArgs.ref = args.ref;
        }
      } else if (mapping.id === 'code.search') {
        if (typeof args.query !== 'string' || args.query.length > 200) return finish('DENIED', 'MALFORMED_QUERY');
        brokerArgs = { query: args.query };
      } else if (mapping.id === 'filesystem.list') {
        const checked = await this.dev.guard.check(safeString(args.path) || '.', { write: false, base: root });
        if (!isWithin(root, checked.path, this.dev.guard.flavor) || checked.secret) return finish('DENIED', 'CREDENTIAL_BOUNDARY');
        brokerArgs = { path: checked.path };
      }
      decision = 'BROKER_REQUESTED';
      const brokerResult = await this.broker.execute({ runId: this.runId, toolId: mapping.id, args: brokerArgs, stepId: correlationId });
      brokerAuditId = this.broker.audit.list(this.runId).find(e => e.stepId === correlationId && e.tool === mapping.id && e.action === 'execute')?.id ?? null;
      return finish(brokerResult.ok ? 'OK' : brokerResult.reason === 'cancelled' ? 'CANCELLED' : 'DENIED', brokerResult.error ?? null, brokerResult.ok ? brokerResult.data : null);
    } catch (error) { return finish('DENIED', error instanceof Error ? error.message : 'BRIDGE_ERROR'); }
  }
}
