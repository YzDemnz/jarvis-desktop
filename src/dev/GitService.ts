import type { CommandResult, GitStatus, GitStatusEntry, GitSummary } from '@/types';
import type { TerminalService } from './TerminalService';
import { sanitizeText } from '@/machine/CredentialBoundary';

/**
 * Neutralises repository-controlled command execution on every call: a cloned
 * repo's .git/config can set core.fsmonitor (runs on `git status`), an external
 * diff or textconv (runs on `git diff`), or a pager. None of those run here.
 */
const HARDEN = ['-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'diff.external=', '-c', 'core.hooksPath=', '--no-pager'];
const HARDEN_KEEP_HOOKS = ['-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'diff.external=', '--no-pager'];

const REF = /^(?!-)[\w./~^@{}-]{1,200}$/;
const PATHSPEC = /^(?!-)(?!.*\.\.)[^\0*?[\]:]{1,1024}$/;

export function parsePorcelainZ(raw: string): GitStatus {
  const parts = raw.split('\0');
  const status: GitStatus = { isRepo: true, branch: null, entries: [] };
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i]!;
    if (!rec) continue;
    if (rec.startsWith('## ')) {
      const m = rec.slice(3).match(/^(?:No commits yet on |Initial commit on )?([^.\s]+)/);
      status.branch = m?.[1] ?? null;
      continue;
    }
    const entry: GitStatusEntry = { index: rec[0]!, worktree: rec[1]!, path: rec.slice(3) };
    if (entry.index === 'R' || entry.index === 'C') entry.origPath = parts[++i];
    status.entries.push(entry);
  }
  return status;
}

export class GitError extends Error {}

/**
 * Local Git only. Reads are free; writes are narrow and never destructive:
 * there is no reset --hard, clean, push, rebase or force anything — those do
 * not exist as methods. A worktree restore is refused for files that had
 * changes before JARVIS started, so the user's work is never "cleaned up".
 */
export class GitService {
  constructor(private readonly terminal: TerminalService, private readonly options: { allowCommit?: boolean } = {}) {}

  private async git(cwd: string, args: string[], opts: { keepHooks?: boolean; allowFail?: boolean } = {}): Promise<CommandResult> {
    const r = await this.terminal.execute({
      executable: 'git', args: [...(opts.keepHooks ? HARDEN_KEEP_HOOKS : HARDEN), ...args], cwd,
      envSubset: { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }, timeoutMs: 60_000,
    });
    if (r.exitCode !== 0 && !opts.allowFail) throw new GitError(sanitizeText(r.stderr || r.stdout || `git ${args[0]} falló`).trim().slice(0, 500));
    return r;
  }

  private checkPaths(paths: string[]): string[] {
    if (!Array.isArray(paths) || !paths.length || paths.length > 500) throw new GitError('Indica entre 1 y 500 rutas.');
    for (const p of paths) if (typeof p !== 'string' || !PATHSPEC.test(p)) throw new GitError(`Ruta no válida para Git: ${String(p)}`);
    return paths;
  }

  async status(cwd: string): Promise<GitStatus> {
    const r = await this.git(cwd, ['status', '--porcelain=v1', '-z', '-b', '--untracked-files=all'], { allowFail: true });
    if (r.exitCode !== 0) return { isRepo: false, branch: null, entries: [] };
    // Porcelain output is summarised by the terminal when huge; status is not.
    return parsePorcelainZ(r.stdout);
  }

  async summary(cwd: string): Promise<GitSummary> {
    const s = await this.status(cwd);
    return { isRepo: s.isRepo, branch: s.branch, dirty: s.entries.length > 0, changedFiles: s.entries.length };
  }

  async diff(cwd: string, opts: { path?: string; staged?: boolean } = {}): Promise<string> {
    const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color'];
    if (opts.staged) args.push('--staged');
    if (opts.path) args.push('--', ...this.checkPaths([opts.path]));
    return (await this.git(cwd, args)).stdout;
  }

  async log(cwd: string, limit = 20): Promise<{ hash: string; author: string; date: string; subject: string }[]> {
    const n = Math.max(1, Math.min(50, limit));
    const r = await this.git(cwd, ['log', `-n${n}`, '--no-color', '--date=iso', '--pretty=format:%H%x1f%an%x1f%ad%x1f%s'], { allowFail: true });
    if (r.exitCode !== 0) return [];
    return r.stdout.split('\n').filter(Boolean).map((l) => {
      const [hash = '', author = '', date = '', subject = ''] = l.split('\x1f');
      return { hash, author, date, subject };
    });
  }

