import type {
  ToolRisk,
  ApprovalRequest,
  ApprovalVerdict,
  AuditEntry,
  PermissionLevel,
  ToolCall,
  ToolDefinition,
  ToolExecutionRequest,
  ToolId,
  ToolResult,
} from '@/types';
import { PermissionEngine, permissionEngine as defaultPermissions } from './permissions';
import { ToolRegistry, toolRegistry as defaultRegistry } from './registry';
import { AuditService, auditService as defaultAudit } from './AuditService';
import { ApprovalEngine, approvalEngine as defaultApprovals } from './ApprovalEngine';
import { CancellationToken, CancelledError, isCancelledError } from './cancellation';
import { summarizeArgs } from './redaction';
import type { AdapterMap, ToolAdapter, ToolContext } from './adapters/types';
import { uid } from '@/lib/id';

export interface RunContext {
  runId: string;
  permission: PermissionLevel;
  token: CancellationToken;
  /** Tools the user approved for the whole run. Mutated by the broker. */
  grantedTools: Set<ToolId>;
  /** Free-text reason shown in the approval dialog. */
  reason?: string;
  cancelled: boolean;
  paused: boolean;
  resumeWaiters: (() => void)[];
}

/**
 * A policy may veto, or escalate: force a fresh approval at a higher risk, even
 * under FULL CONTROL and even if the tool was allowed for the whole run. It can
 * never relax — there is no decision that removes an approval.
 */
export type PolicyDecision =
  | { ok: true; escalate?: { risk: ToolRisk; reason: string } }
  | { ok: false; reason: string };

/**
 * A policy is a veto the broker consults after permission and before approval.
 * Rate limits, a locked session, STOP and the secret-typing rule live here, so
 * the broker — not the adapter — is where they are enforced.
 */
export type ToolPolicy = (input: {
  tool: ToolDefinition;
  request: ToolExecutionRequest;
  context: RunContext;
}) => PolicyDecision | Promise<PolicyDecision>;

export interface BrokerOptions {
  registry?: ToolRegistry;
  permissions?: PermissionEngine;
  audit?: AuditService;
  approvals?: ApprovalEngine;
  adapters?: AdapterMap;
  policies?: ToolPolicy[];
  /**
   * An authoritative broker is the last line before a real system call and
   * re-validates everything, even if an upstream broker already did. The
   * main-process broker sets this; the renderer's does not.
   */
  authoritative?: boolean;
}

/**
 * Agent → Tool Broker → Permission Engine → Tool Adapter → System.
 *
 * Nothing skips this class. A model never holds an adapter: it produces a tool
 * id and arguments, and the broker decides whether that ever becomes a call.
 */
export class ToolBroker {
  readonly registry: ToolRegistry;
  readonly permissions: PermissionEngine;
  readonly audit: AuditService;
  readonly approvals: ApprovalEngine;
  readonly authoritative: boolean;

  private adapters = new Map<ToolId, ToolAdapter<never, unknown>>();
  private runs = new Map<string, RunContext>();
  private policies: ToolPolicy[] = [];

  constructor(options: BrokerOptions = {}) {
    this.registry = options.registry ?? defaultRegistry;
    this.permissions = options.permissions ?? defaultPermissions;
    this.audit = options.audit ?? defaultAudit;
    this.approvals = options.approvals ?? defaultApprovals;
    this.authoritative = options.authoritative ?? false;
    if (options.adapters) this.registerAll(options.adapters);
    if (options.policies) this.policies.push(...options.policies);
  }

  /* -------------------------------------------------------------- */
  /* Registration                                                    */
  /* -------------------------------------------------------------- */

  register<A, R>(id: ToolId, adapter: ToolAdapter<A, R>): void {
    // Refusing undeclared ids is what stops a tool from existing without a
    // permission level and a risk rating.
    this.registry.assertKnown(id);
    this.adapters.set(id, adapter as ToolAdapter<never, unknown>);
  }

  registerAll(map: AdapterMap): void {
    for (const [id, adapter] of Object.entries(map)) {
      if (adapter) this.register(id, adapter);
    }
  }

