import type { DevProject, PatchOp, ProcessRequest, ToolDefinition, VerificationFailure } from '@/types';
import type { AdapterMap } from '@/agent/adapters/types';
import type { PolicyDecision, ToolPolicy } from '@/agent/ToolBroker';
import type { FsPort, ProcessPort, SnapshotPort, TrashPort } from './ports';
import type { WatchPort } from './ProjectWatcher';
import type { ConfigPort, OpenProject } from './ProjectService';
import type { MassLimits } from './ChangeSetStore';
import { PathGuard } from './PathGuard';
import { FileMutationService } from './FileMutationService';
import { ProjectService } from './ProjectService';
import { TerminalService, ManagedProcessRegistry, DeveloperToolDiscovery } from './TerminalService';
import { GitService, attributeChanges } from './GitService';
import { classifyCommand } from './commandPolicy';
import { DEFAULT_MASS_LIMITS, massChangeReason } from './ChangeSetStore';
import { CodeContextBuilder, detectChecks } from './coding';
import { basename, isAbsolute, relative, resolve } from './paths';
import { isSecretFile } from './classify';
import { fromUtf8 } from './hash';
import { applyOps, patchResult } from './patch';
import { safeContextText } from '@/fabric/ContinuityState';

export interface DevServiceDeps {
  assertMutation?: () => void;
  fullNative?: () => boolean;
  controlPaths?: string[];
  fs: FsPort;
  trash: TrashPort;
  snapshots: SnapshotPort;
  processes: ProcessPort;
  watch?: WatchPort | null;
  config?: ConfigPort;
  protectedPaths?: string[];
  installDir?: string | null;
  home?: string | null;
  allowCommit?: boolean;
  massLimits?: MassLimits;
}

export interface CommandLogEntry {
  id: string;
  runId: string;
  label: string;
  cwd: string;
  status: 'running' | 'passed' | 'failed' | 'cancelled';
  startedAt: number;
  live: string;
  result?: import('@/types').CommandResult;
  error?: string;
}

const WRITE_TOOLS = new Set(['file.create', 'file.write', 'file.patch', 'file.rename', 'file.move', 'file.copy', 'directory.create', 'file.trash']);
const str = (v: unknown, name: string): string => { if (typeof v !== 'string' || !v) throw new Error(`Falta «${name}».`); return v; };

/**
 * The developer agent's services behind one object. It produces the tool
 * adapters (the only code that touches disk and processes) and the dev policy
 * the broker applies before any of them run. In production it lives in the
 * main process; the renderer harness runs it over in-memory ports.
 */
export class DevService {
  readonly guard: PathGuard;
  readonly files: FileMutationService;
  readonly projects: ProjectService;
  readonly terminal: TerminalService;
  readonly managed: ManagedProcessRegistry;
  readonly tools: DeveloperToolDiscovery;
  readonly git: GitService;
  private runProject = new Map<string, string>();
  private baselines = new Map<string, string[]>();
  private lastProject: string | null = null;
  private readonly limits: MassLimits;

  constructor(private readonly deps: DevServiceDeps) {
    this.guard = new PathGuard(deps.fs, { ...(deps.protectedPaths ? { protectedPaths: deps.protectedPaths } : {}), installDir: deps.installDir ?? null, home: deps.home ?? null, fullNative: deps.fullNative, controlPaths: deps.controlPaths });
    this.terminal = new TerminalService(deps.processes);
    this.git = new GitService(this.terminal, { allowCommit: deps.allowCommit ?? false });
    this.projects = new ProjectService(deps.fs, this.guard, {
      ...(deps.config ? { config: deps.config } : {}),
      gitSummary: (root) => this.git.summary(root),
      watchPort: deps.watch ?? null,
    });
    this.files = new FileMutationService(deps.fs, this.guard, deps.snapshots, deps.trash, {
      assertMutation: deps.assertMutation,
      onSelfWrite: (path) => this.projects.openedFor(path)?.watcher?.expectSelfWrite(path),
    });
    this.managed = new ManagedProcessRegistry(this.terminal, deps.processes);
    this.tools = new DeveloperToolDiscovery(deps.processes, this.terminal);
    this.limits = deps.massLimits ?? DEFAULT_MASS_LIMITS;
  }

