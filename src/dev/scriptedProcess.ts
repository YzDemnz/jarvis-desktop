import type { ProcessPort, SpawnRequest, SpawnedProcess } from './ports';

export interface ScriptedResponse {
  stdout?: string | string[];
  stderr?: string;
  code?: number;
  delayMs?: number;
  /** A dev server: never exits on its own. */
  forever?: boolean;
}

export type ProcessScript = (req: SpawnRequest & { command: string }) => ScriptedResponse | null;

/**
 * A process port with scripted answers, for the renderer harness where no
 * process can be spawned. Timing, streaming, exit codes and kill-tree are
 * modelled; real process behaviour is tested against Linux separately.
 */
export class ScriptedProcessPort implements ProcessPort {
  readonly platform: 'win32' | 'posix';
  readonly spawned: { command: string; cwd: string; killed: boolean }[] = [];
  constructor(private readonly script: ProcessScript, private readonly installed: string[] = ['node', 'npm', 'npx', 'git', 'python'], platform: 'win32' | 'posix' = 'win32') {
    this.platform = platform;
  }
  async which(exe: string) { return this.installed.includes(exe) ? (this.platform === 'win32' ? `C:\\Tools\\${exe}.exe` : `/usr/bin/${exe}`) : null; }
  baseEnv() { return { PATH: 'C:\\Tools' }; }
  spawn(req: SpawnRequest): SpawnedProcess {
    const exe = req.file.split(/[\\/]/).pop()!.replace(/\.exe$/i, '');
    const command = [exe, ...req.args.filter((a) => !/^-c$|^core\.|^diff\.|^--no-pager$/.test(a) && !/=$/.test(a))].join(' ');
    const record = { command, cwd: req.cwd, killed: false };
    this.spawned.push(record);
    const res = this.script({ ...req, command }) ?? { stderr: `sin guion para: ${command}`, code: 127 };
    const out: ((c: string) => void)[] = [], err: ((c: string) => void)[] = [];
    const exits: ((c: number | null, s: string | null) => void)[] = [];
    let done: [number | null, string | null] | null = null;
    const finish = (c: number | null, s: string | null) => { if (done) return; done = [c, s]; exits.forEach((cb) => cb(c, s)); };
    const timers: ReturnType<typeof setTimeout>[] = [];
    const chunks = Array.isArray(res.stdout) ? res.stdout : res.stdout ? [res.stdout] : [];
    // Large outputs arrive in batches (as a pipe would), not one timer per line.
    const batch = Math.max(1, Math.ceil(chunks.length / 50));
    const batches: string[] = [];
    for (let i = 0; i < chunks.length; i += batch) batches.push(chunks.slice(i, i + batch).join(''));
    const step = Math.max(1, Math.floor((res.delayMs ?? 30) / Math.max(1, batches.length)));
    batches.forEach((c, i) => timers.push(setTimeout(() => { if (!done) out.forEach((cb) => cb(c)); }, step * i)));
    // A process exits after its last byte of output, never before.
    const exitAt = Math.max(res.delayMs ?? 30, step * batches.length + 1);
    timers.push(setTimeout(() => {
      if (res.stderr) err.forEach((cb) => cb(res.stderr!));
      if (!res.forever) finish(res.code ?? 0, null);
    }, exitAt));
    return {
      pid: 4000 + this.spawned.length,
      onStdout: (cb) => { out.push(cb); },
      onStderr: (cb) => { err.push(cb); },
      onExit: (cb) => { if (done) cb(done[0], done[1]); else exits.push(cb); },
      killTree: async () => { record.killed = true; timers.forEach(clearTimeout); finish(null, 'SIGTERM'); },
    };
  }
}