  hasAdapter(id: ToolId): boolean {
    return this.adapters.has(id);
  }

  addPolicy(policy: ToolPolicy): () => void {
    this.policies.push(policy);
    return () => { this.policies = this.policies.filter((p) => p !== policy); };
  }

  /* -------------------------------------------------------------- */
  /* Run bookkeeping                                                 */
  /* -------------------------------------------------------------- */

  openRun(runId: string, permission: PermissionLevel, token: CancellationToken, reason?: string): RunContext {
    const context: RunContext = {
      runId, permission, token, grantedTools: new Set(), cancelled: false,
      paused: false, resumeWaiters: [], ...(reason ? { reason } : {}),
    };
    this.runs.set(runId, context);
    token.onCancel(() => { context.cancelled = true; this.releaseWaiters(context); });
    return context;
  }

  closeRun(runId: string): void {
    const context = this.runs.get(runId);
    if (context) this.releaseWaiters(context);
    this.runs.delete(runId);
  }

  /**
   * PAUSE: calls already running finish, new calls wait. The run is kept, and
   * only an explicit resume releases it — nothing resumes on its own.
   */
  pauseRun(runId: string): boolean {
    const context = this.runs.get(runId);
    if (!context || context.cancelled) return false;
    context.paused = true;
    return true;
  }

  resumeRun(runId: string): boolean {
    const context = this.runs.get(runId);
    if (!context || !context.paused) return false;
    context.paused = false;
    this.releaseWaiters(context);
    return true;
  }

  isRunPaused(runId: string): boolean {
    return this.runs.get(runId)?.paused === true;
  }

  private releaseWaiters(context: RunContext): void {
    const waiters = context.resumeWaiters;
    context.resumeWaiters = [];
    waiters.forEach((w) => w());
  }

  private async waitWhilePaused(context: RunContext): Promise<void> {
    while (context.paused && !context.cancelled && !context.token.cancelled) {
      await new Promise<void>((resolve) => context.resumeWaiters.push(resolve));
    }
  }

  /** STOP AGENT lands here: no further calls, and open approvals settle. */
  cancelRun(runId: string, reason = 'Detenido por el usuario'): void {
    const context = this.runs.get(runId);
    if (!context) return;
    context.cancelled = true;
    this.approvals.cancelRun(runId);
    context.token.cancel(reason);
  }

  isRunCancelled(runId: string): boolean {
    const context = this.runs.get(runId);
    return context ? context.cancelled || context.token.cancelled : false;
  }

  setPermission(runId: string, permission: PermissionLevel): void {
    const context = this.runs.get(runId);
    if (context) context.permission = permission;
  }

  /* -------------------------------------------------------------- */
  /* Execution                                                       */
  /* -------------------------------------------------------------- */