  async init(): Promise<void> { await this.projects.init(); }

  /** The project the user opened in the UI becomes the agent's default one. */
  async focus(projectId: string) {
    const open = await this.projects.open(projectId);
    this.lastProject = projectId;
    return open;
  }

  private f() { return this.deps.fs.flavor; }

  /** The project a call refers to: explicit id/name, else the run's, else the last opened. */
  async projectFor(runId: string, ref?: unknown): Promise<OpenProject> {
    let id: string | undefined;
    if (typeof ref === 'string' && ref) {
      if (!this.projects.list().length) await this.projects.discover();
      id = this.projects.resolve(ref)?.id;
      if (!id) { await this.projects.discover(); id = this.projects.resolve(ref)?.id; }
      if (!id) throw new Error(`No encuentro el proyecto «${ref}» en los Project Roots.`);
    } else id = this.runProject.get(runId) ?? this.lastProject ?? undefined;
    if (!id) throw new Error('No hay un proyecto abierto. Usa project.open.');
    const open = await this.projects.open(id);
    if (!this.runProject.has(runId)) {
      this.runProject.set(runId, id);
      // Capture the pre-existing state once per run: those changes are the user's.
      const baseline = open.project.git.isRepo ? await this.git.dirtyPaths(open.project.rootPath).catch(() => []) : [];
      this.baselines.set(runId, baseline);
      this.files.changes.begin(runId, open.project.rootPath, baseline);
    }
    this.lastProject = id;
    return open;
  }

  private async cwdFor(open: OpenProject, cwd: unknown): Promise<string> {
    const target = typeof cwd === 'string' && cwd && cwd !== '.' ? cwd : open.project.rootPath;
    const g = await this.guard.check(target, { write: false, base: open.project.rootPath });
    return g.path;
  }

  private policyContext(root: string) {
    return { flavor: this.f(), projectRoot: root, protectedPaths: this.guard.protectedPaths, home: this.deps.home ?? null, allowCommit: this.deps.allowCommit ?? false, accessMode: this.deps.fullNative?.() ? 'FULL' as const : 'RESTRICTED' as const };
  }

  /** Lexical projection of a tool call for the policy (before the adapter runs). */
  private async pendingPath(runId: string, args: Record<string, unknown>): Promise<string | null> {
    const p = (args.to ?? args.path) as unknown;
    if (typeof p !== 'string') return null;
    const id = this.runProject.get(runId) ?? this.lastProject;
    const root = id ? this.projects.get(id)?.rootPath : undefined;
    return isAbsolute(p, this.f()) || !root ? p : resolve(root, p, this.f());
  }

  /**
   * Dev policy, applied by the broker in the renderer AND again in main. It can
   * veto or escalate, never relax:
   *   - a run's cumulative ChangeSet over the mass-change limits → escalation;
   *   - secret files (.env, keys) → always asks, even in FULL CONTROL;
   *   - commands: blocked ones vetoed, destructive ones escalated, dev servers
   *     refused as commands (they must be managed processes);
   *   - git commit → always asks.
   */
  policy(): ToolPolicy {
    return async ({ tool, request, context }): Promise<PolicyDecision> => this.authorize(tool, request.args, context.runId);
  }

