import type { ControlMode, ControlStatus, InputLimits, SessionState } from '@/types';
import { CancellationToken } from '@/agent/cancellation';
import { DEFAULT_INPUT_LIMITS, SlidingWindowLimiter } from './RateLimiter';

export type GateDecision = { ok: true } | { ok: false; reason: string; code: 'no_run' | 'stopped' | 'paused' | 'session' | 'rate_limit' | 'human_override' };

/**
 * The one place that answers "may JARVIS touch the desktop right now?".
 *
 * Every desktop tool asks here first. STOP, PAUSE, a locked session, a human
 * grabbing the mouse and the rate limits all converge on this object, so no
 * path can forget one of them.
 *
 * There is no autonomy without a visible run: with no bound run, every
 * interactive action is refused.
 */
export class ControlGate {
  private mode: ControlMode = 'idle';
  private runId: string | null = null;
  private currentAction: string | null = null;
  private session: SessionState = 'UNKNOWN';
  private humanOverride = false;
  private helperAvailable = false;
  private token = new CancellationToken();
  private resumeWaiters: (() => void)[] = [];
  private listeners = new Set<(s: ControlStatus) => void>();
  private limits: InputLimits = { ...DEFAULT_INPUT_LIMITS };
  readonly mouseLimiter: SlidingWindowLimiter;
  readonly keyLimiter: SlidingWindowLimiter;

  constructor(now: () => number = () => Date.now()) {
    this.mouseLimiter = new SlidingWindowLimiter(this.limits.mouseActionsPerSecond, 1000, now);
    this.keyLimiter = new SlidingWindowLimiter(this.limits.keyEventsPerSecond, 1000, now);
  }

  /* ---------------- run binding ---------------- */

  bindRun(runId: string): CancellationToken {
    if (this.runId === runId && this.mode === 'active') return this.token;
    this.token.cancel('Reemplazado por otro run');
    this.runId = runId;
    this.mode = 'active';
    this.humanOverride = false;
    this.token = new CancellationToken();
    this.mouseLimiter.reset();
    this.keyLimiter.reset();
    this.emit();
    return this.token;
  }

  releaseRun(runId: string): void {
    if (this.runId !== runId) return;
    this.runId = null;
    this.currentAction = null;
    if (this.mode !== 'stopped') this.mode = 'idle';
    this.flushResumeWaiters();
    this.emit();
  }

  /* ---------------- STOP / PAUSE / RESUME ---------------- */

  /**
   * Cancels everything in flight and refuses everything after. Mouse moves,
   * drags and typing check this token between steps, so they halt mid-motion.
   */
  stop(reason = 'Detenido por el usuario'): void {
    this.token.cancel(reason);
    this.mode = 'stopped';
    this.currentAction = null;
    this.flushResumeWaiters();
    this.emit();
  }

  pause(reason: 'user' | 'human_override' = 'user'): void {
    if (this.mode !== 'active') return;
    this.mode = 'paused';
    if (reason === 'human_override') this.humanOverride = true;
    this.emit();
  }

  /** Only ever an explicit user action. Nothing resumes by itself. */
  resume(): void {
    if (this.mode !== 'paused') return;
    this.mode = 'active';
    this.humanOverride = false;
    this.flushResumeWaiters();
    this.emit();
  }

  /** Blocks until resumed, or rejects if the run is stopped meanwhile. */
  async waitIfPaused(): Promise<void> {
    while (this.mode === 'paused') {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
    }
  }

  private flushResumeWaiters(): void {
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    waiters.forEach((w) => w());
  }

  /* ---------------- checks ---------------- */

  /**
   * `interactive` covers anything that changes the desktop. Pure observation
   * (listing windows, reading a tree) is allowed without a bound run, but never
   * while the session is locked or on the secure desktop for UIA writes.
   */
  check(opts: { interactive: boolean; runId?: string }): GateDecision {
    if (!opts.interactive) return { ok: true };
    if (!this.runId || (opts.runId && opts.runId !== this.runId)) {
      return { ok: false, code: 'no_run', reason: 'No hay ninguna ejecución visible autorizando el control del escritorio.' };
    }
    if (this.mode === 'stopped' || this.token.cancelled) {
      return { ok: false, code: 'stopped', reason: 'El control fue detenido.' };
    }
    if (this.mode === 'paused') {
      return { ok: false, code: this.humanOverride ? 'human_override' : 'paused', reason: this.humanOverride ? 'Pausado porque tomaste el control.' : 'El control está en pausa.' };
    }
    if (this.session !== 'ACTIVE') {
      return {
        ok: false, code: 'session',
        reason: this.session === 'LOCKED' ? 'Windows está bloqueado.'
          : this.session === 'SECURE_DESKTOP' ? 'Windows requiere tu aprobación.'
          : 'No se pudo confirmar que la sesión de Windows esté activa.',
      };
    }
    return { ok: true };
  }

  takeMouse(cost = 1): GateDecision {
    return this.mouseLimiter.tryTake(cost)
      ? { ok: true }
      : { ok: false, code: 'rate_limit', reason: `Límite de ${this.limits.mouseActionsPerSecond} acciones de ratón por segundo.` };
  }

  takeKeys(cost = 1): GateDecision {
    return this.keyLimiter.tryTake(cost)
      ? { ok: true }
      : { ok: false, code: 'rate_limit', reason: `Límite de ${this.limits.keyEventsPerSecond} pulsaciones por segundo.` };
  }

  /* ---------------- state ---------------- */

  get signal(): AbortSignal { return this.token.signal; }
  get cancellation(): CancellationToken { return this.token; }
  get inputLimits(): InputLimits { return { ...this.limits }; }

  setLimits(limits: Partial<InputLimits>): void {
    this.limits = { ...this.limits, ...limits };
    this.mouseLimiter.setLimit(this.limits.mouseActionsPerSecond);
    this.keyLimiter.setLimit(this.limits.keyEventsPerSecond);
  }

  setSession(session: SessionState): void {
    if (session === this.session) return;
    this.session = session;
    if (session !== 'ACTIVE' && this.mode === 'active') this.mode = 'blocked';
    else if (session === 'ACTIVE' && this.mode === 'blocked') this.mode = 'active';
    this.emit();
  }

  setHelperAvailable(available: boolean): void {
    this.helperAvailable = available;
    this.emit();
  }

  setAction(action: string | null): void {
    this.currentAction = action;
    this.emit();
  }

  status(): ControlStatus {
    return {
      mode: this.mode,
      runId: this.runId,
      currentAction: this.currentAction,
      blockedReason: this.mode === 'blocked' || this.session !== 'ACTIVE'
        ? (this.session === 'LOCKED' ? 'Windows está bloqueado.'
          : this.session === 'SECURE_DESKTOP' ? 'Windows requiere tu aprobación.'
          : this.session === 'UNKNOWN' ? 'Estado de sesión desconocido.' : null)
        : null,
      humanOverride: this.humanOverride,
      session: this.session,
      helperAvailable: this.helperAvailable,
    };
  }

  subscribe(listener: (s: ControlStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status());
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void {
    const s = this.status();
    this.listeners.forEach((l) => l(s));
  }
}
