import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SpawnRequest, SpawnedProcess } from '../../src/dev/ports';

const scopes = new AsyncLocalStorage<{ runId: string; signal?: AbortSignal; validate?: () => void }>();
const owned = new Map<SpawnedProcess, string | null>();
export function withProcessScope<T>(runId: string, signal: AbortSignal | undefined, fn: () => T, validate?: () => void): T { return scopes.run({ runId, signal, validate }, fn); }
export function assertProcessScope(): void { const s = scopes.getStore(); if (s?.signal?.aborted) throw Error('AUTHORITY_RUN_STOPPED'); s?.validate?.(); }
export async function cancelOwnedRun(runId: string): Promise<void> { await Promise.all([...owned].filter(([, id]) => id === runId).map(([p]) => p.killTree())); }
export async function stopOwnedProcesses(): Promise<void> { await Promise.all([...owned.keys()].map(p => p.killTree())); }
export function ownedProcessCount(runId?: string): number { return [...owned.values()].filter(id => runId === undefined || id === runId).length; }

export function processHostPath(): string {
  const resources = (process as typeof process & { resourcesPath?: string }).resourcesPath;
  const candidates = [resources && path.join(resources, 'native', 'jarvis-process-host.exe'),
    path.resolve('native/process-host/bin/Release/net8.0-windows/win-x64/publish/jarvis-process-host.exe')];
  const found = candidates.find((p): p is string => !!p && fs.existsSync(p));
  if (!found) throw Error('WINDOWS_JOB_HOST_NOT_AVAILABLE: no unmanaged fallback');
  return found;
}

/** PID is diagnostic only. STOP addresses an anonymous OS job via its private host. */
export function spawnWindowsJob(req: SpawnRequest, host = processHostPath()): SpawnedProcess {
  const scope = scopes.getStore();
  assertProcessScope();
  const child = spawn(host, [], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let pid: number | null = null, result: [number | null, string | null] | null = null, finished = false, stopping = false;
  const callbacks: Array<(code: number | null, signal: string | null) => void> = [];
  const stdout = new Set<(text: string) => void>(), stderr = new Set<(text: string) => void>();
  const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  let resolveReady!: (pid: number) => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<number>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => {});
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  let buffer = '';
  const startTimer = setTimeout(() => { result = [null, 'ERROR']; rejectReady(Error('WINDOWS_JOB_START_TIMEOUT')); child.kill(); }, 15000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 2 * 1024 * 1024) { result = [null, 'ERROR']; child.kill(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try {
        const event = JSON.parse(line);
        if (event.kind === 'started' && Number.isInteger(event.pid) && event.pid > 0) { clearTimeout(startTimer); pid = event.pid; resolveReady(pid!); }
        if (event.kind === 'output' && ['stdout', 'stderr'].includes(event.stream)) {
          const stream = event.stream as 'stdout' | 'stderr';
          const text = decoders[stream].write(Buffer.from(event.base64, 'base64'));
          (stream === 'stdout' ? stdout : stderr).forEach(cb => cb(text));
        }
        if (event.kind === 'exit') result = [event.exitCode, stopping ? 'STOP' : null];
        if (event.kind === 'error') { result = [null, 'ERROR']; rejectReady(Error('WINDOWS_JOB_LAUNCH_FAILED: ' + (event.code ?? 'invalid request'))); }
      } catch { result = [null, 'ERROR']; child.kill(); }
    }
  });
  // Native errors must not echo request/argv/environment. The error code is sufficient.
  child.stderr.resume();
  child.on('error', () => { result = [null, 'ERROR']; rejectReady(Error('WINDOWS_JOB_HOST_FAILED')); });
  const onAbort = () => { void proc.killTree(); };
  child.once('close', () => {
    clearTimeout(startTimer);
    finished = true; owned.delete(proc); scope?.signal?.removeEventListener('abort', onAbort);
    rejectReady(Error('WINDOWS_JOB_HOST_EXITED_BEFORE_START'));
    for (const stream of ['stdout', 'stderr'] as const) { const tail = decoders[stream].end(); if (tail) (stream === 'stdout' ? stdout : stderr).forEach(cb => cb(tail)); }
    result ??= [null, stopping ? 'STOP' : 'ERROR']; callbacks.forEach(cb => cb(...result!)); resolveClosed();
  });
  child.stdin.on('error', () => {});
  const proc: SpawnedProcess = {
    get pid() { return pid; }, ready, ownership: 'WINDOWS_JOB',
    onStdout(cb) { stdout.add(cb); }, onStderr(cb) { stderr.add(cb); },
    onExit(cb) { if (finished) cb(...result!); else callbacks.push(cb); },
    async killTree() {
      if (finished) return;
      stopping = true; child.stdin.write('STOP\n');
      const timer = setTimeout(() => child.kill(), 5000); // closing the last non-inherited job handle kills its members
      try { await closed; } finally { clearTimeout(timer); }
    },
  };
  owned.set(proc, scope?.runId ?? null);
  child.stdin.write(JSON.stringify(req) + '\n');
  scope?.signal?.addEventListener('abort', onAbort, { once: true });
  if (scope?.signal?.aborted) onAbort();
  return proc;
}