  async execute<T = unknown>(request: ToolExecutionRequest): Promise<ToolResult<T>> {
    const startedAt = Date.now();
    const context = this.runs.get(request.runId);
    const tool = this.registry.get(request.toolId);
    const permission = context?.permission ?? 'OBSERVE';
    const risk = tool?.risk ?? 'CRITICAL';
    // Typed text and field values are the user's content: the log keeps only
    // their shape (lengths, keys), never the words themselves.
    const auditArgs = tool?.auditArgs === 'shape' ? shapeOf(request.args) : request.args;

    const call: ToolCall = {
      id: uid('call'),
      runId: request.runId,
      toolId: request.toolId,
      args: request.args,
      ...(request.stepId ? { stepId: request.stepId } : {}),
      startedAt,
      permission,
      risk,
    };

    const fail = (
      reason: ToolResult['reason'],
      message: string,
      result: AuditEntry['result'] = 'blocked',
      approval: AuditEntry['approval'] = 'not_required',
    ): ToolResult<T> => {
      this.audit.record({
        runId: request.runId, actor: 'agent', tool: request.toolId,
        ...(request.stepId ? { stepId: request.stepId } : {}),
        action: 'execute', args: auditArgs, permission, risk,
        approval, result, error: message, durationMs: Date.now() - startedAt,
      });
      return { callId: call.id, toolId: request.toolId, ok: false, error: message, reason, durationMs: Date.now() - startedAt };
    };

    // 1. An unknown run means nobody opened it, or it is already closed.
    if (!context) return fail('cancelled', 'No hay una ejecución abierta para esta llamada.');

    // 2. Cancellation beats everything. A cancelled run never starts a tool.
    if (context.cancelled || context.token.cancelled) {
      return fail('cancelled', 'La ejecución fue cancelada.', 'cancelled');
    }

    // 3. Unknown tool ids are refused by name, before anything else runs.
    if (!tool) return fail('tool_unknown', `Herramienta desconocida: ${String(request.toolId)}`);

    // 4. Permission and enablement.
    const verdict = this.permissions.check(tool, context.permission);
    if (!verdict.allowed) {
      return fail(
        verdict.code === 'not_implemented' ? 'not_implemented' : verdict.code === 'tool_disabled' ? 'tool_disabled' : 'permission_denied',
        verdict.reason,
      );
    }

    // 5. An adapter must exist even if the declaration says implemented.
    const adapter = this.adapters.get(request.toolId);
    if (!adapter) return fail('not_implemented', `«${tool.name}» no tiene adaptador registrado en este proceso.`);

    // 5b. PAUSE holds new calls here until resumed or cancelled.
    if (context.paused) {
      await this.waitWhilePaused(context);
      if (context.cancelled || context.token.cancelled) {
        return fail('cancelled', 'La ejecución fue cancelada durante la pausa.', 'cancelled');
      }
    }

    // 5c. Policies: session, STOP, rate limits, secret rules. Any one vetoes;
    // any one may escalate.
    let escalation: { risk: ToolRisk; reason: string } | null = null;
    for (const policy of this.policies) {
      const decision = await policy({ tool, request, context });
      if (!decision.ok) return fail('policy_blocked', decision.reason);
      const up = decision.escalate;
      if (up && (!escalation || RISK_RANK[up.risk] > RISK_RANK[escalation.risk])) escalation = up;
    }

    // 6. Human approval, when risk demands it and the run has not granted it.
    // An escalation always asks: a run-wide grant covers the tool, not this call.
    let approvalOutcome: AuditEntry['approval'] = 'not_required';
    if (escalation || (verdict.needsApproval && !context.grantedTools.has(tool.id))) {
      const decision = await this.askApproval(tool, context, request, escalation);
      if (decision === 'cancel_run') {
        this.cancelRun(request.runId, 'Cancelado desde el diálogo de aprobación');
        return fail('cancelled', 'El usuario canceló la ejecución completa.', 'cancelled', 'cancelled');
      }
      if (decision === 'deny') {
        return fail('approval_denied', 'El usuario denegó la acción.', 'blocked', 'denied');
      }
      if (decision === 'allow_for_run' && !escalation) {
        context.grantedTools.add(tool.id);
        approvalOutcome = 'granted_for_run';
      } else {
        approvalOutcome = 'granted_once';
      }
      // The dialog takes real time; the run may have been stopped meanwhile.
      if (context.cancelled || context.token.cancelled) {
        return fail('cancelled', 'La ejecución fue cancelada.', 'cancelled', approvalOutcome);
      }

      // …or paused: approving an action does not override a pause the user
      // asked for while deciding. It waits for resume like any other call.
      if (context.paused) {
        await this.waitWhilePaused(context);
        if (context.cancelled || context.token.cancelled) {
          return fail('cancelled', 'La ejecución fue cancelada durante la pausa.', 'cancelled', approvalOutcome);
        }
      }

      // …and the world may have changed (session locked, STOP on the desktop
      // gate). Policies are cheap; check them again right before acting.
      for (const policy of this.policies) {
        const recheck = await policy({ tool, request, context });
        if (!recheck.ok) return fail('policy_blocked', recheck.reason, 'blocked', approvalOutcome);
      }
    }

    // 7. Run it.
    const toolContext: ToolContext = { runId: request.runId, token: context.token, signal: context.token.signal };
    try {
      const data = (await adapter(request.args as never, toolContext)) as T;
      if (context.cancelled || context.token.cancelled) {
        return fail('cancelled', 'La ejecución fue cancelada.', 'cancelled', approvalOutcome);
      }
      this.audit.record({
        runId: request.runId, actor: 'agent', tool: tool.id, action: 'execute',
        ...(request.stepId ? { stepId: request.stepId } : {}),
        args: auditArgs, permission: context.permission, risk: tool.risk,
        approval: approvalOutcome, result: 'ok', durationMs: Date.now() - startedAt,
      });
      return { callId: call.id, toolId: tool.id, ok: true, data, durationMs: Date.now() - startedAt };
    } catch (error) {
      const cancelled = isCancelledError(error) || error instanceof CancelledError;
      const message = error instanceof Error ? error.message : String(error);
      this.audit.record({
        runId: request.runId, actor: 'agent', tool: tool.id, action: 'execute',
        ...(request.stepId ? { stepId: request.stepId } : {}),
        args: auditArgs, permission: context.permission, risk: tool.risk,
        approval: approvalOutcome, result: cancelled ? 'cancelled' : 'error',
        error: message, durationMs: Date.now() - startedAt,
      });
      return {
        callId: call.id, toolId: tool.id, ok: false,
        error: message, reason: cancelled ? 'cancelled' : 'adapter_error',
        durationMs: Date.now() - startedAt,
      };
    }
  }

