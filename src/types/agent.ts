/**
 * Agent runtime contract. Shared by the renderer (orchestration and UI) and by
 * the main process (authoritative enforcement), so everything here must stay
 * serialisable.
 */

export type AccessMode = 'FULL' | 'RESTRICTED';
/** Legacy levels remain for historical fixtures/registry metadata, not live authority. */
export type PermissionLevel = AccessMode | 'OBSERVE' | 'ASSIST' | 'CONTROL' | 'ADMIN';

export const PERMISSION_ORDER = ['OBSERVE', 'ASSIST', 'CONTROL', 'ADMIN'] as const;

/** How much damage a tool can do if it goes wrong or is misused. */
export type ToolRisk = 'SAFE' | 'SENSITIVE' | 'DESTRUCTIVE' | 'CRITICAL';

export type ToolCategory =
  | 'filesystem'
  | 'browser'
  | 'system'
  | 'process'
  | 'app'
  | 'terminal'
  | 'input'
  | 'screen'
  | 'clipboard'
  | 'git'
  | 'market'
  | 'model'
  | 'vault';

/** Known ids get autocomplete; the type stays open so adapters can register more. */
export type KnownToolId =
  | 'browser.getActiveTab'
  | 'browser.navigate'
  | 'browser.back'
  | 'browser.forward'
  | 'browser.getPageText'
  | 'filesystem.list'
  | 'filesystem.search'
  | 'filesystem.stat'
  | 'filesystem.exists'
  | 'filesystem.getDrives'
  | 'filesystem.write'
  | 'filesystem.delete'
  | 'system.getInfo'
  | 'process.list'
  | 'process.kill'
  | 'app.list'
  | 'app.launch'
  | 'terminal.run'
  | 'input.keyboard'
  | 'input.mouse'
  | 'screen.capture'
  | 'credential.show'
  | 'model.classify'
  | 'window.list' | 'window.active' | 'window.find' | 'window.focus' | 'window.minimize'
  | 'window.maximize' | 'window.restore' | 'window.move' | 'window.resize' | 'window.close'
  | 'ui.inspect' | 'ui.find' | 'ui.focus' | 'ui.invoke' | 'ui.setValue' | 'ui.toggle'
  | 'ui.select' | 'ui.expand' | 'ui.collapse' | 'ui.scroll'
  | 'screen.captureDisplay' | 'screen.captureWindow' | 'screen.captureRegion'
  | 'mouse.move' | 'mouse.click' | 'mouse.doubleClick' | 'mouse.rightClick' | 'mouse.scroll' | 'mouse.drag'
  | 'keyboard.press' | 'keyboard.hotkey' | 'keyboard.type'
  | 'process.find' | 'process.info' | 'process.terminate'
  | 'desktop.snapshot';

export type ToolId = KnownToolId | (string & {});

/**
 * Interaction ladder, cheapest and safest first.
 * Mouse and keyboard are the last resort.
 */
export type InteractionStrategy =
  | 'direct_api'
  | 'browser_dom'
  | 'ui_automation'
  | 'vision'
  | 'input_synthesis';

export interface ToolDefinition {
  id: ToolId;
  name: string;
  description: string;
  category: ToolCategory;
  /** Minimum global level. Never trusted alone — the broker re-checks. */
  requiredPermission: PermissionLevel;
  risk: ToolRisk;
  requiresApproval: boolean;
  strategy: InteractionStrategy;
  /**
   * A defined-but-disabled tool is visible in Settings and refused by the
   * broker. This is how CRITICAL capabilities stay declared and inert.
   */
  enabled: boolean;
  /** Set when a tool is declared for a later stage and has no adapter yet. */
  implemented: boolean;
  /**
   * Routine actions skip the approval prompt under FULL CONTROL. Never true for
   * DESTRUCTIVE or CRITICAL tools — those always ask.
   */
  routine?: boolean;
  /** Changes the desktop. Refused with no visible run, while locked, or after STOP. */
  interactive?: boolean;
  /**
   * How arguments reach the audit log. `shape` records only lengths and keys,
   * for tools whose arguments are user content (typed text, field values).
   */
  auditArgs?: 'summary' | 'shape';
}

