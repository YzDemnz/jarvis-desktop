import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IPC } from '../ipc';
import { DevService } from '../../src/dev/DevService';
import type { ConfigPort, ProjectConfig } from '../../src/dev/ProjectService';
import { defaultProtectedPaths } from '../../src/dev/PathGuard';
import { NodeFsPort, NodeProcessPort, DiskSnapshotPort, NodeWatchPort } from './nodePorts';
import { ElectronTrashPort } from './ElectronTrashPort';
import { toolRegistry } from '../../src/agent/registry';
import { ModelPatchProposer } from '../../src/dev/coding';
import type { ProposalInput } from '../../src/dev/coding';
import { selectLocalInference } from '../machine/localInference';
import { PermissionEngine } from '../../src/agent/permissions';
import type { TaskEvidence } from '../../src/fabric/types';
import { safeContextText } from '../../src/fabric/ContinuityState';
import { authority, authorityHandle, effectivePermission, assertAuthoritySender, onAuthorityStop } from '../authority';
import { FullNativeBackend } from '../../src/execution/backends/FullNativeBackend';
import { ExecutionRouter } from '../../src/execution/ExecutionRouter';
import { authorityExecutionPolicy } from '../../src/execution/ExecutionPolicy';
import { withProcessScope, cancelOwnedRun, stopOwnedProcesses, assertProcessScope } from '../process/WindowsJobProcess';
import { ProjectSymbols } from './ProjectSymbols';
import {ProjectIndexer} from '../../src/dev/ProjectIndexer';
import {ProjectCheckEvidence} from './ProjectCheckEvidence';
import {fabricDatabase} from '../fabric/ipcFabric';
import {bootstrapPatch} from '../bootstrap/ipcBootstrap';
import {createHash} from 'node:crypto';
import {readProposalContext, proposalContextMetadata, bindProposalToContext} from './ProposalContextSource';

const permissions = new PermissionEngine();

class JsonConfigPort implements ConfigPort {
  constructor(private readonly file: string) {}
  async load(): Promise<ProjectConfig | null> {
    try { return JSON.parse(await fsp.readFile(this.file, 'utf8')) as ProjectConfig; } catch { return null; }
  }
  async save(c: ProjectConfig): Promise<void> {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(c, null, 2));
    await fsp.rename(tmp, this.file);
  }
}

let current: DevService | null = null;
let checkEvidence: ProjectCheckEvidence | null = null;

/** Receipts from services JARVIS actually ran, not assertions supplied by a model. */
export function devRunEvidence(runId: string): TaskEvidence[] {
  if (!current) return [];
  const commands: TaskEvidence[] = current.commandLog.filter(e => e.runId === runId).map(e => ({
    id: e.id, kind: 'command', source: 'MAIN_PROCESS', status: e.status,
    // Do not persist a command line: arguments can contain opaque credentials.
    summary: `Comando administrado: exit=${e.result?.exitCode ?? 'UNKNOWN'}, cancelled=${e.result?.cancelled ?? false}, timedOut=${e.result?.timedOut ?? false}`,
    at: e.startedAt,
  }));
  const changes: TaskEvidence[] = (current.files.changes.get(runId)?.changes ?? []).map((change, index) => ({
    id: `${runId}:change:${index}`, kind: 'artifact', source: 'MAIN_PROCESS',
    status: change.undone ? 'REVERTED' : 'RECORDED_AT_WRITE', summary: safeContextText(change.toPath ?? change.path),
    contentHash: change.hashAfter, at: change.at,
  }));
  const proof = checkEvidence?.read(runId);
  const checked: TaskEvidence[] = proof ? [{id: proof.operationId, source: 'MAIN_PROCESS', kind: 'step',
    status: proof.state === 'VERIFIED' ? 'HISTORICAL_VERIFIED' : proof.state, at: proof.updatedAt,
    contentHash: proof.subjectHash ?? undefined, summary: safeContextText(`Project checks ${proof.state}; ${proof.reason}; ${proof.scope}`)}] : [];
  return [...commands, ...changes, ...checked].slice(-200);
}

/**
 * Hosts the developer agent in main. Each tool has its own channel; every call
 * is re-checked here (permission level + dev policy veto) before its adapter
 * runs, whatever the renderer decided. Paths are canonicalised against the real
 * disk by PathGuard inside the services.
 */