  private askApproval(tool: ToolDefinition, context: RunContext, request: ToolExecutionRequest, escalation: { risk: ToolRisk; reason: string } | null = null): Promise<ApprovalVerdict> {
    const approval: ApprovalRequest = {
      id: uid('approval'),
      runId: context.runId,
      toolId: tool.id,
      risk: escalation?.risk ?? tool.risk,
      requiredPermission: tool.requiredPermission,
      reason: escalation ? `${escalation.reason} · ${context.reason ?? 'Solicitado por la tarea en curso.'}` : context.reason ?? 'Solicitado por la tarea en curso.',
      argsSummary: summarizeArgs(tool.auditArgs === 'shape' ? shapeOf(request.args) : request.args),
      createdAt: Date.now(),
      ...(targetOf(request.args) ? { target: targetOf(request.args) } : {}),
    };
    this.audit.record({
      runId: context.runId, actor: 'agent', tool: tool.id, action: 'approval_requested',
      ...(request.stepId ? { stepId: request.stepId } : {}),
      args: tool.auditArgs === 'shape' ? shapeOf(request.args) : request.args, permission: context.permission, risk: escalation?.risk ?? tool.risk,
      approval: 'not_required', result: 'blocked', durationMs: 0,
    });
    return this.approvals.request(approval);
  }
}

const RISK_RANK: Record<ToolRisk, number> = { SAFE: 0, SENSITIVE: 1, DESTRUCTIVE: 2, CRITICAL: 3 };

/** Keys and lengths only: `{ text: "<34 caracteres>" }`. */
export function shapeOf(args: unknown): unknown {
  if (typeof args === 'string') return `<${args.length} caracteres>`;
  if (!args || typeof args !== 'object') return args;
  if (Array.isArray(args)) return `<lista de ${args.length}>`;
  return Object.fromEntries(Object.entries(args as Record<string, unknown>).map(([k, v]) => [
    k,
    typeof v === 'string' ? (/^(ui|vision):\d+$/.test(v) ? v : `<${v.length} caracteres>`)
      : Array.isArray(v) ? `<lista de ${v.length}>`
      : v,
  ]));
}

/** Best-effort "what does this act on", for the approval dialog. */
function targetOf(args: unknown): string | undefined {
  if (typeof args === 'string') return args;
  if (!args || typeof args !== 'object') return undefined;
  const record = args as Record<string, unknown>;
  for (const key of ['path', 'target', 'url', 'directory', 'file', 'name', 'query']) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}
