import type { CommandResult, DeveloperTool, ManagedProcessInfo, ProcessRequest } from '@/types';
import type { ProcessPort, SpawnedProcess } from './ports';
import { safeContextText as sanitizeText } from '@/fabric/ContinuityState';
import { uid } from '@/lib/id';

export interface OutputLimits {
  /** Bytes kept for the model/UI; the rest goes to the temporary store. */
  maxBytes: number;
  headLines: number;
  tailLines: number;
  /** Hard cap for the temporary store, per command. */
  storeBytes: number;
  timeoutMs: number;
}

export const DEFAULT_OUTPUT_LIMITS: OutputLimits = {
  maxBytes: 64 * 1024, headLines: 60, tailLines: 200, storeBytes: 20 * 1024 * 1024, timeoutMs: 10 * 60_000,
};

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
const clean = (s: string) => sanitizeText(s.replace(ANSI, '').replace(/\r(?!\n)/g, '\n'));

/**
 * Full outputs kept for a while so the user (or the agent, with a search) can
 * look at them — never pushed wholesale to the model or the conversation.
 */
export class OutputStore {
  private items = new Map<string, { text: string; at: number }>();
  constructor(private readonly ttlMs = 30 * 60_000) {}
  put(text: string): string {
    this.sweep();
    const id = uid('out');
    this.items.set(id, { text, at: Date.now() });
    return id;
  }
  get(id: string): string | null { this.sweep(); return this.items.get(id)?.text ?? null; }
  search(id: string, query: string, limit = 50): { line: number; text: string }[] {
    const text = this.get(id);
    if (!text || !query) return [];
    const q = query.toLowerCase();
    return text.split('\n').map((t, i) => ({ line: i + 1, text: t.slice(0, 300) })).filter((l) => l.text.toLowerCase().includes(q)).slice(0, limit);
  }
  private sweep() { const now = Date.now(); for (const [k, v] of this.items) if (now - v.at > this.ttlMs) this.items.delete(k); }
  size() { return this.items.size; }
}

/** head + "… N líneas omitidas …" + tail, capped in bytes. */
export function summarizeOutput(text: string, limits: OutputLimits): { text: string; truncated: boolean } {
  const lines = text.split('\n');
  let out = text;
  let truncated = false;
  if (lines.length > limits.headLines + limits.tailLines) {
    out = [...lines.slice(0, limits.headLines), `… ${lines.length - limits.headLines - limits.tailLines} líneas omitidas …`, ...lines.slice(-limits.tailLines)].join('\n');
    truncated = true;
  }
  if (out.length > limits.maxBytes) {
    out = `${out.slice(0, limits.maxBytes / 4)}\n… salida recortada …\n${out.slice(-limits.maxBytes * 3 / 4)}`;
    truncated = true;
  }
  return { text: out, truncated };
}

interface Running { runId: string | null; proc: SpawnedProcess; commandId: string }

/**
 * Starts structured processes: executable + argv + explicit cwd, no shell.
 * The policy decision is made before this is called (broker + CommandPolicy);
 * this layer enforces the mechanics: environment filtering, output limits,
 * secret sanitising, timeout, and cancellation of exactly the process tree it
 * started — nothing else.
 */
export class TerminalService {
  readonly outputs = new OutputStore();
  private running = new Map<string, Running>();

  constructor(private readonly port: ProcessPort, private readonly limits: OutputLimits = DEFAULT_OUTPUT_LIMITS) {}

