import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PatchOp } from '../types';
import type { ProcessPort, SpawnRequest, SpawnedProcess } from '../dev/ports';
import type { GitService } from '../dev/GitService';
import { TerminalService } from '../dev/TerminalService';
import { applyOps } from '../dev/patch';
import { AgentCapsuleWorkspace, capsulePath, containsSecret, hashBytes, safeRelative,
  type CapsuleFile, type CapsuleManifest } from '../intelligence/capsule/AgentCapsuleWorkspace';
import { AgentCapsuleDiffService, type CapsuleDiff } from '../intelligence/capsule/AgentCapsuleDiffService';
import type { AgentCapsuleImportGate } from '../intelligence/capsule/AgentCapsuleImportGate';
import type { ExecutionLedger, ScratchLedgerEntry } from './ExecutionLedger';
import type { ProjectTrustService } from './ProjectTrustService';

export interface ScratchSession {
  id: string; runId: string; sourceProject: string; root: string; projectDir: string;
  baseHash: string; excluded: Array<{ path: string; reason: string }>;
  environmentNames: string[]; createdAt: number; gitCloneNoHardlinks: boolean;
}
export interface ScratchCommandResult {
  script: string; literal: string; exitCode: number | null; timedOut: boolean; cancelled: boolean;
  durationMs: number; status: 'SCRATCH_TEST_PASS' | 'SCRATCH_TEST_FAIL' | 'SCRATCH_COMMAND_PASS' | 'SCRATCH_COMMAND_FAIL' | 'TIMEOUT' | 'CANCELLED';
}
interface InternalScratch { session: ScratchSession; manifest: CapsuleManifest; terminal: TerminalService; env: Record<string, string> }
export const ALLOWED_SCRIPTS = new Set(['test', 'build', 'lint', 'typecheck']);
const CLEAN_OUTPUT_DIRS = ['node_modules', 'dist', 'build', 'coverage', '.vite'];

function inOwnedTree(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
function removeOwnedChild(root: string, target: string): void {
  if (!fs.existsSync(target)) return;
  const base = fs.realpathSync(root), real = fs.realpathSync(target);
  if (!inOwnedTree(base, real)) throw new Error('SCRATCH_CLEANUP_ESCAPES_OWNED_ROOT');
  fs.rmSync(target, { recursive: true, force: true });
}
export function removeOwnedTemp(root: string, prefix: string): void {
  if (!fs.existsSync(root)) return;
  const temp = fs.realpathSync(os.tmpdir()), real = fs.realpathSync(root);
  if (path.dirname(real).toLowerCase() !== temp.toLowerCase() || !path.basename(real).startsWith(prefix)) {
    throw new Error('SCRATCH_TEMP_TARGET_UNVERIFIED');
  }
  fs.rmSync(root, { recursive: true, force: true });
}
function envValue(host: NodeJS.ProcessEnv, name: string): string | null {
  const key = Object.keys(host).find(item => item.toLowerCase() === name.toLowerCase());
  return key ? host[key] ?? null : null;
}
export function scratchEnvironment(host: NodeJS.ProcessEnv, root: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'SystemRoot', 'windir', 'ComSpec', 'PATHEXT']) {
    const value = envValue(host, name); if (value) env[name === 'ComSpec' ? 'COMSPEC' : name] = value;
  }
  env.TEMP = path.join(root, 'tmp'); env.TMP = env.TEMP;
  env.USERPROFILE = path.join(root, 'profile');
  env.APPDATA = path.join(root, 'profile', 'AppData', 'Roaming');
  env.LOCALAPPDATA = path.join(root, 'profile', 'AppData', 'Local');
  env.NPM_CONFIG_USERCONFIG = path.join(root, 'meta', 'empty.npmrc');
  env.NPM_CONFIG_GLOBALCONFIG = path.join(root, 'meta', 'empty-global.npmrc');
  env.NPM_CONFIG_CACHE = path.join(root, 'meta', 'npm-cache');
  env.NPM_CONFIG_REGISTRY = 'https://registry.npmjs.org/';
  env.GIT_TERMINAL_PROMPT = '0'; env.GIT_OPTIONAL_LOCKS = '0';
  return env;
}
export class ScratchProcessPort implements ProcessPort {
  readonly platform: ProcessPort['platform'];
  constructor(private readonly inner: ProcessPort, private readonly env: Record<string, string>) { this.platform = inner.platform; }
  which(executable: string): Promise<string | null> { return this.inner.which(executable); }
  baseEnv(): Record<string, string> { return { ...this.env }; }
  spawn(req: SpawnRequest): SpawnedProcess { return this.inner.spawn({ ...req, env: { ...this.env } }); }
}

