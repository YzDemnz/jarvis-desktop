import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  AutomationElement, Bounds, DiscoveredApp, MonitorInfo, MouseButton, ProcessInfo,
  SessionState, WindowInfo, WindowShowState,
} from '../../src/types';
import type { ApplicationLaunchResult, CaptureBytes, WindowsAutomationAdapter } from '../../src/desktop/adapter';
import type { HumanInputEvent, HumanInputSource } from '../../src/desktop/HumanOverrideDetector';
import { timeoutFor, validateRequest, validateResponse } from './protocol';
import type { HelperCommand, HelperEvent, HelperResponse } from './protocol';
import { assertProcessScope } from '../process/WindowsJobProcess';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  command: HelperCommand;
}

export interface BridgeOptions {
  /** Path to the helper executable. Never derived from user or model input. */
  executable: string;
  args?: string[];
  /** Restart attempts after a crash before giving up for the session. */
  maxRestarts?: number;
  spawnFn?: typeof spawn;
  onStateChange?: (alive: boolean) => void;
  /** Overrides per-command timeouts. Tests only; production uses timeoutFor. */
  timeoutFor?: (command: HelperCommand) => number;
  /** Launches a discovered app through main's owned process supervisor. */
  launchFn?: (app: DiscoveredApp, options?: { requireOwnership: boolean }) => Promise<ApplicationLaunchResult>;
}

let requestSeq = 0;

/**
 * Talks to the native helper over stdin/stdout, one JSON object per line.
 *
 * - Every request is validated against the closed protocol before it is sent.
 * - Every request carries an id and a timeout; a hung helper cannot hang JARVIS.
 * - If the helper dies, every pending call rejects, `available()` turns false,
 *   and the app keeps running with UI Automation reported as UNAVAILABLE.
 */
export class WindowsHelperBridge implements WindowsAutomationAdapter, HumanInputSource {
  readonly id = 'windows-helper';
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private pending = new Map<string, Pending>();
  private alive = false;
  private ready = false;
  private starting: Promise<boolean> | null = null;
  private restarts = 0;
  private humanListeners = new Set<(e: HumanInputEvent) => void>();
  private readonly spawnFn: typeof spawn;

  constructor(private readonly options: BridgeOptions) {
    this.spawnFn = options.spawnFn ?? spawn;
  }

  /* ---------------- lifecycle ---------------- */

  start(): Promise<boolean> {
    if (this.alive && this.ready) return Promise.resolve(true);
    if (this.starting) return this.starting;
    const pending = this.startTransport(); this.starting = pending;
    void pending.finally(() => { if (this.starting === pending) this.starting = null; });
    return pending;
  }

