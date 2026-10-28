import type {
  ToolId,
  AgentEvent,
  AgentRun,
  AgentState,
  AgentStatus,
  AgentStep,
  PermissionLevel,
  RoutingDecision,
  ToolResult,
} from '@/types';
import { ToolBroker, shapeOf } from './ToolBroker';
import type { RunContext } from './ToolBroker';
import { CancellationToken } from './cancellation';
import { planRun } from './planner';
import { summarizeArgs } from './redaction';
import { uid } from '@/lib/id';

export interface RuntimeDeps {
  prepareRun?: (runId: string, originalText: string) => Promise<PermissionLevel>;
  broker: ToolBroker;
  /** Classification only. The router never receives permission to act. */
  route: (prompt: string, signal: AbortSignal) => Promise<RoutingDecision>;
  /** Produces the final answer from the steps that actually ran. */
  compose: (run: AgentRun, results: Map<string, ToolResult>) => string | Promise<string>;
  /** Hooks so desktop control can pause and resume in lockstep. */
  onPause?: (runId: string) => void;
  onResume?: (runId: string) => void;
  onStart?: (runId: string) => void;
  /** STOP: reach work that lives outside this process (commands in main). */
  onCancel?: (runId: string) => void;
  /** Executors for delegate steps, by name. */
  delegates?: Record<string, DelegateExecutor>;
  /** Called once the plan is fixed, before any step runs. */
  onPlan?: (runId: string, steps: AgentStep[]) => void;
  onFinish?: (runId: string) => void;
}

export interface RuntimeSnapshot {
  run: AgentRun | null;
  events: AgentEvent[];
  status: AgentStatus;
  state: AgentState;
  routing: RoutingDecision | null;
}

type Listener = (snapshot: RuntimeSnapshot) => void;

const STATE_BY_STATUS: Record<AgentStatus, AgentState> = {
  idle: 'idle',
  planning: 'thinking',
  running: 'thinking',
  waiting_approval: 'approval',
  paused: 'idle',
  completed: 'idle',
  failed: 'error',
  cancelled: 'idle',
};

const STATE_BY_CATEGORY: Record<string, AgentState> = {
  filesystem: 'searching',
  browser: 'searching',
  app: 'controlling',
  process: 'controlling',
  system: 'thinking',
  model: 'thinking',
  terminal: 'executing',
  input: 'controlling',
  screen: 'controlling',
};

/**
 * Owns one run at a time. No React, no DOM, no Electron: it takes a broker and
 * two functions, and emits snapshots. That is what makes it testable under
 * plain Node and reusable from either process.
 */
export class AgentRuntime {
  private run: AgentRun | null = null;
  private events: AgentEvent[] = [];
  private routing: RoutingDecision | null = null;
  private token: CancellationToken | null = null;
  private state: AgentState = 'idle';
  private listeners = new Set<Listener>();
  private results = new Map<string, ToolResult>();

  constructor(private readonly deps: RuntimeDeps) {}

