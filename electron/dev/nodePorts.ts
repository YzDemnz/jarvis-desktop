import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { DirEntry, FsPort, FsStat, ProcessPort, SnapshotPort, SpawnRequest, SpawnedProcess, TrashPort } from '../../src/dev/ports';
import { TEMP_MARKER } from '../../src/dev/ports';
import { sha256Bytes } from '../../src/dev/hash';
import { spawnWindowsJob, assertProcessScope } from '../process/WindowsJobProcess';

const toStat = (s: fs.Stats, link = false): FsStat => ({
  isFile: s.isFile(), isDirectory: s.isDirectory(), isSymlink: link || s.isSymbolicLink(), size: s.size, mtimeMs: s.mtimeMs,
});

export class NodeFsPort implements FsPort {
  readonly flavor = process.platform === 'win32' ? 'win32' as const : 'posix' as const;
  // realpath.native resolves NTFS junctions and symlinks on Windows.
  async realpath(p: string) { return fsp.realpath(p).then((r) => (process.platform === 'win32' ? fs.realpathSync.native(r) : r)); }
  async stat(p: string) { return toStat(await fsp.stat(p)); }
  async lstat(p: string) { return toStat(await fsp.lstat(p)); }
  async exists(p: string) { try { await fsp.lstat(p); return true; } catch { return false; } }
  async readdir(p: string): Promise<DirEntry[]> {
    return (await fsp.readdir(p, { withFileTypes: true })).map((d) => ({
      name: d.name, isDirectory: d.isDirectory(), isFile: d.isFile(), isSymlink: d.isSymbolicLink(),
    }));
  }
  async readFile(p: string) { return new Uint8Array(await fsp.readFile(p)); }
  async writeFile(p: string, data: Uint8Array) {
    assertProcessScope();
    // 'wx' on the temp: never follow or reuse an existing path.
    const fh = await fsp.open(p, 'wx');
    try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
  }
  async rename(from: string, to: string) { assertProcessScope(); await fsp.rename(from, to); }
  async copyFile(from: string, to: string) { assertProcessScope(); await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL); }
  async mkdir(p: string) { assertProcessScope(); await fsp.mkdir(p, { recursive: true }); }
  async rmdirEmpty(p: string) { assertProcessScope(); await fsp.rmdir(p); }
  async removeTemp(p: string) {
    if (!path.basename(p).includes(TEMP_MARKER)) throw new Error('removeTemp sólo acepta temporales de JARVIS.');
    await fsp.unlink(p);
  }
}

/**
 * Tests and non-Electron hosts: a folder that plays the Recycle Bin. It moves,
 * never deletes. Production uses ElectronTrashPort (the real Recycle Bin).
 */
