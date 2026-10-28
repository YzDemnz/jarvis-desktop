import type { ChangeSetSummary, DevProject, IndexedFile, ProjectRoot, RevertReport, ToolId } from '@/types';
import type { AdapterMap } from '@/agent/adapters/types';
import type { PolicyDecision, ToolPolicy } from '@/agent/ToolBroker';
import type { ReadResult } from '@/dev/FileMutationService';
import type { CommandLogEntry } from '@/dev/DevService';
import { DevService } from '@/dev/DevService';

export type { CommandLogEntry };

export interface DevController {
  readonly mode: 'ipc' | 'local' | 'unavailable';
  adapters(getLevel: () => string, getRunId: () => string): AdapterMap;
  policy(): ToolPolicy | null;
  cancelRun(runId: string): Promise<void>;
  roots(): Promise<ProjectRoot[]>;
  addRoot(path: string): Promise<ProjectRoot>;
  removeRoot(path: string): Promise<void>;
  discover(): Promise<DevProject[]>;
  openProject(id: string): Promise<{ project: DevProject; files: IndexedFile[] }>;
  readFile(projectId: string, rel: string): Promise<ReadResult>;
  saveFile(projectId: string, rel: string, content: string, expectedHash: string): Promise<{ hash: string }>;
  changeSets(): Promise<ChangeSetSummary[]>;
  fileDiff(runId: string, path: string): Promise<{ before: string; after: string; diff: string } | null>;
  revertRun(runId: string): Promise<RevertReport>;
  revertFile(runId: string, path: string): Promise<RevertReport>;
  outputSearch(outputId: string, query: string): Promise<{ line: number; text: string }[]>;
  processes(): Promise<import('@/types').ManagedProcessInfo[]>;
  processLogs(id: string): Promise<string[]>;
  stopProcess(id: string): Promise<void>;
  undoLast(): Promise<RevertReport & { runId?: string | null }>;
  commands(): CommandLogEntry[];
  subscribe(cb: () => void): () => void;
}

const DEV_TOOL_IDS = [
  'project.discover', 'project.list', 'project.inspect', 'project.open', 'project.checks', 'project.verify', 'code.search', 'code.searchText', 'code.searchFiles',
  'code.findReferences', 'code.findDefinition', 'code.context', 'file.read', 'file.proposePatch', 'file.create', 'file.write', 'file.patch',
  'file.rename', 'file.move', 'file.copy', 'directory.create', 'file.trash', 'terminal.execute', 'terminal.output', 'process.start',
  'process.status', 'process.logs', 'process.stop', 'dev.tools', 'git.status', 'git.diff', 'git.log', 'git.branch', 'git.show', 'git.add',
  'git.restore', 'git.checkoutFile', 'git.commit', 'changes.review', 'changes.revert', 'changes.undoLast',
] as const;