  /**
   * On Windows, npm/npx/pnpm/yarn are .cmd shims, which Node refuses to spawn
   * without a shell. They go through cmd.exe with every argument quoted; the
   * policy has already rejected any argument containing a cmd metacharacter.
   */
  async resolveLaunch(executable: string, args: string[]): Promise<{ file: string; args: string[]; verbatim: boolean }> {
    const resolved = await this.port.which(executable);
    if (!resolved) throw new Error(`«${executable}» no está instalado o no está en el PATH.`);
    if (this.port.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
      if (args.some((a) => /[&|<>^%!"\r\n]/.test(a))) throw new Error('Argumento con metacaracteres de cmd.exe.');
      const quote = (s: string) => `"${s}"`;
      const commandProcessor = Object.entries(this.port.baseEnv()).find(([k]) => k.toUpperCase() === 'COMSPEC')?.[1] ?? await this.port.which('cmd.exe');
      if (!commandProcessor) throw Error('cmd.exe no está disponible.');
      return { file: commandProcessor, args: ['/d', '/s', '/c', `"${[resolved, ...args].map(quote).join(' ')}"`], verbatim: true };
    }
    return { file: resolved, args, verbatim: false };
  }

  async execute(req: ProcessRequest, opts: { runId?: string | null; signal?: AbortSignal; onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void } = {}): Promise<CommandResult> {
    const commandId = uid('cmd');
    const launch = await this.resolveLaunch(req.executable, req.args);
    if (opts.signal?.aborted) throw new Error('AUTHORITY_RUN_STOPPED');
    const started = Date.now();
    const env = { ...this.port.baseEnv(), ...(req.envSubset ?? {}) };
    const proc = this.port.spawn({ file: launch.file, args: launch.args, cwd: req.cwd, env, ...(launch.verbatim ? { windowsVerbatimArguments: true } : {}) });
    this.running.set(commandId, { runId: opts.runId ?? null, proc, commandId });

    let stdout = '', stderr = '', total = 0, storeOverflow = false;
    const streamPending = { stdout: '', stderr: '' };
    const take = (which: 'stdout' | 'stderr') => (chunk: string) => {
      total += chunk.length;
      streamPending[which] += chunk;
      if (streamPending[which].length > this.limits.storeBytes) streamPending[which] = '[overlong output omitted]\n';
      const end = streamPending[which].lastIndexOf('\n');
      if (end >= 0) { opts.onOutput?.(clean(streamPending[which].slice(0, end + 1)), which); streamPending[which] = streamPending[which].slice(end + 1); }
      if (stdout.length + stderr.length + chunk.length > this.limits.storeBytes) { storeOverflow = true; return; }
      if (which === 'stdout') stdout += chunk; else stderr += chunk;
    };
    proc.onStdout(take('stdout'));
    proc.onStderr(take('stderr'));

    let timedOut = false, cancelled = false;
    const timeout = Math.min(req.timeoutMs ?? this.limits.timeoutMs, this.limits.timeoutMs);
    const timer = setTimeout(() => { timedOut = true; void proc.killTree(); }, timeout);
    const onAbort = () => { cancelled = true; void proc.killTree(); };
    if (opts.signal?.aborted) onAbort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const [exitCode, signal] = await new Promise<[number | null, string | null]>((resolve) => proc.onExit((c, s) => resolve([c, s])));
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    this.running.delete(commandId);
    for (const which of ['stdout', 'stderr'] as const) if (streamPending[which]) opts.onOutput?.(clean(streamPending[which]), which);
    if (signal === 'ERROR' && !cancelled && !timedOut) throw new Error(`No se pudo iniciar «${req.executable}».`);

    const fullOut = clean(stdout), fullErr = clean(stderr);
    const out = summarizeOutput(fullOut, this.limits);
    const err = summarizeOutput(fullErr, this.limits);
    const truncated = out.truncated || err.truncated || storeOverflow;
    return {
      commandId, exitCode, signal, stdout: out.text, stderr: err.text,
      durationMs: Date.now() - started, timedOut, cancelled: cancelled || signal === 'STOP', truncated, totalBytes: total,
      outputId: truncated ? this.outputs.put(`${fullOut}${fullErr ? `\n--- stderr ---\n${fullErr}` : ''}${storeOverflow ? '\n… salida descartada por exceder el máximo …' : ''}`) : null,
    };
  }

  /** STOP: kills the trees of this run's commands. Never processes it did not start. */
  async cancelRun(runId: string): Promise<number> {
    const mine = [...this.running.values()].filter((r) => r.runId === runId);
    await Promise.all(mine.map((r) => r.proc.killTree()));
    return mine.length;
  }

  runningCount(runId?: string): number {
    return [...this.running.values()].filter((r) => runId === undefined || r.runId === runId).length;
  }
}

/* ------------------------------------------------------------------ */
/* Long-running processes                                              */
/* ------------------------------------------------------------------ */

interface Managed { info: ManagedProcessInfo; proc: SpawnedProcess; log: string[] }

/**
 * Dev servers and watchers. JARVIS knows exactly which ones it started and can
 * stop only those. Processes it did not start are not in this list and there
 * is no method to reach them.
 */
export class ManagedProcessRegistry {
  private items = new Map<string, Managed>();
  private changeListeners = new Set<() => void>();
  /** Started, exited or stopped: the UI list must follow without polling. */
  onChange(cb: () => void): () => void { this.changeListeners.add(cb); return () => { this.changeListeners.delete(cb); }; }
  private changed() { this.changeListeners.forEach((l) => l()); }
  constructor(private readonly terminal: TerminalService, private readonly port: ProcessPort, private readonly maxLogLines = 2000) {}

  async start(req: ProcessRequest, opts: { runId: string | null; label?: string; signal?: AbortSignal }): Promise<ManagedProcessInfo> {
    const launch = await this.terminal.resolveLaunch(req.executable, req.args);
    if (opts.signal?.aborted) throw new Error('AUTHORITY_RUN_STOPPED');
    const proc = this.port.spawn({ file: launch.file, args: launch.args, cwd: req.cwd, env: { ...this.port.baseEnv(), ...(req.envSubset ?? {}) }, ...(launch.verbatim ? { windowsVerbatimArguments: true } : {}) });
    const info: ManagedProcessInfo = {
      id: uid('svc'), runId: opts.runId, label: opts.label ?? `${req.executable}: ${req.args.length} argumentos`,
      executable: req.executable, args: req.args.map(() => '[argumento privado]'), cwd: req.cwd, pid: proc.pid, status: 'running', startedAt: Date.now(), exitCode: null,
    };
    const entry: Managed = { info, proc, log: [] };
    const pending = { stdout: '', stderr: '' };
    const push = (stream: 'stdout' | 'stderr') => (chunk: string) => {
      pending[stream] += chunk;
      if (pending[stream].length > 65536) pending[stream] = '[overlong output omitted]\n';
      const end = pending[stream].lastIndexOf('\n'); if (end < 0) return;
      entry.log.push(...clean(pending[stream].slice(0, end + 1)).split('\n').filter(Boolean)); pending[stream] = pending[stream].slice(end + 1);
      if (entry.log.length > this.maxLogLines) entry.log.splice(0, entry.log.length - this.maxLogLines);
    };
    proc.onStdout(push('stdout'));
    proc.onStderr(push('stderr'));
    proc.onExit((code, signal) => {
      for (const stream of ['stdout', 'stderr'] as const) if (pending[stream]) entry.log.push(clean(pending[stream]));
      if (entry.log.length > this.maxLogLines) entry.log.splice(0, entry.log.length - this.maxLogLines);
      if (info.status === 'running') info.status = signal === 'ERROR' ? 'failed' : 'exited';
      info.exitCode = code;
      this.changed();
    });
    this.items.set(info.id, entry);
    if (proc.ready) info.pid = await proc.ready;
    if (opts.signal?.aborted) { await proc.killTree(); throw Error('AUTHORITY_RUN_STOPPED'); }
    this.changed();
    return { ...info };
  }

  status(id: string): ManagedProcessInfo | null { const e = this.items.get(id); return e ? { ...e.info } : null; }
  list(): ManagedProcessInfo[] { return [...this.items.values()].map((e) => ({ ...e.info })); }
  logs(id: string, tail = 200): string[] { return this.items.get(id)?.log.slice(-Math.min(tail, this.maxLogLines)) ?? []; }

  async stop(id: string): Promise<ManagedProcessInfo> {
    const e = this.items.get(id);
    if (!e) throw new Error('JARVIS no inició ese proceso; sólo puede detener los suyos.');
    if (e.info.status === 'running') {
      e.info.status = 'stopped';
      await e.proc.killTree();
      this.changed();
    }
    return { ...e.info };
  }

  async stopRun(runId: string): Promise<number> {
    const mine = [...this.items.values()].filter((e) => e.info.runId === runId && e.info.status === 'running');
    await Promise.all(mine.map((e) => this.stop(e.info.id)));
    return mine.length;
  }

  async stopAll(): Promise<void> { await Promise.all([...this.items.keys()].map((id) => this.stop(id).catch(() => {}))); }
}

/* ------------------------------------------------------------------ */
/* Tool discovery                                                      */
/* ------------------------------------------------------------------ */

const TOOL_PROBES: { id: string; executable: string; args: string[] }[] = [
  { id: 'node', executable: 'node', args: ['--version'] },
  { id: 'npm', executable: 'npm', args: ['--version'] },
  { id: 'pnpm', executable: 'pnpm', args: ['--version'] },
  { id: 'yarn', executable: 'yarn', args: ['--version'] },
  { id: 'python', executable: 'python', args: ['--version'] },
  { id: 'python3', executable: 'python3', args: ['--version'] },
  { id: 'pip', executable: 'pip', args: ['--version'] },
  { id: 'git', executable: 'git', args: ['--version'] },
  { id: 'dotnet', executable: 'dotnet', args: ['--version'] },
  { id: 'cargo', executable: 'cargo', args: ['--version'] },
  { id: 'go', executable: 'go', args: ['version'] },
  { id: 'java', executable: 'java', args: ['-version'] },
  { id: 'javac', executable: 'javac', args: ['-version'] },
  { id: 'cmake', executable: 'cmake', args: ['--version'] },
];

/**
 * What is actually installed. Every probe is a fixed, internal command with a
 * bounded timeout; a tool that is on PATH but does not answer with a version
 * (the Windows Store "python" alias, a broken install) is reported unavailable.
 */
export class DeveloperToolDiscovery {
  private cache: DeveloperTool[] | null = null;
  constructor(private readonly port: ProcessPort, private readonly terminal: TerminalService) {}

  async discover(force = false): Promise<DeveloperTool[]> {
    if (this.cache && !force) return this.cache;
    const results: DeveloperTool[] = [];
    // Native SDKs on an external HDD compete for cold DLL reads. Probe them
    // sequentially so discovery does not misclassify an installed tool.
    for (const p of TOOL_PROBES) {
      const path = await this.port.which(p.executable);
      if (!path) { results.push({ id: p.id, executable: p.executable, path: null, version: null, available: false }); continue; }
      try {
        // Cold SDK/DLL loading from a portable external disk can exceed eight
        // seconds. Keep discovery bounded without caching a false absence.
        const r = await this.terminal.execute({ executable: p.executable, args: p.args, cwd: '.', timeoutMs: 60000 });
        const version = `${r.stdout}\n${r.stderr}`.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? null;
        results.push({ id: p.id, executable: p.executable, path, version, available: r.exitCode === 0 && version !== null });
      } catch {
        results.push({ id: p.id, executable: p.executable, path, version: null, available: false });
      }
    }
    this.cache = results;
    return results;
  }

  async has(id: string): Promise<boolean> { return (await this.discover()).some((t) => t.id === id && t.available); }
}