  /** Stable project identity across ordinary commits, using the existing hardened Git runner. */
  async rootCommits(cwd: string): Promise<string[]> {
    const r = await this.git(cwd, ['rev-list', '--max-parents=0', 'HEAD'], { allowFail: true });
    if (r.exitCode !== 0) return [];
    return r.stdout.split('\n').map(value => value.trim()).filter(value => /^[0-9a-f]{40,64}$/i.test(value)).sort();
  }

  async topLevel(cwd: string): Promise<string | null> {
    const r = await this.git(cwd, ['rev-parse', '--show-toplevel'], { allowFail: true });
    return r.exitCode === 0 ? r.stdout.trim() || null : null;
  }

  /** Tracked files plus untracked, non-ignored files; no index or working-tree mutation. */
  async snapshotPaths(cwd: string): Promise<string[]> {
    const tracked = await this.git(cwd, ['ls-files', '-z', '--cached', '--full-name']);
    const untracked = await this.git(cwd, ['ls-files', '-z', '--others', '--exclude-standard', '--full-name']);
    if (tracked.truncated || untracked.truncated) throw new GitError('SCRATCH_FILE_LIST_TRUNCATED');
    return [...new Set([...tracked.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean))].sort();
  }

  async branches(cwd: string): Promise<{ current: string | null; all: string[] }> {
    const cur = await this.git(cwd, ['branch', '--show-current'], { allowFail: true });
    const all = await this.git(cwd, ['branch', '--format=%(refname:short)'], { allowFail: true });
    return { current: cur.stdout.trim() || null, all: all.stdout.split('\n').map((s) => s.trim()).filter(Boolean) };
  }

  async show(cwd: string, ref: string, path?: string): Promise<string> {
    if (!REF.test(ref)) throw new GitError('Referencia no válida.');
    const target = path ? `${ref}:${this.checkPaths([path])[0]}` : ref;
    return (await this.git(cwd, ['show', '--no-ext-diff', '--no-textconv', '--no-color', target])).stdout;
  }

  async add(cwd: string, paths: string[]): Promise<void> {
    await this.git(cwd, ['add', '--', ...this.checkPaths(paths)]);
  }

  /** Unstage only. The files on disk are not touched. */
  async unstage(cwd: string, paths: string[]): Promise<void> {
    await this.git(cwd, ['restore', '--staged', '--', ...this.checkPaths(paths)]);
  }

  /**
   * Discards working-tree changes for specific files — only for files that were
   * clean when JARVIS started. `protectedPaths` are the pre-existing changes.
   */
  async restoreFiles(cwd: string, paths: string[], protectedPaths: string[]): Promise<void> {
    const checked = this.checkPaths(paths);
    const hit = checked.find((p) => protectedPaths.includes(p));
    if (hit) throw new GitError(`«${hit}» tenía cambios tuyos antes de que JARVIS empezara; no se restaura.`);
    await this.git(cwd, ['restore', '--worktree', '--', ...checked]);
  }

  async commit(cwd: string, message: string): Promise<string> {
    if (!this.options.allowCommit) throw new GitError('Los commits están deshabilitados para JARVIS en este proyecto.');
    if (!message.trim() || message.length > 2000) throw new GitError('Mensaje de commit inválido.');
    await this.git(cwd, ['commit', '-m', sanitizeText(message)], { keepHooks: true });
    return (await this.git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
  }

  /** Paths with changes right now, relative to the repo root. */
  async dirtyPaths(cwd: string): Promise<string[]> {
    return (await this.status(cwd)).entries.map((e) => e.path);
  }
}

/**
 * Splits "what changed" into the user's pre-existing work, JARVIS's own
 * changes, and anything the user changed while JARVIS was working — so JARVIS
 * never takes credit (or blame) for someone else's edits.
 */
export function attributeChanges(opts: { baseline: string[]; now: string[]; jarvis: string[] }): { preExisting: string[]; byJarvis: string[]; byUserDuringRun: string[] } {
  const jarvis = new Set(opts.jarvis);
  const baseline = new Set(opts.baseline);
  return {
    preExisting: opts.baseline,
    byJarvis: opts.jarvis,
    byUserDuringRun: opts.now.filter((p) => !jarvis.has(p) && !baseline.has(p)),
  };
}