/** A scratch copy does not isolate host scripts. Only an explicitly trusted project may reach this service. */
export class TrustedScratchService {
  private sessions = new Map<string, InternalScratch>();
  constructor(private readonly trust: ProjectTrustService, private readonly git: GitService,
    private readonly processPort: ProcessPort, private readonly ledger: ExecutionLedger,
    private readonly maxDurationMs = 120_000) {
    if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1_000 || maxDurationMs > 600_000) throw new Error('SCRATCH_DURATION_INVALID');
  }
  private event(session: ScratchSession, event: ScratchLedgerEntry['event'], detail: ScratchLedgerEntry['detail']): void {
    this.ledger.scratch({ id: randomUUID(), runId: session.runId, scratchId: session.id, at: Date.now(), event, detail });
  }
  private current(id: string): InternalScratch {
    const state = this.sessions.get(id); if (!state) throw new Error('SCRATCH_SESSION_NOT_FOUND'); return state;
  }
  private async requireTrusted(project: string): Promise<void> {
    if ((await this.trust.status(project)).state !== 'TRUSTED') throw new Error('SCRATCH_PROJECT_NOT_TRUSTED');
  }
  /** Normal call pattern: cleanup runs after success, failure or STOP. */
  async withScratch<T>(input: { project: string; runId: string; conversationId: string },
    action: (session: ScratchSession) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const session = await this.create(input);
    try { return await action(session); }
    finally { if (this.sessions.has(session.id)) await this.close(session.id, signal?.aborted ?? false); }
  }
  private async sourceManifest(project: string, runId: string, conversationId: string, gitProject: boolean): Promise<CapsuleManifest> {
    const original = new AgentCapsuleWorkspace().create({ project, runId, conversationId, provider: 'EF2A', agent: 'TRUSTED_SCRATCH' });
    try {
      const allowed = gitProject ? new Set(await this.git.snapshotPaths(project)) : null;
      const files: Record<string, CapsuleFile> = {};
      const excluded = [...original.excluded];
      for (const [relative, value] of Object.entries(original.files)) {
        if (!allowed || allowed.has(relative)) files[relative] = value;
        else excluded.push({ path: relative, reason: 'GIT_IGNORED_EXCLUDED' });
      }
      const sourceStateHash = hashBytes(Buffer.from(JSON.stringify(Object.entries(files).sort())));
      return { ...original, files, excluded, sourceStateHash };
    } finally { removeOwnedTemp(original.workspace, 'jarvis-capsule-'); }
  }
  async create(input: { project: string; runId: string; conversationId: string }): Promise<ScratchSession> {
    const trust = await this.trust.status(input.project);
    if (trust.state !== 'TRUSTED') throw new Error('SCRATCH_PROJECT_NOT_TRUSTED');
    const sourceProject = trust.canonicalRoot;
    const gitProject = trust.projectIdentity?.startsWith('git:') === true;
    if (gitProject) {
      const top = await this.git.topLevel(sourceProject);
      if (!top || fs.realpathSync(top).toLowerCase() !== sourceProject.toLowerCase()) throw new Error('SCRATCH_GIT_ROOT_REQUIRED');
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-scratch-'));
    const projectDir = path.join(root, 'project');
    const env = scratchEnvironment(process.env, root);
    for (const dir of ['meta', 'tmp', 'profile', 'profile/AppData/Roaming', 'profile/AppData/Local']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(env.NPM_CONFIG_USERCONFIG!, '', { flag: 'wx' });
    fs.writeFileSync(env.NPM_CONFIG_GLOBALCONFIG!, '', { flag: 'wx' });
    const terminal = new TerminalService(new ScratchProcessPort(this.processPort, env));
    let original: CapsuleManifest | null = null;
    try {
      if (gitProject) {
        const clone = await terminal.execute({ executable: 'git', args: ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=',
          'clone', '--no-hardlinks', '--no-checkout', '--', sourceProject, projectDir], cwd: root, timeoutMs: this.maxDurationMs });
        if (clone.exitCode !== 0 || clone.timedOut) throw new Error(`SCRATCH_CLONE_FAILED:${clone.exitCode}:${clone.stderr.slice(0, 300)}`);
        removeOwnedChild(root, path.join(projectDir, '.git'));
      } else fs.mkdirSync(projectDir);
      original = new AgentCapsuleWorkspace().create({ project: sourceProject, runId: input.runId,
        conversationId: input.conversationId, provider: 'EF2A', agent: 'TRUSTED_SCRATCH' });
      const allowed = gitProject ? new Set(await this.git.snapshotPaths(sourceProject)) : null;
      const files: Record<string, CapsuleFile> = {}; const excluded = [...original.excluded];
      for (const [relative, value] of Object.entries(original.files)) {
        if (allowed && !allowed.has(relative)) { excluded.push({ path: relative, reason: 'GIT_IGNORED_EXCLUDED' }); continue; }
        files[relative] = value;
        const target = capsulePath(projectDir, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(capsulePath(original.workspace, relative), target, fs.constants.COPYFILE_EXCL);
      }
      const baseHash = hashBytes(Buffer.from(JSON.stringify(Object.entries(files).sort())));
      const manifest: CapsuleManifest = { ...original, workspace: projectDir, files, excluded, sourceStateHash: baseHash };
      const session: ScratchSession = { id: randomUUID(), runId: input.runId, sourceProject, root, projectDir,
        baseHash, excluded, environmentNames: Object.keys(env).sort(), createdAt: Date.now(), gitCloneNoHardlinks: gitProject };
      this.sessions.set(session.id, { session, manifest, terminal, env });
      this.event(session, 'CREATED', { baseHash, gitCloneNoHardlinks: gitProject, excludedPaths: excluded.map(item => item.path),
        environmentNames: session.environmentNames });
      return session;
    } catch (error) { removeOwnedTemp(root, 'jarvis-scratch-'); throw error; }
    finally { if (original) removeOwnedTemp(original.workspace, 'jarvis-capsule-'); }
  }
  async applyPatch(id: string, relative: string, ops: PatchOp[]): Promise<void> {
    const state = this.current(id); await this.requireTrusted(state.session.sourceProject);
    if (!safeRelative(relative)) throw new Error('SCRATCH_PATH_DENIED');
    const target = capsulePath(state.session.projectDir, relative);
    const before = fs.readFileSync(target, 'utf8'); const after = applyOps(before, ops);
    if (containsSecret(Buffer.from(after))) throw new Error('SCRATCH_SECRET_OUTPUT');
    fs.writeFileSync(target, after, 'utf8');
    this.event(state.session, 'PATCH_APPLIED', { path: relative, beforeHash: hashBytes(Buffer.from(before)), afterHash: hashBytes(Buffer.from(after)) });
  }
  private assertLockfile(projectDir: string): void {
    const file = path.join(projectDir, 'package-lock.json');
    if (!fs.existsSync(file)) throw new Error('SCRATCH_PACKAGE_LOCK_REQUIRED');
    const lock = JSON.parse(fs.readFileSync(file, 'utf8')) as { packages?: Record<string, { resolved?: string }> };
    for (const value of Object.values(lock.packages ?? {})) {
      const resolved = value.resolved;
      if (!resolved) continue;
      try { if (new URL(resolved).hostname !== 'registry.npmjs.org') throw new Error('PRIVATE'); }
      catch { throw new Error('SCRATCH_PRIVATE_REGISTRY_REQUIRES_PROXY'); }
    }
  }
  async npmCi(id: string, signal?: AbortSignal): Promise<ScratchCommandResult> {
    const state = this.current(id); await this.requireTrusted(state.session.sourceProject);
    this.assertLockfile(state.session.projectDir);
    return this.command(state, 'ci', 'npm ci', ['ci', '--no-audit', '--no-fund'], signal);
  }
  async runScript(id: string, script: string, signal?: AbortSignal): Promise<ScratchCommandResult> {
    const state = this.current(id); await this.requireTrusted(state.session.sourceProject);
    if (!ALLOWED_SCRIPTS.has(script)) throw new Error('SCRATCH_SCRIPT_NOT_ALLOWLISTED');
    const pkg = JSON.parse(fs.readFileSync(path.join(state.session.projectDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const literal = pkg.scripts?.[script];
    if (!literal || containsSecret(Buffer.from(literal))) throw new Error('SCRATCH_SCRIPT_UNAVAILABLE_OR_SECRET');
    return this.command(state, script, literal, ['run', script], signal);
  }
  private async command(state: InternalScratch, script: string, literal: string, args: string[], signal?: AbortSignal): Promise<ScratchCommandResult> {
    this.event(state.session, 'COMMAND', { command: `npm ${args.join(' ')}`, literalScript: literal, environmentNames: Object.keys(state.env).sort() });
    const r = await state.terminal.execute({ executable: 'npm', args, cwd: state.session.projectDir,
      timeoutMs: this.maxDurationMs }, { runId: state.session.runId, ...(signal ? { signal } : {}) });
    const status = r.cancelled ? 'CANCELLED' : r.timedOut ? 'TIMEOUT' : r.exitCode === 0
      ? script === 'test' ? 'SCRATCH_TEST_PASS' : 'SCRATCH_COMMAND_PASS'
      : script === 'test' ? 'SCRATCH_TEST_FAIL' : 'SCRATCH_COMMAND_FAIL';
    const result: ScratchCommandResult = { script, literal, exitCode: r.exitCode, timedOut: r.timedOut,
      cancelled: r.cancelled, durationMs: r.durationMs, status };
    this.event(state.session, 'TEST_RESULT', { script, status, exitCode: r.exitCode, timedOut: r.timedOut, cancelled: r.cancelled, durationMs: r.durationMs });
    return result;
  }
  private clearOutputs(state: InternalScratch): void {
    for (const name of CLEAN_OUTPUT_DIRS) removeOwnedChild(state.session.root, path.join(state.session.projectDir, name));
  }
  async diff(id: string): Promise<CapsuleDiff> {
    const state = this.current(id); this.clearOutputs(state);
    const diff = new AgentCapsuleDiffService().diff(state.manifest);
    this.event(state.session, 'DIFF', { changedPaths: diff.changes.map(change => change.path) });
    return diff;
  }
  private async currentBaseHash(state: InternalScratch): Promise<string> {
    const current = await this.sourceManifest(state.session.sourceProject, state.session.runId,
      state.manifest.conversationId, state.session.gitCloneNoHardlinks);
    return current.sourceStateHash;
  }
  async import(id: string, gate: AgentCapsuleImportGate, accepted: boolean): Promise<{ runId: string; applied: number }> {
    const state = this.current(id); await this.requireTrusted(state.session.sourceProject);
    if ((await this.currentBaseHash(state)) !== state.session.baseHash) {
      this.event(state.session, 'CONFLICT', { reason: 'PROJECT_BASE_CHANGED' }); throw new Error('CONFLICT:PROJECT_BASE_CHANGED');
    }
    const diff = await this.diff(id);
    const preflight = await gate.preflight(state.manifest, diff);
    if (!preflight.ok) { this.event(state.session, 'CONFLICT', { reason: 'IMPORT_GATE_REJECTED', conflicts: preflight.conflicts,
      rejected: preflight.rejected }); throw new Error(`CONFLICT:IMPORT_GATE:${[...preflight.conflicts, ...preflight.rejected].join(',')}`); }
    const applied = await gate.apply(state.manifest, diff, accepted);
    this.event(state.session, 'IMPORT', { accepted, applied: applied.applied });
    return applied;
  }
  async close(id: string, stopped = false): Promise<void> {
    const state = this.current(id);
    const killed = await state.terminal.cancelRun(state.session.runId);
    const until = Date.now() + 2_000;
    while (state.terminal.runningCount(state.session.runId) !== 0 && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (state.terminal.runningCount(state.session.runId) !== 0) throw new Error('SCRATCH_PROCESS_ORPHAN_REMAINS');
    if (stopped) this.event(state.session, 'STOPPED', { killedProcesses: killed });
    removeOwnedTemp(state.session.root, 'jarvis-scratch-');
    if (fs.existsSync(state.session.root)) throw new Error('SCRATCH_CLEANUP_FAILED');
    this.event(state.session, 'CLEANED', { removed: true });
    this.sessions.delete(id);
  }
  async stop(id: string): Promise<void> { await this.close(id, true); }
}