/* ------------------------------------------------------------------ */
/* Runs, tasks, steps                                                  */
/* ------------------------------------------------------------------ */

export type AgentStatus =
  | 'idle'
  | 'planning'
  | 'running'
  | 'waiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Visual state of the orb. Derived from the run, not stored by it. */
export type AgentState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'searching'
  | 'executing'
  | 'controlling'
  | 'approval'
  | 'error';

export type AgentStepStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export type AgentStepKind = 'classify' | 'tool' | 'inspect' | 'respond' | 'delegate';

export interface AgentStep {
  id: string;
  runId: string;
  index: number;
  kind: AgentStepKind;
  /** Short human label: "Buscando \"Vigilia\"". */
  title: string;
  toolId?: ToolId;
  args?: unknown;
  status: AgentStepStatus;
  startedAt?: number;
  endedAt?: number;
  /** Redacted summary of what came back — never the raw payload. */
  summary?: string;
  error?: string;
  /** For delegate steps: which executor expands it at run time. */
  delegate?: string;
  /** For sub-steps a delegate created. */
  parentId?: string;
  /** For delegate steps: the executor's own verdict (e.g. verified, no_checks, failed). */
  outcome?: string;
}

export interface AgentRun {
  intelligence?: {providerId:string;modelId:string|null;messageId:string;mainRecorded:boolean};
  id: string;
  prompt: string;
  workspaceId: string;
  status: AgentStatus;
  permission: PermissionLevel;
  createdAt: number;
  endedAt?: number;
  steps: AgentStep[];
  /** Tools approved for the whole run via "Permitir durante esta tarea". */
  grantedTools: ToolId[];
  answer?: string;
  error?: string;
}

export interface AgentTaskRef {
  runId: string;
  stepId: string;
}

/* ------------------------------------------------------------------ */
/* Tool calls                                                          */
/* ------------------------------------------------------------------ */

export interface ToolExecutionRequest {
  runId: string;
  toolId: ToolId;
  args: unknown;
  /** Set by the runtime so results can be attached to the right step. */
  stepId?: string;
}

export interface ToolCall extends ToolExecutionRequest {
  id: string;
  startedAt: number;
  permission: PermissionLevel;
  risk: ToolRisk;
}

export type ToolFailureReason =
  | 'permission_denied'
  | 'tool_disabled'
  | 'tool_unknown'
  | 'not_implemented'
  | 'approval_denied'
  | 'cancelled'
  | 'invalid_args'
  | 'adapter_error'
  | 'policy_blocked';

export interface ToolResult<T = unknown> {
  callId: string;
  toolId: ToolId;
  ok: boolean;
  data?: T;
  error?: string;
  reason?: ToolFailureReason;
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

export type ApprovalVerdict = 'allow_once' | 'allow_for_run' | 'deny' | 'cancel_run';

export interface ApprovalRequest {
  id: string;
  runId: string;
  toolId: ToolId;
  /** What the action will act on: a path, a url, a process name. */
  target?: string;
  risk: ToolRisk;
  requiredPermission: PermissionLevel;
  /** Why the agent wants it, in the user's words where possible. */
  reason: string;
  argsSummary: string;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export type AgentEventStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'awaiting_approval';

export type AgentEventType =
  | 'run_started'
  | 'run_finished'
  | 'step'
  | 'tool_call'
  | 'model_call'
  | 'approval'
  | 'note'
  | 'error';

export interface AgentEvent {
  id: string;
  runId?: string;
  stepId?: string;
  timestamp: number;
  type: AgentEventType;
  tool: ToolId;
  status: AgentEventStatus;
  description: string;
  metadata?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

export type AuditActor = 'user' | 'agent' | 'system';

export interface AuditEntry {
  id: string;
  /** Optional external bridge correlation. Never contains tool arguments. */
  stepId?: string;
  timestamp: number;
  runId: string;
  actor: AuditActor;
  tool: ToolId;
  action: string;
  /** Always redacted. Never the raw arguments. */
  argsSummary: string;
  permission: PermissionLevel;
  risk: ToolRisk;
  approval: 'not_required' | 'granted_once' | 'granted_for_run' | 'denied' | 'cancelled';
  result: 'ok' | 'error' | 'blocked' | 'cancelled';
  error?: string;
  durationMs: number;
}