  /* -------------------------------------------------------------- */
  /* Observation                                                     */
  /* -------------------------------------------------------------- */

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }

  snapshot(): RuntimeSnapshot {
    return {
      run: this.run ? { ...this.run, steps: this.run.steps.map((s) => ({ ...s })) } : null,
      events: [...this.events],
      status: this.run?.status ?? 'idle',
      state: this.state,
      routing: this.routing,
    };
  }

  get currentRun(): AgentRun | null {
    return this.run;
  }

  get isRunning(): boolean {
    const status = this.run?.status;
    return status === 'planning' || status === 'running' || status === 'waiting_approval' || status === 'paused';
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((l) => l(snapshot));
  }

  private pushEvent(event: Omit<AgentEvent, 'id' | 'timestamp'>): void {
    this.events.push({ id: uid('evt'), timestamp: Date.now(), ...event });
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
  }

  /**
   * A paused run stays paused: no intermediate transition (the next step
   * announcing it needs approval, a step settling) may take it out of pause.
   * Only resume() — which writes the status directly — or a terminal state can.
   */
  private setStatus(status: AgentStatus): void {
    if (!this.run) return;
    const terminal = status === 'completed' || status === 'failed' || status === 'cancelled';
    if (this.run.status === 'paused' && !terminal) return;
    this.run.status = status;
    this.state = STATE_BY_STATUS[status];
  }

  clear(): void {
    if (this.isRunning) this.stop('Limpiado por el usuario');
    this.run = null;
    this.events = [];
    this.routing = null;
    this.results.clear();
    this.state = 'idle';
    this.emit();
  }

  /* -------------------------------------------------------------- */
  /* Execution                                                       */
  /* -------------------------------------------------------------- */

  async start(prompt: string, options: { workspaceId: string; permission: PermissionLevel }): Promise<AgentRun> {
    if (this.isRunning) this.stop('Reemplazado por una nueva petición');

    const runId = uid('run');
    const token = new CancellationToken();
    this.token = token;
    this.results.clear();

    const run: AgentRun = {
      id: runId,
      prompt,
      workspaceId: options.workspaceId,
      status: 'planning',
      permission: options.permission,
      createdAt: Date.now(),
      steps: [],
      grantedTools: [],
    };
    this.run = run;
    this.state = 'thinking';

    const context = this.deps.broker.openRun(runId, options.permission, token, prompt);
    this.deps.onStart?.(runId);
    this.pushEvent({ runId, type: 'run_started', tool: 'model.classify', status: 'running', description: 'Ejecución iniciada' });
    this.emit();

    try {
      if (this.deps.prepareRun) {
        const effective = await this.deps.prepareRun(runId, prompt);
        run.permission = effective; this.deps.broker.setPermission(runId, effective);
      }
      // --- classify -------------------------------------------------
      token.throwIfCancelled();
      const routing = await this.deps.route(prompt, token.signal);
      token.throwIfCancelled();
      this.routing = routing;

      run.steps = planRun({ runId, prompt, routing });
      this.deps.onPlan?.(runId, run.steps);
      const classifyStep = run.steps[0];
      if (classifyStep) {
        classifyStep.status = 'completed';
        classifyStep.startedAt = run.createdAt;
        classifyStep.endedAt = Date.now();
        classifyStep.summary = `${routing.taskType} · dificultad ${routing.difficulty}/10`;
      }
      this.pushEvent({
        runId, type: 'model_call', tool: 'model.classify', status: 'completed',
        description: `Router clasificó la tarea como ${routing.taskType}`,
        metadata: { routedBy: routing.routedBy, difficulty: routing.difficulty },
      });

      this.setStatus('running');
      this.emit();

      // --- steps ----------------------------------------------------
      // Delegate steps may insert sub-steps right after themselves; those are
      // already settled when the loop reaches them, so they are skipped.
      for (const step of run.steps) {
        if (step.status !== 'queued') continue;
        token.throwIfCancelled();

        if (step.kind === 'delegate') {
          const outcome = await this.runDelegateStep(step, context, token);
          if (outcome === 'cancelled') { this.finishCancelled(); return run; }
          continue;
        }

        if (!step.toolId) {
          await this.runLocalStep(step);
          continue;
        }

        const outcome = await this.runToolStep(step, context, token);
        if (outcome === 'cancelled') { this.finishCancelled(); return run; }
      }

      token.throwIfCancelled();

      run.answer = await this.deps.compose(run, this.results);
      token.throwIfCancelled();
      run.endedAt = Date.now();
      this.setStatus('completed');
      this.state = 'idle';
      this.pushEvent({ runId, type: 'run_finished', tool: 'model.classify', status: 'completed', description: 'Ejecución completada' });
    } catch (error) {
      if (token.cancelled) {
        this.finishCancelled();
        return run;
      }
      run.error = error instanceof Error ? error.message : String(error);
      run.endedAt = Date.now();
      this.setStatus('failed');
      this.pushEvent({ runId, type: 'error', tool: 'model.classify', status: 'failed', description: run.error });
    } finally {
      run.grantedTools = [...context.grantedTools];
      this.deps.broker.closeRun(runId);
      this.deps.onFinish?.(runId);
      this.emit();
    }

    return run;
  }

  /** Steps with no tool: pure bookkeeping, still visible in Activity. */
  private async runLocalStep(step: AgentStep): Promise<void> {
    step.status = 'running';
    step.startedAt = Date.now();
    this.emit();
    await Promise.resolve();
    if (this.token?.cancelled) return;
    step.status = 'completed';
    step.endedAt = Date.now();
    this.pushEvent({
      runId: step.runId, stepId: step.id, type: 'step', tool: 'model.classify',
      status: 'completed', description: step.title,
    });
    this.emit();
  }

  /* -------------------------------------------------------------- */
  /* Step execution                                                  */
  /* -------------------------------------------------------------- */

  /**
   * One tool step through the broker: events, approval notice, argument
   * binding, execution, settlement. Shared by planned steps and by the
   * sub-steps a delegate creates, so both get identical guarantees.
   */
  private async runToolStep(step: AgentStep, context: RunContext, token: CancellationToken): Promise<ToolResult | 'cancelled'> {
    const run = this.run!;
    const runId = run.id;
    const toolId = step.toolId!;
    const definition = this.deps.broker.registry.get(toolId);
    this.state = STATE_BY_CATEGORY[definition?.category ?? ''] ?? 'thinking';

    step.status = 'running';
    step.startedAt = Date.now();
    this.pushEvent({
      runId, stepId: step.id, type: 'tool_call', tool: toolId, status: 'running',
      description: step.title,
      metadata: {
        // Typed text and field values show as their shape, never the words.
        args: summarizeArgs(definition?.auditArgs === 'shape' ? shapeOf(step.args) : step.args),
        target: targetOf(step.args),
      },
    });
    this.emit();

    const needsApproval = definition ? this.deps.broker.permissions.needsApproval(definition, run.permission) : false;
    if (needsApproval && !context.grantedTools.has(toolId)) {
      this.setStatus('waiting_approval'); // no-op while paused
      step.status = 'awaiting_approval';
      this.pushEvent({
        runId, stepId: step.id, type: 'approval', tool: toolId,
        status: 'awaiting_approval', description: `Esperando aprobación para ${toolId}`,
      });
      this.emit();
    }

    // Placeholders like { $from: 3, path: '0.windowId' } are filled from the
    // results of earlier steps. Pure data lookup — nothing is evaluated.
    let args: unknown;
    try {
      args = bindArgs(step.args, run.steps, this.results);
    } catch (error) {
      step.status = 'failed';
      step.error = error instanceof Error ? error.message : String(error);
      step.endedAt = Date.now();
      this.pushEvent({ runId, stepId: step.id, type: 'error', tool: toolId, status: 'failed', description: step.error });
      this.emit();
      return { callId: '', toolId, ok: false, error: step.error, reason: 'invalid_args', durationMs: 0 } as ToolResult;
    }
    const result = await this.deps.broker.execute({ runId, toolId, args, stepId: step.id });
    this.results.set(step.id, result);

    if (this.deps.broker.isRunCancelled(runId) || token.cancelled) return 'cancelled';

    step.endedAt = Date.now();
    if (result.ok) {
      step.status = 'completed';
      step.summary = describeResult(result);
      if (run.status !== 'paused') this.setStatus('running');
      this.pushEvent({
        runId, stepId: step.id, type: 'tool_call', tool: toolId,
        status: 'completed', description: step.title, metadata: { summary: step.summary },
      });
    } else if (result.reason === 'cancelled') {
      return 'cancelled';
    } else {
      step.status = 'failed';
      step.error = result.error ?? 'Error desconocido';
      if (run.status !== 'paused') this.setStatus('running');
      this.pushEvent({
        runId, stepId: step.id, type: 'error', tool: toolId,
        status: 'failed', description: step.error,
      });
    }
    this.emit();
    return result;
  }

  /**
   * A delegate is a planned step whose work is decided while it runs — the
   * coding loop (change, verify, repair) is the first one. It never touches a
   * service directly: every action it takes becomes a visible sub-step that
   * goes through runToolStep, i.e. the broker, permissions, approval, pause,
   * STOP and audit.
   */
  private async runDelegateStep(step: AgentStep, context: RunContext, token: CancellationToken): Promise<'ok' | 'cancelled'> {
    const run = this.run!;
    const delegate = step.delegate ? this.deps.delegates?.[step.delegate] : undefined;
    step.status = 'running';
    step.startedAt = Date.now();
    this.emit();
    if (!delegate) {
      step.status = 'failed';
      step.error = `No hay un ejecutor registrado para «${step.delegate ?? '?'}».`;
      step.endedAt = Date.now();
      this.emit();
      return 'ok';
    }

    let inserted = 0;
    const callTool = async (toolId: ToolId, args: unknown, title: string): Promise<ToolResult> => {
      token.throwIfCancelled();
      const sub: AgentStep = {
        id: uid('step'), runId: run.id, index: step.index + (++inserted) / 1000,
        kind: 'tool', title, toolId, args, status: 'queued', parentId: step.id,
      };
      run.steps.splice(run.steps.indexOf(step) + inserted, 0, sub);
      const result = await this.runToolStep(sub, context, token);
      if (result === 'cancelled') throw new DelegateCancelled();
      return result;
    };
    const note = (text: string) => {
      this.pushEvent({ runId: run.id, stepId: step.id, type: 'note', tool: 'model.classify', status: 'running', description: text });
      this.emit();
    };

    try {
      const outcome = await delegate({ runId: run.id, prompt: run.prompt, args: step.args, token, callTool, note });
      step.status = outcome.ok ? 'completed' : 'failed';
      step.summary = outcome.summary;
      const verdict = (outcome.data as { status?: unknown } | undefined)?.status;
      if (typeof verdict === 'string') step.outcome = verdict;
      if (!outcome.ok) step.error = outcome.summary;
      this.results.set(step.id, { callId: '', toolId: 'model.classify', ok: outcome.ok, data: outcome.data, durationMs: 0 } as ToolResult);
    } catch (error) {
      if (error instanceof DelegateCancelled || token.cancelled) return 'cancelled';
      step.status = 'failed';
      step.error = error instanceof Error ? error.message : String(error);
    }
    step.endedAt = Date.now();
    this.emit();
    return 'ok';
  }

  /* -------------------------------------------------------------- */
  /* Pause / resume                                                  */
  /* -------------------------------------------------------------- */

  /**
   * PAUSE keeps the run and stops new actions. The step already executing is
   * allowed to settle; the next one waits in the broker until resume().
   */
  pause(reason = 'Pausado por el usuario'): boolean {
    const run = this.run;
    if (!run || (run.status !== 'running' && run.status !== 'waiting_approval')) return false;
    this.deps.broker.pauseRun(run.id);
    this.deps.onPause?.(run.id);
    run.status = 'paused';
    this.state = 'idle';
    this.pushEvent({ runId: run.id, type: 'note', tool: 'model.classify', status: 'queued', description: reason });
    this.emit();
    return true;
  }

  /** Only an explicit call resumes. Nothing in the runtime does it on its own. */
  resume(): boolean {
    const run = this.run;
    if (!run || run.status !== 'paused') return false;
    run.status = 'running';
    this.state = 'thinking';
    this.deps.onResume?.(run.id);
    this.deps.broker.resumeRun(run.id);
    this.pushEvent({ runId: run.id, type: 'note', tool: 'model.classify', status: 'running', description: 'Reanudado por el usuario' });
    this.emit();
    return true;
  }

  get isPaused(): boolean {
    return this.run?.status === 'paused';
  }

  /* -------------------------------------------------------------- */
  /* Cancellation                                                    */
  /* -------------------------------------------------------------- */

  /** STOP AGENT. Real cancellation, not a UI state change. */
  stop(reason = 'Detenido por el usuario'): boolean {
    if (!this.run || !this.isRunning) return false;
    const runId = this.run.id;
    this.deps.broker.cancelRun(runId, reason);
    this.token?.cancel(reason);
    this.deps.onCancel?.(runId);
    this.finishCancelled(reason);
    return true;
  }

  private finishCancelled(reason = 'Detenido por el usuario'): void {
    const run = this.run;
    if (!run || run.status === 'cancelled') return;
    run.steps.forEach((step) => {
      if (step.status === 'queued' || step.status === 'running' || step.status === 'awaiting_approval') {
        step.status = 'cancelled';
        step.endedAt = Date.now();
      }
    });
    run.endedAt = Date.now();
    this.setStatus('cancelled');
    this.state = 'idle';
    this.pushEvent({ runId: run.id, type: 'run_finished', tool: 'model.classify', status: 'cancelled', description: reason });
    this.deps.broker.closeRun(run.id);
    this.emit();
  }
}