/** In-process: the harness (in-memory ports) or any host without Electron. */
export class LocalDevController implements DevController {
  readonly mode = 'local' as const;
  private listeners = new Set<() => void>();
  constructor(readonly service: DevService) {
    service.onCommand(() => this.listeners.forEach((l) => l()));
    service.managed.onChange(() => this.listeners.forEach((l) => l()));
  }
  adapters(): AdapterMap { return this.service.adapters(); }
  policy(): ToolPolicy { return this.service.policy(); }
  async cancelRun(runId: string) { await this.service.cancelRun(runId); }
  async roots() { return this.service.projects.roots(); }
  async addRoot(p: string) { return this.service.projects.addRoot(p); }
  async removeRoot(p: string) { await this.service.projects.removeRoot(p); }
  async discover() { return this.service.projects.discover(); }
  async openProject(id: string) { const o = await this.service.focus(id); return { project: o.project, files: o.indexer.list() }; }
  readFile(id: string, rel: string) { return this.service.readForUser(id, rel); }
  async saveFile(id: string, rel: string, content: string, hash: string) { const r = await this.service.saveForUser(id, rel, content, hash); this.emit(); return r; }
  async changeSets() { return this.service.files.changes.list().map((s) => this.service.files.changes.summary(s.runId)!).filter(Boolean); }
  fileDiff(runId: string, p: string) { return this.service.diffOf(runId, p); }
  async revertRun(runId: string) { const r = await this.service.files.revertRun(runId); this.emit(); return r; }
  async revertFile(runId: string, p: string) { const r = await this.service.files.revertFile(runId, p); this.emit(); return r; }
  async outputSearch(id: string, q: string) { return this.service.terminal.outputs.search(id, q); }
  async processes() { return this.service.managed.list(); }
  async processLogs(id: string) { return this.service.managed.logs(id); }
  async stopProcess(id: string) { await this.service.managed.stop(id); this.emit(); }
  listenerCount() { return this.listeners.size; }
  async undoLast() { const r = await this.service.files.undoLast(); this.emit(); return r; }
  commands() { return [...this.service.commandLog]; }
  subscribe(cb: () => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  emit() { this.listeners.forEach((l) => l()); }
}

type Bridge = NonNullable<Window['jarvis']>;

/** Production: every call is a main-process call; main re-validates each tool. */
class IpcDevController implements DevController {
  readonly mode = 'ipc' as const;
  private log: CommandLogEntry[] = [];
  private listeners = new Set<() => void>();
  constructor(private readonly bridge: Bridge) {
    bridge.dev.onCommand((e) => {
      const entry = e as CommandLogEntry;
      const i = this.log.findIndex((x) => x.id === entry.id);
      if (i >= 0) this.log[i] = entry; else this.log.push(entry);
      this.log = this.log.slice(-200);
      this.listeners.forEach((l) => l());
    });
    bridge.dev.onProcesses(() => this.listeners.forEach((l) => l()));
  }
  adapters(getLevel: () => string, getRunId: () => string): AdapterMap {
    const map: AdapterMap = {};
    for (const id of DEV_TOOL_IDS) {
      const call = this.bridge.devTools[id];
      map[id as ToolId] = async (args: never) => {
        const r = await call(getLevel(), getRunId(), args);
        if (!r.ok) throw new Error(r.error ?? 'El proceso principal rechazó la acción.');
        return r.data;
      };
    }
    return map;
  }
  /** The renderer broker needs the escalation to ask the human; main decides it. */
  policy(): ToolPolicy {
    return async ({ tool, request, context }) => {
      if (!(DEV_TOOL_IDS as readonly string[]).includes(tool.id)) return { ok: true };
      return (await this.bridge.dev.authorize(tool.id, context.runId, request.args)) as PolicyDecision;
    };
  }
  cancelRun(runId: string) { return this.bridge.dev.cancelRun(runId); }
  roots() { return this.bridge.dev.roots() as Promise<ProjectRoot[]>; }
  addRoot(p: string) { return this.bridge.dev.addRoot(p) as Promise<ProjectRoot>; }
  removeRoot(p: string) { return this.bridge.dev.removeRoot(p); }
  discover() { return this.bridge.dev.discover() as Promise<DevProject[]>; }
  openProject(id: string) { return this.bridge.dev.openProject(id) as Promise<{ project: DevProject; files: IndexedFile[] }>; }
  readFile(id: string, rel: string) { return this.bridge.dev.readFile(id, rel) as Promise<ReadResult>; }
  saveFile(id: string, rel: string, content: string, hash: string) { return this.bridge.dev.saveFile(id, rel, content, hash); }
  changeSets() { return this.bridge.dev.changeSets() as Promise<ChangeSetSummary[]>; }
  fileDiff(runId: string, p: string) { return this.bridge.dev.fileDiff(runId, p) as Promise<{ before: string; after: string; diff: string } | null>; }
  revertRun(runId: string) { return this.bridge.dev.revertRun(runId) as Promise<RevertReport>; }
  revertFile(runId: string, p: string) { return this.bridge.dev.revertFile(runId, p) as Promise<RevertReport>; }
  outputSearch(id: string, q: string) { return this.bridge.dev.outputSearch(id, q) as Promise<{ line: number; text: string }[]>; }
  processes() { return this.bridge.dev.processes() as Promise<import('@/types').ManagedProcessInfo[]>; }
  processLogs(id: string) { return this.bridge.dev.processLogs(id) as Promise<string[]>; }
  stopProcess(id: string) { return this.bridge.dev.stopProcess(id); }
  undoLast() { return this.bridge.dev.undoLast() as Promise<RevertReport & { runId?: string | null }>; }
  commands() { return [...this.log]; }
  subscribe(cb: () => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
}

/** No Electron and no harness: nothing touches a disk. */
class UnavailableDevController implements DevController {
  readonly mode = 'unavailable' as const;
  private fail = async (): Promise<never> => { throw new Error('El agente de desarrollo necesita la app de escritorio.'); };
  adapters(): AdapterMap { return {}; }
  policy() { return null; }
  async cancelRun() {}
  async roots() { return []; }
  addRoot = this.fail; removeRoot = this.fail;
  async discover() { return []; }
  openProject = this.fail; readFile = this.fail; saveFile = this.fail;
  async changeSets() { return []; }
  async fileDiff() { return null; }
  revertRun = this.fail; undoLast = this.fail; revertFile = this.fail; stopProcess = this.fail;
  async outputSearch() { return []; }
  async processes() { return []; }
  async processLogs() { return []; }
  commands() { return []; }
  subscribe() { return () => {}; }
}

const bridge = typeof window !== 'undefined' ? window.jarvis : undefined;

let controller: DevController = bridge?.dev && bridge.devTools ? new IpcDevController(bridge) : new UnavailableDevController();
const swapListeners = new Set<() => void>();

export const devController = (): DevController => controller;
export function onDevControllerChange(cb: () => void): () => void { swapListeners.add(cb); return () => { swapListeners.delete(cb); }; }

/** Harness seam: only when there is no Electron bridge. */
export function useLocalDevService(service: DevService): LocalDevController | null {
  if (controller.mode === 'ipc') return null;
  const local = new LocalDevController(service);
  controller = local;
  swapListeners.forEach((l) => l());
  return local;
}