  async authorize(tool: ToolDefinition | undefined, rawArgs: unknown, runId: string): Promise<PolicyDecision> {
    if (!tool) return { ok: true };
    if (this.deps.fullNative?.()) return { ok: true };
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    if (WRITE_TOOLS.has(tool.id)) {
      const path = await this.pendingPath(runId, args);
      if (path) {
        const bytes = typeof args.content === 'string' ? args.content.length : Array.isArray(args.ops) ? JSON.stringify(args.ops).length : 0;
        const mass = massChangeReason(this.files.changes.get(runId), { path, bytes, trash: tool.id === 'file.trash' }, this.limits);
        if (mass) return { ok: true, escalate: { risk: tool.id === 'file.trash' ? 'CRITICAL' : 'DESTRUCTIVE', reason: `Cambio masivo: ${mass}` } };
        if (isSecretFile(basename(path, this.f()))) return { ok: true, escalate: { risk: 'SENSITIVE', reason: `«${basename(path, this.f())}» es un archivo de secretos.` } };
      }
    }
    if (tool.id === 'terminal.execute' || tool.id === 'process.start') {
      let open: OpenProject;
      try { open = await this.projectFor(runId, args.project); } catch (e) { return { ok: false, reason: (e as Error).message }; }
      let cwd: string;
      try { cwd = await this.cwdFor(open, args.cwd); } catch (e) { return { ok: false, reason: (e as Error).message }; }
      const verdict = classifyCommand({ executable: String(args.executable ?? ''), args: (args.args ?? []) as string[], cwd, ...(args.envSubset ? { envSubset: args.envSubset as Record<string, string> } : {}) }, this.policyContext(open.project.rootPath));
      if (!verdict.allowed) return { ok: false, reason: verdict.reason };
      if (tool.id === 'terminal.execute' && verdict.longRunning) return { ok: false, reason: `${verdict.reason} Es un proceso de larga duración: usa process.start.` };
      if (verdict.risk === 'DESTRUCTIVE' || verdict.risk === 'CRITICAL') return { ok: true, escalate: { risk: verdict.risk, reason: verdict.reason } };
    }
    if (tool.id === 'git.commit') return { ok: true, escalate: { risk: 'SENSITIVE', reason: 'Un commit siempre se confirma explícitamente.' } };
    return { ok: true };
  }

  /* ---------------- UI support (not tools) ---------------- */

  readonly commandLog: CommandLogEntry[] = [];
  private commandListeners = new Set<(e: CommandLogEntry) => void>();
  onCommand(cb: (e: CommandLogEntry) => void): () => void { this.commandListeners.add(cb); return () => { this.commandListeners.delete(cb); }; }
  private emitCommand(e: CommandLogEntry) {
    this.commandListeners.forEach((l) => l(e));
  }

  /** The user's own save from the editor: atomic and conflict-checked, never in a ChangeSet. */
  async saveForUser(projectId: string, rel: string, content: string, expectedHash: string): Promise<{ hash: string }> {
    const open = await this.projects.open(projectId);
    const r = await this.files.write(rel, content, { runId: '__user__', base: open.project.rootPath, expectedHash, record: false });
    return { hash: r.hash };
  }

  async readForUser(projectId: string, rel: string) {
    const open = await this.projects.open(projectId);
    return this.files.read(rel, { runId: '__user__', base: open.project.rootPath });
  }

  /** Before (pre-JARVIS snapshot) and after (disk now) for one file of a run. */
  async diffOf(runId: string, path: string): Promise<{ before: string; after: string; diff: string } | null> {
    const set = this.files.changes.get(runId);
    const first = set?.changes.find((c) => c.path === path || c.toPath === path);
    if (!set || !first) return null;
    const snap = first.snapshotId ? await this.deps.snapshots.get(first.snapshotId) : null;
    const before = snap ? fromUtf8(snap) : '';
    const current = await this.deps.fs.readFile(first.toPath ?? path).catch(() => null);
    const after = current ? fromUtf8(current) : '';
    const rel = set.projectRoot ? relative(set.projectRoot, first.toPath ?? path, this.f()) : path;
    return { before, after, diff: patchResult(before, after, rel).diff };
  }