/** The one argument worth showing next to a tool name in the activity log. */
function targetOf(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const r = args as Record<string, unknown>;
  for (const key of ['appId', 'target', 'name', 'appName', 'query', 'processName', 'url']) {
    if (typeof r[key] === 'string' && r[key]) return String(r[key]).slice(0, 48);
  }
  return null;
}

/**
 * Resolves `{ $from: stepIndex, path: 'a.0.b' }` against the data of an
 * earlier, successful step. A missing value is an error, never undefined
 * silently passed to a tool.
 */
export function bindArgs(args: unknown, steps: AgentStep[], results: Map<string, ToolResult>): unknown {
  if (Array.isArray(args)) return args.map((a) => bindArgs(a, steps, results));
  if (!args || typeof args !== 'object') return args;
  const record = args as Record<string, unknown>;
  if (typeof record.$from === 'number') {
    const source = steps.find((s) => s.index === record.$from);
    const result = source ? results.get(source.id) : undefined;
    if (!result?.ok) throw new Error(`El paso ${record.$from} no produjo el dato necesario.`);
    let value: unknown = result.data;
    for (const segment of String(record.path ?? '').split('.').filter(Boolean)) {
      if (value === null || typeof value !== 'object') { value = undefined; break; }
      value = (value as Record<string, unknown>)[segment];
    }
    if (value === undefined) throw new Error(`No se encontró «${String(record.path)}» en el resultado del paso ${record.$from}.`);
    return value;
  }
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, bindArgs(v, steps, results)]));
}

class DelegateCancelled extends Error {}

export interface DelegateContext {
  runId: string;
  prompt: string;
  args: unknown;
  token: CancellationToken;
  /** Runs one tool as a visible sub-step, through the broker. */
  callTool: (toolId: ToolId, args: unknown, title: string) => Promise<ToolResult>;
  /** Adds a line to the activity stream without a tool call. */
  note: (text: string) => void;
}

export type DelegateExecutor = (ctx: DelegateContext) => Promise<{ ok: boolean; summary: string; data?: unknown }>;

function describeResult(result: ToolResult): string {
  const data = result.data;
  if (Array.isArray(data)) return `${data.length} resultado${data.length === 1 ? '' : 's'}`;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.items)) return `${record.items.length} resultados`;
    if (typeof record.title === 'string') return record.title;
    if (typeof record.url === 'string') return record.url;
  }
  if (typeof data === 'string') return data.length > 80 ? `${data.slice(0, 79)}…` : data;
  return 'ok';
}