export class DirectoryTrashPort implements TrashPort {
  readonly native = false;
  constructor(private readonly binDir: string) {}
  async trash(p: string) {
    await fsp.mkdir(this.binDir, { recursive: true });
    await fsp.rename(p, path.join(this.binDir, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${path.basename(p)}`));
  }
}

/** Content-addressed, so the same pre-change content is stored once. */
export class DiskSnapshotPort implements SnapshotPort {
  constructor(private readonly dir: string) {}
  async put(data: Uint8Array) {
    const id = sha256Bytes(data);
    await fsp.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, id);
    if (!fs.existsSync(file)) await fsp.writeFile(file, data);
    return id;
  }
  async get(id: string) {
    if (!/^[0-9a-f]{64}$/.test(id)) return null;
    try { return new Uint8Array(await fsp.readFile(path.join(this.dir, id))); } catch { return null; }
  }
  async list() { try { return (await fsp.readdir(this.dir)).filter((n) => /^[0-9a-f]{64}$/.test(n)); } catch { return []; } }
  /** Only JARVIS's own snapshot files, by content hash name. */
  async delete(id: string) { if (/^[0-9a-f]{64}$/.test(id)) await fsp.unlink(path.join(this.dir, id)).catch(() => {}); }
}

/** fs.watch recursive (native on Windows/macOS; Linux since Node 20). */
export class NodeWatchPort {
  watch(root: string, onChange: (rel: string) => void): () => void {
    try {
      const w = fs.watch(root, { recursive: true }, (_type, file) => { if (file) onChange(String(file)); });
      w.on('error', () => { /* folder removed: the next refresh reconciles */ });
      return () => w.close();
    } catch { return () => {}; }
  }
}

/* ------------------------------------------------------------------ */
/* Processes                                                           */
/* ------------------------------------------------------------------ */

const SAFE_ENV = /^(PATH|PATHEXT|SYSTEMROOT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|ProgramFiles|ProgramFiles\(x86\)|CommonProgramFiles|LANG|LC_ALL|LC_CTYPE|TERM|SHELL|USER|USERNAME|LOGNAME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|HOMEDRIVE|HOMEPATH|NODE_ENV|CI|JAVA_HOME|GOPATH|GOROOT|CARGO_HOME|RUSTUP_HOME|DOTNET_ROOT|DOTNET_CLI_HOME|DOTNET_BUNDLE_EXTRACT_BASE_DIR|DOTNET_CLI_TELEMETRY_OPTOUT|DOTNET_SKIP_FIRST_TIME_EXPERIENCE|DOTNET_GENERATE_ASPNET_CERTIFICATE|NUGET_PACKAGES|PYTHONPATH|VIRTUAL_ENV|npm_config_cache|npm_config_prefix|ELECTRON_CACHE|ELECTRON_BUILDER_CACHE|PLAYWRIGHT_BROWSERS_PATH)$/i;

/**
 * Child processes inherit only a known-safe subset of the environment. Tokens,
 * API keys and cloud credentials in JARVIS's own environment never reach a
 * command a model asked for.
 */
export function filteredEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && SAFE_ENV.test(k)) out[k] = v;
  return out;
}

export class NodeProcessPort implements ProcessPort {
  readonly platform = process.platform === 'win32' ? 'win32' as const : 'posix' as const;

  async which(executable: string): Promise<string | null> {
    if (path.isAbsolute(executable)) return fs.existsSync(executable) ? executable : null;
    if (/[\\/]/.test(executable)) return null;
    const exts = this.platform === 'win32' ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase()) : [''];
    for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
      for (const ext of this.platform === 'win32' && path.extname(executable) ? [''] : exts) {
        const candidate = path.join(dir, executable + ext);
        try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* next */ }
      }
    }
    return null;
  }

  baseEnv() { return filteredEnv(); }

  spawn(req: SpawnRequest): SpawnedProcess {
    if (this.platform === 'win32') return spawnWindowsJob({ ...req, cwd: path.resolve(req.cwd) });
    // shell:false, always. On POSIX the child leads its own process group so
    // killTree reaches its descendants and nothing else.
    const child = spawn(req.file, req.args, {
      cwd: req.cwd, env: req.env, shell: false, windowsHide: true,
      ...(req.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exitCbs: ((c: number | null, s: string | null) => void)[] = [];
    let exited: [number | null, string | null] | null = null;
    child.on('exit', (c, s) => { exited = [c, s]; exitCbs.forEach((cb) => cb(c, s)); });
    child.on('error', () => { if (!exited) { exited = [null, 'ERROR']; exitCbs.forEach((cb) => cb(null, 'ERROR')); } });
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    const pid = child.pid ?? null;
    return {
      pid,
      onStdout: (cb) => { child.stdout?.on('data', cb); },
      onStderr: (cb) => { child.stderr?.on('data', cb); },
      onExit: (cb) => { if (exited) cb(exited[0], exited[1]); else exitCbs.push(cb); },
      killTree: async () => {
        if (pid === null || exited) return;
        try { process.kill(-pid, 'SIGTERM'); } catch { /* group gone */ }
        await new Promise((r) => setTimeout(r, 400));
        try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ }
      },
    };
  }
}