export function registerDevIpc(win: BrowserWindow): DevService {
  const send = (channel: string, payload: unknown) => { if (!win.isDestroyed()) win.webContents.send(channel, payload); };
  const userData = app.getPath('userData');
  const flavor = process.platform === 'win32' ? 'win32' : 'posix';
  const projectFs = new NodeFsPort();
  const dev = new DevService({
    fs: projectFs,
    trash: new ElectronTrashPort(),
    snapshots: new DiskSnapshotPort(path.join(userData, 'jarvis-snapshots')),
    processes: new NodeProcessPort(),
    watch: new NodeWatchPort(),
    config: new JsonConfigPort(path.join(userData, 'dev-projects.json')),
    protectedPaths: [...defaultProtectedPaths(flavor, process.env), userData],
    installDir: app.isPackaged ? path.dirname(app.getPath('exe')) : null,
    home: os.homedir(),
    fullNative: () => effectivePermission() === 'FULL',
    assertMutation: () => { assertProcessScope(); if (effectivePermission() !== 'FULL') throw Error('RESTRICTED_WRITE_DENIED'); },
    controlPaths: [path.join(userData, 'authority'), ...(app.isPackaged ? [path.dirname(app.getPath('exe'))] : [])],
    allowCommit: true,
  });
  current = dev;
  void dev.init();
  dev.onCommand((entry) => send(IPC.dev.commandEvent, entry));
  dev.managed.onChange(() => send(IPC.dev.processEvent, null));

  const adapters = new ProjectSymbols(dev, projectFs).adapters(dev.adapters());
  checkEvidence = new ProjectCheckEvidence(fabricDatabase, async root => {
    const index = new ProjectIndexer(projectFs, root); await index.build();
    if (index.truncated || index.size > 2000) throw Error('CHECK_SNAPSHOT_LIMIT');
    const files: {path: string; hash: string}[] = []; let bytes = 0;
    for (const entry of index.list().sort((a,b) => a.relativePath.localeCompare(b.relativePath))) {
      if (entry.secret || entry.binary) continue;
      bytes += entry.size; if (bytes > 8 * 1024 ** 2) throw Error('CHECK_SNAPSHOT_LIMIT');
      const canonical = await dev.guard.check(path.join(root, entry.relativePath), {write: false, base: root});
      if (path.relative(root, canonical.path).startsWith('..')) throw Error('CHECK_PATH_ESCAPE');
      const contents = await projectFs.readFile(canonical.path);
      files.push({path: entry.relativePath, hash: createHash('sha256').update(contents).digest('hex')});
    }
    return {root, files};
  });
  const originalChecks = adapters['project.checks']!, originalTerminal = adapters['terminal.execute']!;
  adapters['project.checks'] = async (args, ctx) => {
    const checks = await originalChecks(args, ctx) as import('../../src/types').VerificationCheck[];
    const open = await dev.projectFor(ctx.runId, (args as Record<string, unknown>).project);
    return checkEvidence!.seal(ctx.runId, open.project.rootPath, checks, authority.revision(), () => authority.gate(ctx.runId));
  };
  adapters['terminal.execute'] = (args, ctx) => checkEvidence!.observe(ctx.runId, args as Record<string, unknown>,
    async () => originalTerminal(args, ctx), () => { authority.gate(ctx.runId); ctx.signal.throwIfAborted(); });
  adapters['project.verify'] = (_args, ctx) => checkEvidence!.verify(ctx.runId, () => { authority.gate(ctx.runId); ctx.signal.throwIfAborted(); });
  const running = new Map<string, AbortController[]>();
  const native = new FullNativeBackend({ invoke: async (toolId, args, rid) => {
    authority.gate(rid);
    if (effectivePermission() !== 'FULL') throw new Error('RESTRICTED_NATIVE_DENIED');
    const verdict = permissions.check(toolRegistry.get(toolId), effectivePermission());
    if (!verdict.allowed) throw new Error(verdict.reason);
    const adapter = adapters[toolId];
    if (!adapter) throw new Error('NATIVE_TOOL_UNAVAILABLE');
    const controller = new AbortController(); running.set(rid, [...(running.get(rid) ?? []), controller]);
    try { return await withProcessScope(rid, controller.signal, () => adapter(args as never, { runId: rid, signal: controller.signal, token: { cancelled: false, throwIfCancelled() {} } } as never), () => { authority.gate(rid); if (effectivePermission() !== 'FULL') throw Error('AUTHORITY_CHANGED'); }); }
    finally { running.set(rid, (running.get(rid) ?? []).filter(c => c !== controller)); }
  }, cancel: async rid => { authority.stop(rid); (running.get(rid) ?? []).forEach(c => c.abort()); await dev.cancelRun(rid); } });
  const executeNative = async (runId: string, toolId: string, args: Record<string, unknown>) => {
    const request: import('../../src/execution/types').ExecutionRequest = { runId, conversationId: runId, task: 'SYSTEM_CONTROL', prompt: '', providerId: null, agentId: null, projectRoot: null, requiredTrust: null, requireShell: true, allowProposalFallback: false, brokeredCalls: [{ toolId, args }] };
    const session = await native.createSession(request);
    const route = new ExecutionRouter().route(request, authorityExecutionPolicy(effectivePermission(), authority.run(runId)?.strongRequired), [await native.probe()]);
    if (route.selected !== native.id) return { ok: false, realm: 'NONE', error: route.reason, evidence: devRunEvidence(runId), route };
    try { const result = await native.execute(session, request); return { ok: true, realm: native.realm, status: result.status, data: result.toolResults?.[0], audit: result.audit, evidence: devRunEvidence(runId) }; }
    catch (error) { return { ok: false, realm: native.realm, error: String(error), evidence: devRunEvidence(runId) }; }
  };
  authorityHandle('authority:execute', (_event, ...args) => executeNative(...args as [string, string, Record<string, unknown>]));
  onAuthorityStop(async rid => { (running.get(rid) ?? []).forEach(c => c.abort()); checkEvidence?.interrupt(rid); await Promise.all([dev.cancelRun(rid), cancelOwnedRun(rid)]); });
  for (const [toolId, channel] of Object.entries(IPC.devTools)) {
    ipcMain.handle(channel, async (_e, _sessionLevel: unknown, runId: unknown, args: unknown) => {
      const tool = toolRegistry.get(toolId);
      assertAuthoritySender(_e);
      const verdict = permissions.check(tool, effectivePermission());
      if (!tool || !verdict.allowed) return { ok: false, reason: 'permission_denied', error: verdict.allowed ? 'Herramienta desconocida.' : verdict.reason };
      const rid = typeof runId === 'string' ? runId : '';
      try { authority.gate(rid); } catch (error) { return { ok: false, reason: 'authority_denied', error: String(error) }; }
      const decision = await dev.authorize(tool, args, rid);
      if (!decision.ok) return { ok: false, reason: 'policy_blocked', error: decision.reason };
      try { authority.gate(rid); if (!permissions.check(tool, effectivePermission()).allowed) throw Error('AUTHORITY_CHANGED'); }
      catch (error) { return { ok: false, reason: 'authority_denied', error: String(error) }; }
      const adapter = adapters[toolId as keyof typeof adapters] as ((a: unknown, c: unknown) => Promise<unknown>) | undefined;
      if (!adapter) return { ok: false, reason: 'not_implemented', error: 'Sin implementación.' };
      if (effectivePermission() === 'FULL') return executeNative(rid, toolId, (args ?? {}) as Record<string, unknown>);
      const controller = new AbortController();
      running.set(rid, [...(running.get(rid) ?? []), controller]);
      try {
        return { ok: true, data: await withProcessScope(rid, controller.signal, () => adapter(args, { runId: rid, signal: controller.signal, token: { cancelled: false, throwIfCancelled() {} } }), () => authority.gate(rid)) };
      } catch (error) {
        return { ok: false, reason: 'adapter_error', error: error instanceof Error ? error.message : String(error) };
      } finally {
        running.set(rid, (running.get(rid) ?? []).filter((c) => c !== controller));
      }
    });
  }
  const h = (channel: string, fn: (...a: never[]) => unknown) => authorityHandle(channel, (_e, ...a) => (fn as (...x: unknown[]) => unknown)(...a));
  h(IPC.dev.authorize, async (toolId: string, runId: string, args: unknown) => dev.authorize(toolRegistry.get(toolId), args, runId));
  h(IPC.dev.cancelRun, async (runId: string) => { authority.stop(runId); (running.get(runId) ?? []).forEach((c) => c.abort()); await dev.cancelRun(runId); });
  h(IPC.dev.roots, async () => dev.projects.roots());
  h(IPC.dev.addRoot, async (p: string) => dev.projects.addRoot(p));
  h(IPC.dev.removeRoot, async (p: string) => dev.projects.removeRoot(p));
  h(IPC.dev.discover, async () => dev.projects.discover());
  h(IPC.dev.openProject, async (id: string) => { const o = await dev.focus(id); return { project: o.project, files: o.indexer.list() }; });
  h(IPC.dev.readFile, async (id: string, rel: string) => dev.readForUser(id, rel));
  const requireFull = () => { if (effectivePermission() !== 'FULL') throw new Error('RESTRICTED_WRITE_DENIED'); };
  const userMutation = <T>(fn: () => T): T => {
    requireFull(); const revision = authority.revision();
    return withProcessScope('__user__', undefined, fn, () => { requireFull(); if (authority.revision() !== revision) throw Error('AUTHORITY_CHANGED'); });
  };
  h(IPC.dev.saveFile, async (id: string, rel: string, content: string, hash: string) => userMutation(() => dev.saveForUser(id, rel, content, hash)));
  h(IPC.dev.changeSets, async () => dev.files.changes.list().map((s) => dev.files.changes.summary(s.runId)).filter(Boolean));
  h(IPC.dev.fileDiff, async (runId: string, p: string) => dev.diffOf(runId, p));
  h(IPC.dev.revertRun, async (runId: string) => userMutation(() => dev.files.revertRun(runId)));
  h(IPC.dev.undoLast, async () => userMutation(() => dev.files.undoLast()));
  h(IPC.dev.revertFile, async (runId: string, p: string) => userMutation(() => dev.files.revertFile(runId, p)));
  h(IPC.dev.outputSearch, async (id: string, q: string) => dev.terminal.outputs.search(id, q));
  h(IPC.dev.processes, async () => dev.managed.list());
  h(IPC.dev.processLogs, async (id: string) => dev.managed.logs(id));
  // The user may stop any process JARVIS started; there is no way to reach others.
  h(IPC.dev.stopProcess, async (id: string) => { await dev.managed.stop(id); });
  h(IPC.dev.commands, async () => dev.commandLog);
  h(IPC.dev.checkEvidence, async (id: string) => checkEvidence?.verify(id, () => {}) ?? null);
  // Patch proposals come from the selected LOCAL runtime only (no cloud accounts yet).
  h(IPC.dev.propose, async (input: ProposalInput, id: string) => {
    authority.gate(id); const epoch = authority.revision(), controller = new AbortController();
    const started = Date.now(); let identity: {providerId: string; model: string | null} | null = null;
    let inputHash: string | null = null;
    const metrics: Record<string, unknown> = {policy: 'public-source-first-4096', receivedFiles: [], selectedFiles: [], omittedFiles: []};
    const attempt = Number.isSafeInteger(input?.attempt) && input.attempt > 0 && input.attempt <= 10 ? input.attempt : 0;
    const record = (status: string, errorCode: string | null = null) => {
      metrics.durationMs = Date.now() - started;
      fabricDatabase().writeOperationRecord(`proposal:${id}:${attempt}`, id, {kind: 'LOCAL_PATCH_PROPOSAL', taskId: id,
        operationId: `proposal:${id}:${attempt}`, status, identity, inputHash, metrics, errorCode,
        at: Date.now(), tools: 'NONE', correctness: 'NOT_VERIFIED'});
    };
    running.set(id, [...(running.get(id) ?? []), controller]);
    const guard = () => { authority.gate(id); controller.signal.throwIfAborted(); if (epoch !== authority.revision()) throw Error('PROPOSAL_REVOKED'); };
    try {
      if (!input || !attempt || typeof input.goal !== 'string' || !Array.isArray(input.context?.files) || input.context.files.length > 64 || !Array.isArray(input.failures)
        || input.context.files.some(f => !f || typeof f.path !== 'string' || typeof f.content !== 'string')) throw Error('INVALID_PROPOSAL_INPUT');
      metrics.receivedFiles = input.context.files.map(f => ({path: safeContextText(f.path).slice(0, 500), chars: f.content.length, truncated: f.truncated}));
      if (!Array.isArray(input.context.errors)) throw Error('INVALID_PROPOSAL_INPUT');
      const open = await dev.projectFor(id); guard();
      if (open.indexer.truncated || open.indexer.size > 2000) throw Error('PROPOSAL_INDEX_LIMIT');
      const loaded = await readProposalContext(input, {entries: open.indexer.list(), assert: guard, read: async rel => {
        guard(); const allowed = await dev.guard.check(rel, {write: false, base: open.project.rootPath});
        if (allowed.secret || path.relative(open.project.rootPath, allowed.path).startsWith('..')) throw Error('PUBLIC_CONTEXT_PATH_DENIED');
        const handle = await fsp.open(allowed.path, 'r');
        try {
          if ((await handle.stat()).size > 128 * 1024) throw Error('PUBLIC_CONTEXT_FILE_TOO_LARGE');
          const buffer = Buffer.alloc(128 * 1024 + 1); let length = 0;
          while (length < buffer.length) { guard(); const r = await handle.read(buffer, length, buffer.length - length, length);
            if (!r.bytesRead) break; length += r.bytesRead; }
          guard(); return buffer.subarray(0, length);
        } finally { await handle.close(); }
      }});
      const selection = loaded.selected;
      const bounded: ProposalInput = {...input, goal: safeContextText(input.goal).slice(0, 800),
        context: {...input.context, proposalText: selection.text, files: selection.files.map(f => ({path: f.path,
          reason: f.reason, content: f.content, truncated: !f.complete}))},
        failures: input.failures.slice(0, 2).map(f => ({...f, excerpt: safeContextText(f.excerpt).slice(-900)}))};
      Object.assign(metrics, proposalContextMetadata(loaded));
      inputHash = createHash('sha256').update(JSON.stringify(bounded)).digest('hex');
      const proposer = new ModelPatchProposer(async prompt => {
        guard();
        metrics.promptChars = prompt.length; metrics.promptBytes = Buffer.byteLength(prompt);
        const local = await bootstrapPatch(prompt, controller.signal, {type: 'object', properties: {rationale: {type: 'string'}, edits: {type: 'array', items: {
          type: 'object', properties: {path: {type: 'string'}, ops: {type: 'array', items: {type: 'object', properties: {kind: {const: 'edit'}, edit: {type: 'object', properties: {oldText: {type: 'string'}, newText: {type: 'string'}, nearLine: {type: 'integer', minimum: 1}}, required: ['oldText','newText'], additionalProperties: false}}, required: ['kind','edit'], additionalProperties: false}}}, required: ['path','ops'], additionalProperties: false}}}, required: ['rationale','edits'], additionalProperties: false},
          {contextTokens: 4096, maxOutputTokens: 1024, timeoutMs: 300000});
        guard(); if (local) { identity = {providerId: local.providerId, model: local.model}; metrics.inference = local.metrics; metrics.outputChars = local.text.length; return local.text; }
        const selected = await selectLocalInference(); guard();
        if (!selected?.runtime.generate) throw Error('LOCAL_PROPOSER_UNAVAILABLE');
        identity = {providerId: selected.runtime.id, model: selected.model};
        return selected.runtime.generate({model: selected.model, prompt, json: true, timeoutMs: 120000}, controller.signal);
      });
      const proposal = await proposer.propose(bounded); guard();
      if (proposal) proposal.edits = bindProposalToContext(proposal.edits, selection.files);
      metrics.editsCount = proposal?.edits.length ?? 0; record(proposal ? 'PRODUCED' : 'FAILED', proposal ? null : 'INVALID_MODEL_PROPOSAL');
      return proposal ? {status: 'ok', proposal, identity} : {status: 'none', identity};
    } catch (error) {
      const e = error as Error & {inferenceMetrics?: unknown; inferenceIdentity?: typeof identity; contextMetadata?: ReturnType<typeof proposalContextMetadata>};
      if (e.inferenceIdentity) identity = e.inferenceIdentity;
      if (e.inferenceMetrics) metrics.inference = e.inferenceMetrics;
      if (e.contextMetadata) Object.assign(metrics, e.contextMetadata);
      record(controller.signal.aborted ? 'INTERRUPTED' : 'FAILED', e.message?.match(/^[A-Z][A-Z0-9_]+/)?.[0] ?? 'PROPOSAL_ERROR');
      throw error;
    } finally { running.set(id, (running.get(id) ?? []).filter(c => c !== controller)); }
  });
  return dev;
}

export function unregisterDevIpc(): void {
  ipcMain.removeHandler('authority:execute');
  [...Object.values(IPC.devTools), ...Object.values(IPC.dev)].forEach((c) => { try { ipcMain.removeHandler(c); } catch { /* none */ } });
  void current?.managed.stopAll();
  void stopOwnedProcesses();
  current?.projects.closeAll();
  current = null;
  checkEvidence = null;
}