  async cancelRun(runId: string): Promise<void> {
    await this.terminal.cancelRun(runId);
    await this.managed.stopRun(runId);
  }

  async checksFor(open: OpenProject) {
    let scripts: Record<string, string> = {};
    try { scripts = (JSON.parse(fromUtf8(await this.deps.fs.readFile(resolve(open.project.rootPath, 'package.json', this.f())))) as { scripts?: Record<string, string> }).scripts ?? {}; } catch { /* none */ }
    const tools = await this.tools.discover();
    const has = (id: string) => tools.some((t) => t.id === id && t.available);
    return detectChecks(open.project, scripts, has);
  }

  /* ------------------------------------------------------------------ */

  adapters(): AdapterMap {
    type A = Record<string, unknown>;
    const base = async (runId: string, a: A) => this.deps.fullNative?.() && !a.project && typeof a.cwd === 'string' && isAbsolute(a.cwd, this.f())
      ? (await this.guard.check(a.cwd, { write: false })).path : (await this.projectFor(runId, a.project)).project.rootPath;
    const opts = async (runId: string, a: A) => ({ runId, base: await base(runId, a), ...(typeof a.expectedHash === 'string' ? { expectedHash: a.expectedHash } : {}) });

    return {
      'project.discover': async () => this.projects.discover(),
      'project.list': async () => this.projects.list().length ? this.projects.list() : this.projects.discover(),
      'project.inspect': async (a: A, ctx) => {
        const open = await this.projectFor(ctx.runId, a.project);
        const project = await this.projects.inspect(open.project.id);
        return { ...project, files: open.indexer.size, checks: (await this.checksFor(open)).map((c) => c.label) };
      },
      'project.open': async (a: A, ctx): Promise<DevProject> => (await this.projectFor(ctx.runId, a.project)).project,
      'project.checks': async (a: A, ctx) => this.checksFor(await this.projectFor(ctx.runId, a.project)),

      'code.search': async (a: A, ctx) => {
        const { search } = await this.projectFor(ctx.runId, a.project);
        const q = str(a.query, 'query');
        const [defs, text, files] = await Promise.all([
          /^[A-Za-z_$][\w$]*$/.test(q) ? search.findDefinition(q) : Promise.resolve([]),
          search.searchText(q, { limit: 30 }), Promise.resolve(search.searchFiles(q, 10)),
        ]);
        return [...defs, ...files, ...text].slice(0, 50);
      },
      'code.searchText': async (a: A, ctx) => (await this.projectFor(ctx.runId, a.project)).search.searchText(str(a.query, 'query'), { regex: a.regex === true, caseSensitive: a.caseSensitive === true, limit: Number(a.limit) || 50 }),
      'code.searchFiles': async (a: A, ctx) => (await this.projectFor(ctx.runId, a.project)).search.searchFiles(str(a.query, 'query')),
      'code.findReferences': async (a: A, ctx) => (await this.projectFor(ctx.runId, a.project)).search.findReferences(str(a.symbol, 'symbol')),
      'code.findDefinition': async (a: A, ctx) => (await this.projectFor(ctx.runId, a.project)).search.findDefinition(str(a.symbol, 'symbol')),
      'code.context': async (a: A, ctx) => {
        const open = await this.projectFor(ctx.runId, a.project);
        const recent = [...new Set((this.files.changes.get(ctx.runId)?.changes ?? []).map((c) => relative(open.project.rootPath, c.toPath ?? c.path, this.f())))];
        return new CodeContextBuilder(this.deps.fs, open.indexer, open.search).build({
          project: open.project, query: String(a.query ?? ''), failures: (a.failures ?? []) as VerificationFailure[], recent: [...recent, ...((a.recent ?? []) as string[])],
        });
      },

      'file.read': async (a: A, ctx) => this.files.read(str(a.path, 'path'), { runId: ctx.runId, base: await base(ctx.runId, a), ...(Number.isInteger(a.startLine) ? { startLine: a.startLine as number } : {}), ...(Number.isInteger(a.endLine) ? { endLine: a.endLine as number } : {}) }),
      'file.proposePatch': async (a: A, ctx) => {
        // ASSIST: compute the diff, write nothing.
        const r = await this.files.read(str(a.path, 'path'), { runId: ctx.runId, base: await base(ctx.runId, a) });
        if (r.content === null || r.secret || r.truncated) throw new Error('Sólo se pueden proponer parches sobre archivos de texto completos y no secretos.');
        return patchResult(r.content, applyOps(r.content, a.ops as PatchOp[]), r.relative);
      },
      'file.create': async (a: A, ctx) => this.files.create(str(a.path, 'path'), String(a.content ?? ''), await opts(ctx.runId, a)),
      'file.write': async (a: A, ctx) => this.files.write(str(a.path, 'path'), String(a.content ?? ''), await opts(ctx.runId, a)),
      'file.patch': async (a: A, ctx) => {
        if (!Array.isArray(a.ops)) throw new Error('Faltan las operaciones del parche.');
        return this.files.patch(str(a.path, 'path'), a.ops as PatchOp[], await opts(ctx.runId, a));
      },
      'file.rename': async (a: A, ctx) => this.files.move(str(a.path, 'path'), str(a.to, 'to'), await opts(ctx.runId, a), 'rename'),
      'file.move': async (a: A, ctx) => this.files.move(str(a.path, 'path'), str(a.to, 'to'), await opts(ctx.runId, a), 'move'),
      'file.copy': async (a: A, ctx) => this.files.copy(str(a.path, 'path'), str(a.to, 'to'), await opts(ctx.runId, a)),
      'directory.create': async (a: A, ctx) => this.files.mkdir(str(a.path, 'path'), await opts(ctx.runId, a)),
      'file.trash': async (a: A, ctx) => this.files.trash(str(a.path, 'path'), await opts(ctx.runId, a)),

      'terminal.execute': async (a: A, ctx) => {
        const root = await base(ctx.runId, a);
        const req: ProcessRequest = {
          executable: str(a.executable, 'executable'), args: (a.args ?? []) as string[], cwd: (await this.guard.check(typeof a.cwd === 'string' ? a.cwd : root, { write: false, base: root })).path,
          ...(a.envSubset ? { envSubset: a.envSubset as Record<string, string> } : {}), ...(Number(a.timeoutMs) > 0 ? { timeoutMs: Number(a.timeoutMs) } : {}),
        };
        // Defence in depth: the same classification the policy already made.
        const verdict = classifyCommand(req, this.policyContext(root));
        if (!verdict.allowed || verdict.longRunning) throw new Error(verdict.allowed ? 'Proceso de larga duración: usa process.start.' : verdict.reason);
        const label = this.deps.fullNative?.() ? `${req.executable}: ${req.args.length} argumentos privados` : safeContextText([req.executable, ...req.args].join(' '));
        const entry: CommandLogEntry = { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, runId: ctx.runId, label, cwd: req.cwd, status: 'running', startedAt: Date.now(), live: '' };
        this.commandLog.push(entry);
        if (this.commandLog.length > 200) this.commandLog.shift();
        this.emitCommand(entry);
        try {
          const result = await this.terminal.execute(req, { runId: ctx.runId, signal: ctx.signal, onOutput: (chunk) => { entry.live = (entry.live + chunk).slice(-8000); this.emitCommand(entry); } });
          Object.assign(entry, { status: result.cancelled ? 'cancelled' : result.exitCode === 0 ? 'passed' : 'failed', result });
          return result;
        } catch (error) {
          Object.assign(entry, { status: 'failed', error: (error as Error).message });
          throw error;
        } finally {
          this.emitCommand(entry);
        }
      },
      'terminal.output': async (a: A) => {
        const id = str(a.outputId, 'outputId');
        return typeof a.query === 'string' ? this.terminal.outputs.search(id, a.query) : (this.terminal.outputs.get(id) ?? '').slice(-65536);
      },
      'process.start': async (a: A, ctx) => {
        const root = await base(ctx.runId, a);
        const req: ProcessRequest = { executable: str(a.executable, 'executable'), args: (a.args ?? []) as string[], cwd: (await this.guard.check(typeof a.cwd === 'string' ? a.cwd : root, { write: false, base: root })).path };
        const verdict = classifyCommand(req, this.policyContext(root));
        if (!verdict.allowed) throw new Error(verdict.reason);
        return this.managed.start(req, { runId: ctx.runId, signal: ctx.signal });
      },
      'process.status': async (a: A) => (typeof a.id === 'string' ? this.managed.status(a.id) : this.managed.list()),
      'process.logs': async (a: A) => this.managed.logs(str(a.id, 'id'), Number(a.tail) || 200),
      'process.stop': async (a: A) => this.managed.stop(str(a.id, 'id')),
      'dev.tools': async () => this.tools.discover(),

      'git.status': async (a: A, ctx) => this.git.status((await this.projectFor(ctx.runId, a.project)).project.rootPath),
      'git.diff': async (a: A, ctx) => this.git.diff((await this.projectFor(ctx.runId, a.project)).project.rootPath, { ...(typeof a.path === 'string' ? { path: a.path } : {}), staged: a.staged === true }),
      'git.log': async (a: A, ctx) => this.git.log((await this.projectFor(ctx.runId, a.project)).project.rootPath, Number(a.limit) || 20),
      'git.branch': async (a: A, ctx) => this.git.branches((await this.projectFor(ctx.runId, a.project)).project.rootPath),
      'git.show': async (a: A, ctx) => this.git.show((await this.projectFor(ctx.runId, a.project)).project.rootPath, str(a.ref, 'ref'), typeof a.path === 'string' ? a.path : undefined),
      'git.add': async (a: A, ctx) => { await this.git.add((await this.projectFor(ctx.runId, a.project)).project.rootPath, a.paths as string[]); return { added: a.paths }; },
      'git.restore': async (a: A, ctx) => {
        const root = (await this.projectFor(ctx.runId, a.project)).project.rootPath;
        if (a.staged === true) { await this.git.unstage(root, a.paths as string[]); return { unstaged: a.paths }; }
        await this.git.restoreFiles(root, a.paths as string[], this.baselines.get(ctx.runId) ?? await this.git.dirtyPaths(root));
        return { restored: a.paths };
      },
      'git.checkoutFile': async (a: A, ctx) => {
        const root = (await this.projectFor(ctx.runId, a.project)).project.rootPath;
        await this.git.restoreFiles(root, [str(a.path, 'path')], this.baselines.get(ctx.runId) ?? await this.git.dirtyPaths(root));
        return { restored: [a.path] };
      },
      'git.commit': async (a: A, ctx) => ({ commit: await this.git.commit((await this.projectFor(ctx.runId, a.project)).project.rootPath, str(a.message, 'message')) }),

      'changes.review': async (a: A, ctx) => {
        const runId = typeof a.runId === 'string' ? a.runId : ctx.runId;
        const set = this.files.changes.get(runId);
        const summary = this.files.changes.summary(runId);
        let attribution = null;
        if (set?.projectRoot) {
          const root = set.projectRoot;
          const now = await this.git.dirtyPaths(root).catch(() => [] as string[]);
          attribution = attributeChanges({ baseline: set.preExisting, now, jarvis: (summary?.files ?? []).map((f) => relative(root, f.toPath ?? f.path, this.f())) });
        }
        return { summary, attribution, changes: set?.changes.length ?? 0 };
      },
      'changes.revert': async (a: A, ctx) => this.files.revertRun(typeof a.runId === 'string' ? a.runId : ctx.runId),
      'changes.undoLast': async () => this.files.undoLast(),
    };
  }
}