  private async startTransport(): Promise<boolean> {
    this.ready = false;
    try {
      const child = this.spawnFn(this.options.executable, this.options.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      }) as ChildProcessWithoutNullStreams;
      this.child = child;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => this.onData(chunk));
      child.stderr.on('data', () => { /* diagnostics only; never parsed as protocol */ });
      child.on('exit', () => this.onExit(child));
      child.on('error', () => this.onExit(child));
      this.alive = true;
      // The first .NET self-extraction on an external disk is not an action timeout.
      const pong = await this.send('ping', {}, this.options.timeoutFor ? undefined : 30_000).then(value => value === 'pong').catch(() => false);
      if (!pong || this.child !== child || !this.alive) { if (this.child === child) this.kill(); return false; }
      this.ready = true;
      this.options.onStateChange?.(true);
      return true;
    } catch {
      this.alive = false;
      this.ready = false;
      return false;
    }
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    // A helper flooding without newlines must not grow memory unbounded.
    if (this.buffer.length > 16 * 1024 * 1024) { this.kill(); return; }
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { continue; }
      const message = validateResponse(parsed);
      if (!message) continue;
      if ('event' in message) this.onEvent(message);
      else this.onResponse(message);
    }
  }

  private onResponse(response: HelperResponse): void {
    const entry = this.pending.get(response.requestId);
    if (!entry) return; // late reply to a timed-out request: dropped
    clearTimeout(entry.timer);
    this.pending.delete(response.requestId);
    if (response.ok) entry.resolve(response.result);
    else entry.reject(new Error(response.error ?? `El helper rechazó ${entry.command}.`));
  }

  private onEvent(event: HelperEvent): void {
    if (event.event === 'humanInput') {
      const kind = event.data.kind === 'keyboard' ? 'keyboard' : 'mouse';
      const at = typeof event.data.at === 'number' ? event.data.at : Date.now();
      this.humanListeners.forEach((l) => l({ kind, at }));
    }
  }

  private onExit(child?: ChildProcessWithoutNullStreams): void {
    if (child && this.child !== child) return; // A retired child cannot clear a replacement.
    const wasAlive = this.alive;
    this.alive = false;
    this.ready = false;
    this.child = null;
    this.buffer = '';
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('El helper de automatización se detuvo.'));
      this.pending.delete(id);
    }
    if (wasAlive) this.options.onStateChange?.(false);
    if (wasAlive && this.restarts < (this.options.maxRestarts ?? 2)) {
      this.restarts += 1;
      const restart = () => {
        if (!this.alive && this.restarts <= (this.options.maxRestarts ?? 2)) void this.start();
      };
      // A startup crash must wait for that attempt to settle, not reuse its failed promise.
      if (this.starting) void this.starting.then(restart, restart); else restart();
    }
  }

  kill(): void {
    const child = this.child;
    this.restarts = Number.MAX_SAFE_INTEGER; // an explicit kill is not a crash
    this.child = null;
    try { child?.kill(); } catch { /* already gone */ }
    this.onExit();
  }

  /* ---------------- transport ---------------- */

  send<T = unknown>(command: HelperCommand, args: Record<string, unknown>, startupTimeoutMs?: number): Promise<T> {
    if (command !== 'cancelInput' && command !== 'inputState') {
      try { assertProcessScope(); } catch (error) { return Promise.reject(error); }
    }
    const requestId = `r${Date.now().toString(36)}${(requestSeq++).toString(36)}`;
    const checked = validateRequest({ requestId, command, args });
    if (!checked.ok) return Promise.reject(new Error(checked.error));
    if (!this.alive || !this.child) return Promise.reject(new Error('El helper de automatización no está en ejecución.'));

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`El helper no respondió a ${command} a tiempo.`));
      }, startupTimeoutMs ?? (this.options.timeoutFor ?? timeoutFor)(command));
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer, command });
      try {
        this.child!.stdin.write(`${JSON.stringify(checked.value)}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  pendingCount(): number { return this.pending.size; }

  /** A STOP receipt must follow worker completion, not just cancelInput's reply. */
  async quiesceInput(): Promise<void> {
    if (!this.alive) return;
    const deadline = Date.now() + 2000;
    const watchdog = setTimeout(() => this.kill(), 2000); // Includes hung control/telemetry replies.
    try {
      await this.send('cancelInput', {});
      while (true) {
        const state = await this.send<{ active: boolean }>('inputState', {});
        const pending = [...this.pending.values()].some(entry => entry.command === 'mouseDrag' || entry.command === 'typeText');
        if (!state.active && !pending) return;
        if (Date.now() >= deadline) {
          this.kill(); // Only our helper; never an application or a foreign PID.
          throw new Error('INPUT_STOP_NOT_QUIESCENT');
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } catch { throw new Error('INPUT_STOP_NOT_QUIESCENT'); }
    finally { clearTimeout(watchdog); }
  }

  /* ---------------- HumanInputSource ---------------- */

  subscribe(listener: (e: HumanInputEvent) => void): () => void {
    this.humanListeners.add(listener);
    return () => { this.humanListeners.delete(listener); };
  }
  stop(): void { /* the helper keeps its hook installed; listeners are what change */ }

  /* ---------------- WindowsAutomationAdapter ---------------- */

  async available() { return this.alive && this.ready; }
  sessionState() { return this.send<SessionState>('sessionState', {}); }
  monitors() { return this.send<MonitorInfo[]>('monitors', {}); }
  listWindows() { return this.send<WindowInfo[]>('listWindows', {}); }
  activeWindow() { return this.send<WindowInfo | null>('activeWindow', {}); }
  async activateWindow(windowId: string) { await this.send('activateWindow', { windowId }); }
  async setWindowState(windowId: string, state: Exclude<WindowShowState, 'hidden'>) { await this.send('setWindowState', { windowId, state }); }
  async moveWindow(windowId: string, x: number, y: number) { await this.send('moveWindow', { windowId, x, y }); }
  async resizeWindow(windowId: string, width: number, height: number) { await this.send('resizeWindow', { windowId, width, height }); }
  async closeWindow(windowId: string) { await this.send('closeWindow', { windowId }); }
  uiRoot(windowId: string) { return this.send<AutomationElement>('uiRoot', { windowId }); }
  uiChildren(elementId: string) { return this.send<AutomationElement[]>('uiChildren', { elementId }); }
  uiElement(elementId: string) { return this.send<AutomationElement | null>('uiElement', { elementId }); }
  async uiFocus(elementId: string) { await this.send('uiFocus', { elementId }); }
  async uiInvoke(elementId: string) { await this.send('uiInvoke', { elementId }); }
  async uiSetValue(elementId: string, value: string) { await this.send('uiSetValue', { elementId, value }); }
  async uiToggle(elementId: string) { await this.send('uiToggle', { elementId }); }
  async uiSelect(elementId: string) { await this.send('uiSelect', { elementId }); }
  async uiExpand(elementId: string) { await this.send('uiExpand', { elementId }); }
  async uiCollapse(elementId: string) { await this.send('uiCollapse', { elementId }); }
  async uiScroll(elementId: string, direction: 'up' | 'down' | 'left' | 'right', amount: number) { await this.send('uiScroll', { elementId, direction, amount }); }
  cursor() { return this.send<{ x: number; y: number }>('cursor', {}); }
  async mouseMove(x: number, y: number) { await this.send('mouseMove', { x, y }); }
  async mouseClick(x: number, y: number, button: MouseButton, count: 1 | 2) { await this.send('mouseClick', { x, y, button, count }); }
  async mouseScroll(x: number, y: number, delta: number) { await this.send('mouseScroll', { x, y, delta }); }

  /** STOP reaches inside the helper: the abort signal sends cancelInput. */
  async mouseDrag(from: { x: number; y: number }, to: { x: number; y: number }, durationMs: number, signal: AbortSignal) {
    if (signal.aborted) throw Error('Acción de entrada cancelada antes de empezar.');
    const onAbort = () => { void this.send('cancelInput', {}).catch(() => {}); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await this.send('mouseDrag', { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, durationMs });
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  async keyPress(key: string) { await this.send('keyPress', { key }); }
  async keyHotkey(keys: string[]) { await this.send('keyHotkey', { keys }); }

  async typeText(text: string, signal: AbortSignal) {
    if (signal.aborted) throw Error('Acción de entrada cancelada antes de empezar.');
    const onAbort = () => { void this.send('cancelInput', {}).catch(() => {}); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await this.send('typeText', { text });
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  captureDisplay(monitor: number) { return this.send<CaptureBytes>('captureDisplay', { monitor }); }
  captureWindow(windowId: string) { return this.send<CaptureBytes>('captureWindow', { windowId }); }
  captureRegion(bounds: Bounds) { return this.send<CaptureBytes>('captureRegion', { ...bounds }); }
  processes() { return this.send<ProcessInfo[]>('processes', {}); }

  async launch(app: DiscoveredApp, options?: { requireOwnership: boolean }) {
    if (!this.options.launchFn) throw new Error('El lanzamiento de aplicaciones no está configurado.');
    assertProcessScope();
    return this.options.launchFn(app, options);
  }
}
