import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc';
import type {
  Bookmark,
  BrowserProfile,
  BrowserSnapshot,
  BrowserTab,
  DomNode,
  DownloadItem,
  FoundElement,
  HistoryEntry,
  PermissionRecord,
  BrowserActionResult,
  ViewportRect,
} from '../src/types/browser';
import type { RoutingDecision } from '../src/types/ai';
import type { DriveInfo, FsEntry, FsStat } from './agent/FileSystemService';
import type { InstalledApp } from './agent/ApplicationService';
import type { ProcessEntry, SystemInfo } from './agent/SystemService';
import type { OllamaHealth, OllamaModel } from './agent/OllamaProvider';
import type { PrivilegedResult } from './agent/ipcAgent';
import type {
  BenchmarkResult, HardwareFingerprint, LocalAIState, LocalModelEntry,
  MachinePerformanceProfile, ModelRecommendation, OSIdentity, SystemProfile,
} from '../src/types/machine';
import type { ControlStatus, DiscoveredApp } from '../src/types/desktop';
import type { ConversationMessage, TaskState, UsageRecord, QuotaSnapshot, RoutingAudit, UsageUnit } from '../src/fabric/types';
import type { HandoffContext } from '../src/fabric/ContextBudgetManager';

/**
 * The only bridge between renderer and main. Every method is a narrow, named
 * capability — never a generic `invoke(channel, ...args)` passthrough, so the
 * renderer cannot reach a channel that was not deliberately published here.
 */

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.off(channel, handler); };
}

const api = {
  workbench:{
    snapshot:()=>ipcRenderer.invoke('workbench:snapshot') as Promise<{capabilities:ReturnType<import('./workbench/WorkstationService').WorkstationService['capabilities']>;runs:import('../src/workbench/contracts').WorkReceipt[];warnings:string[]}>,
    run:(id:string,prompt:string)=>ipcRenderer.invoke('workbench:run',id,prompt) as Promise<import('../src/workbench/contracts').WorkReceipt>,
    reveal:(id:string,index:number)=>ipcRenderer.invoke('workbench:reveal',id,index) as Promise<boolean>,
  },
  intelligence:{
    snapshot:()=>ipcRenderer.invoke('intelligence:snapshot') as Promise<ReturnType<typeof import('./bridge/ipcIntelligence').intelligenceSnapshot>>,
    action:(action:string)=>ipcRenderer.invoke('intelligence:action',action),
    config:()=>ipcRenderer.invoke('intelligence:config'),
    queue:(id:string,prompt:string)=>ipcRenderer.invoke('intelligence:queue',id,prompt),
  },
  bootstrap: {
    snapshot: () => ipcRenderer.invoke('bootstrap:snapshot') as Promise<{state:import('./bootstrap/contracts').BootstrapSnapshot;candidates:import('./bootstrap/contracts').LocalCandidate[];runtime:import('./bootstrap/contracts').RuntimeCatalog;external:string}>,
    inspect: () => ipcRenderer.invoke('bootstrap:inspect') as Promise<{state:import('./bootstrap/contracts').BootstrapSnapshot;candidates:import('./bootstrap/contracts').LocalCandidate[];runtime:import('./bootstrap/contracts').RuntimeCatalog;external:string}>,
    action: (action:string) => ipcRenderer.invoke('bootstrap:action',action) as Promise<boolean>,
    diagnostics: () => ipcRenderer.invoke('bootstrap:diagnostics') as Promise<{pid:number|null;ownership:string|null}>,
    answer: (id:string,prompt:string) => ipcRenderer.invoke('bootstrap:answer',id,prompt) as Promise<{text:string;providerId:string;model:string|null;messageId:string;mainRecorded:true}>,
  },
  connected: {
    snapshot: () => ipcRenderer.invoke('connected:snapshot') as Promise<ReturnType<import('./connected/ConnectedAIService').ConnectedAIService['snapshot']>>,
    refresh: () => ipcRenderer.invoke('connected:refresh') as Promise<ReturnType<import('./connected/ConnectedAIService').ConnectedAIService['snapshot']>>,
    choose: () => ipcRenderer.invoke('connected:choose') as Promise<boolean>,
    credential: (provider = 'openai-api') => ipcRenderer.invoke('connected:credential', provider) as Promise<boolean>,
    startLocal: () => ipcRenderer.invoke('connected:start-local'),
    execute: (id: string, prompt: string, selection: { providerId?: string; model?: string; continuation?: import('./connected/TaskContinuity').ContinuationChoice }) => ipcRenderer.invoke('connected:execute', id, prompt, selection),
    checkpoint: (taskId: string) => ipcRenderer.invoke('connected:checkpoint', taskId) as Promise<ReturnType<import('./connected/TaskContinuity').TaskContinuity['checkpoint']>>,
    artifact: (id: string, choice: import('./connected/TaskContinuity').ContinuationChoice, sourceOperationId: string) => ipcRenderer.invoke('connected:artifact', id, choice, sourceOperationId),
    verify: (id: string, choice: import('./connected/TaskContinuity').ContinuationChoice, sourceOperationId: string, contract: unknown) => ipcRenderer.invoke('connected:verify', id, choice, sourceOperationId, contract) as Promise<import('../src/fabric/Verification').ResultVerification>,
    memory: (taskId: string, query: string) => ipcRenderer.invoke('connected:memory', taskId, query) as Promise<ReturnType<import('./connected/ConnectedAIService').ConnectedAIService['memory']>>,
    expandMemory: (taskId: string, ref: import('./connected/SovereignMemory').MemoryReference) => ipcRenderer.invoke('connected:memory-expand', taskId, ref) as Promise<ReturnType<import('./connected/ConnectedAIService').ConnectedAIService['expandMemory']>>,
    recommend: (taskId: string, contract: unknown) => ipcRenderer.invoke('connected:recommend', taskId, contract) as Promise<ReturnType<import('./connected/ConnectedAIService').ConnectedAIService['recommend']>>,
    graph: (id: string, plan: unknown) => ipcRenderer.invoke('connected:graph', id, plan) as Promise<import('./connected/ConciliusCoordinator').ConciliusGraph>,
    graphRead: (id: string) => ipcRenderer.invoke('connected:graph-read', id) as Promise<import('./connected/ConciliusCoordinator').ConciliusGraph | null>,
    organize: (id:string,input:import('./connected/WorkOrganization').OrganizationRequest) => ipcRenderer.invoke('connected:organize',id,input) as Promise<Awaited<ReturnType<import('./connected/ConnectedAIService').ConnectedAIService['runOrganization']>>>,
  },
  authority: {
    execute: (runId: string, toolId: string, args: Record<string, unknown>): Promise<{ ok: boolean; realm: string; status?: string; data?: unknown; error?: string; audit?: unknown[]; evidence: import('../src/fabric/types').TaskEvidence[] }> => ipcRenderer.invoke('authority:execute', runId, toolId, args),
    snapshot: () => ipcRenderer.invoke('authority:snapshot') as Promise<{ accessMode: import('../src/types').AccessMode }>,
    choose: () => ipcRenderer.invoke('authority:choose') as Promise<boolean>,
    begin: (runId: string, originalText: string) => ipcRenderer.invoke('authority:begin', runId, originalText),
    stop: () => ipcRenderer.invoke('authority:stop') as Promise<string>,
    onChanged: (cb: (value: { accessMode: import('../src/types').AccessMode }) => void) => subscribe('authority:changed', cb),
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.window.minimize),
    toggleMaximize: () => ipcRenderer.send(IPC.window.toggleMaximize),
    close: () => ipcRenderer.send(IPC.window.close),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.window.isMaximized),
    onMaximizedChanged: (cb: (value: boolean) => void) => subscribe<boolean>(IPC.window.maximizedChanged, cb),
  },
  app: {
    platform: (): Promise<string> => ipcRenderer.invoke(IPC.app.platform),
    version: (): Promise<string> => ipcRenderer.invoke(IPC.app.version),
  },
  fabric: {
    appendMessage: (message: ConversationMessage): Promise<boolean> => ipcRenderer.invoke(IPC.fabric.appendMessage, message),
    messagePage: (conversationId: string, limit?: number, beforeSeq?: number): Promise<{ seq: number; message: ConversationMessage }[]> => ipcRenderer.invoke(IPC.fabric.messagePage, conversationId, limit, beforeSeq),
    saveTask: (task: TaskState): Promise<boolean> => ipcRenderer.invoke(IPC.fabric.saveTask, task),
    task: (taskId: string): Promise<TaskState | null> => ipcRenderer.invoke(IPC.fabric.task, taskId),
    taskPage: (limit?: number, before?: { updatedAt: number; taskId: string }): Promise<TaskState[]> => ipcRenderer.invoke(IPC.fabric.taskPage, limit, before),
    handoff: (taskId: string, contextLimit?: number): Promise<HandoffContext> => ipcRenderer.invoke(IPC.fabric.handoff, taskId, contextLimit),
    usagePage: (providerId: string, limit?: number, before?: number): Promise<UsageRecord[]> => ipcRenderer.invoke(IPC.fabric.usagePage, providerId, limit, before),
    quota: (providerId: string, accountId: string | null, unit: UsageUnit): Promise<QuotaSnapshot> => ipcRenderer.invoke(IPC.fabric.quota, providerId, accountId, unit),
    routingPage: (taskId: string, limit?: number): Promise<RoutingAudit[]> => ipcRenderer.invoke(IPC.fabric.routingPage, taskId, limit),
  },
  hotkeys: {
    onCommandPalette: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.hotkeys.commandPalette, handler);
      return () => { ipcRenderer.off(IPC.hotkeys.commandPalette, handler); };
    },
    /** Combos captured inside a page and handed back to the shell. */
    onForwarded: (cb: (combo: string) => void) => subscribe<string>(IPC.hotkeys.forwarded, cb),
  },

  browser: {
    onState: (cb: (snapshot: BrowserSnapshot) => void) => subscribe<BrowserSnapshot>(IPC.browser.stateChanged, cb),
    onDownloads: (cb: (items: DownloadItem[]) => void) => subscribe<DownloadItem[]>(IPC.browser.downloadsChanged, cb),
    snapshot: (): Promise<BrowserSnapshot> => ipcRenderer.invoke(IPC.browser.snapshot),

    create: (url: string, workspaceId: string, profileId?: string): Promise<BrowserSnapshot> =>
      ipcRenderer.invoke(IPC.browser.create, url, workspaceId, profileId),
    close: (tabId: string): Promise<void> => ipcRenderer.invoke(IPC.browser.close, tabId),
    activate: (tabId: string): Promise<void> => ipcRenderer.invoke(IPC.browser.activate, tabId),
    setPinned: (tabId: string, pinned: boolean): Promise<void> => ipcRenderer.invoke(IPC.browser.setPinned, tabId, pinned),
    setProfile: (tabId: string, profileId: string): Promise<void> => ipcRenderer.invoke(IPC.browser.setProfile, tabId, profileId),

    navigate: (tabId: string, input: string): Promise<void> => ipcRenderer.invoke(IPC.browser.navigate, tabId, input),
    back: (tabId: string): Promise<void> => ipcRenderer.invoke(IPC.browser.back, tabId),
    forward: (tabId: string): Promise<void> => ipcRenderer.invoke(IPC.browser.forward, tabId),
    reload: (tabId: string): Promise<void> => ipcRenderer.invoke(IPC.browser.reload, tabId),
    stop: (tabId: string): Promise<void> => ipcRenderer.invoke(IPC.browser.stop, tabId),

    setBounds: (rect: ViewportRect): Promise<void> => ipcRenderer.invoke(IPC.browser.setBounds, rect),
    setVisible: (visible: boolean): Promise<void> => ipcRenderer.invoke(IPC.browser.setVisible, visible),

    profiles: (): Promise<BrowserProfile[]> => ipcRenderer.invoke(IPC.browser.profiles),
    history: (query?: string): Promise<HistoryEntry[]> => ipcRenderer.invoke(IPC.browser.history, query),
    clearHistory: (profileId?: string): Promise<void> => ipcRenderer.invoke(IPC.browser.clearHistory, profileId),
    bookmarks: (): Promise<Bookmark[]> => ipcRenderer.invoke(IPC.browser.bookmarks),
    addBookmark: (tabId: string, folder?: string): Promise<void> => ipcRenderer.invoke(IPC.browser.addBookmark, tabId, folder),
    removeBookmark: (id: string): Promise<void> => ipcRenderer.invoke(IPC.browser.removeBookmark, id),
    downloads: (): Promise<DownloadItem[]> => ipcRenderer.invoke(IPC.browser.downloads),
    cancelDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.browser.cancelDownload, id),
    permissions: (): Promise<PermissionRecord[]> => ipcRenderer.invoke(IPC.browser.permissions),
    setPermission: (origin: string, permission: string, allowed: boolean, profileId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.browser.setPermission, origin, permission, allowed, profileId),

    // Read-only inspection, usable by JARVIS today.
    pageText: (tabId: string): Promise<string> => ipcRenderer.invoke(IPC.browser.pageText, tabId),
    domSnapshot: (tabId: string, depth?: number): Promise<DomNode> => ipcRenderer.invoke(IPC.browser.domSnapshot, tabId, depth),
    screenshot: (tabId: string): Promise<string> => ipcRenderer.invoke(IPC.browser.screenshot, tabId),

    // Declared so the agent layer can be written now; refused until CONTROL exists.
    findElements: (tabId: string, query: string): Promise<FoundElement[]> =>
      ipcRenderer.invoke(IPC.browser.findElements, tabId, query),
    clickElement: (tabId: string, ref: string): Promise<BrowserActionResult> =>
      ipcRenderer.invoke(IPC.browser.clickElement, tabId, ref),
    typeIntoElement: (tabId: string, ref: string, text: string): Promise<BrowserActionResult> =>
      ipcRenderer.invoke(IPC.browser.typeIntoElement, tabId, ref, text),
    executeBrowserAction: (tabId: string, action: string, payload?: unknown): Promise<BrowserActionResult> =>
      ipcRenderer.invoke(IPC.browser.executeAction, tabId, action, payload),
  },

  /**
   * Agent capabilities. The session's permission level travels with every call
   * and is re-checked in main — the renderer cannot grant itself anything.
   */
  /**
   * Desktop tools: one named function per tool, each bound to its own channel.
   * The map is built from the closed IPC table — there is no way to reach a
   * channel that is not in it.
   */
  desktopTools: Object.fromEntries(
    Object.entries(IPC.desktopTools).map(([toolId, channel]) => [
      toolId,
      (level: string, runId: string, args: unknown): Promise<{ ok: boolean; data?: unknown; error?: string; reason?: string }> =>
        ipcRenderer.invoke(channel, level, runId, args),
    ]),
  ) as Record<keyof typeof IPC.desktopTools, (level: string, runId: string, args: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string; reason?: string }>>,

  devTools: Object.fromEntries(
    Object.entries(IPC.devTools).map(([toolId, channel]) => [
      toolId,
      (level: string, runId: string, args: unknown): Promise<{ ok: boolean; data?: unknown; error?: string; reason?: string }> =>
        ipcRenderer.invoke(channel, level, runId, args),
    ]),
  ) as Record<keyof typeof IPC.devTools, (level: string, runId: string, args: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string; reason?: string }>>,

  /** Workspace UI calls. Tool execution goes through devTools only. */
  dev: {
    authorize: (toolId: string, runId: string, args: unknown): Promise<{ ok: boolean; reason?: string; escalate?: { risk: 'SAFE' | 'SENSITIVE' | 'DESTRUCTIVE' | 'CRITICAL'; reason: string } }> => ipcRenderer.invoke(IPC.dev.authorize, toolId, runId, args),
    cancelRun: (runId: string): Promise<void> => ipcRenderer.invoke(IPC.dev.cancelRun, runId),
    roots: (): Promise<unknown> => ipcRenderer.invoke(IPC.dev.roots),
    addRoot: (p: string): Promise<unknown> => ipcRenderer.invoke(IPC.dev.addRoot, p),
    removeRoot: (p: string): Promise<void> => ipcRenderer.invoke(IPC.dev.removeRoot, p),
    discover: (): Promise<unknown> => ipcRenderer.invoke(IPC.dev.discover),
    openProject: (id: string): Promise<unknown> => ipcRenderer.invoke(IPC.dev.openProject, id),
    readFile: (id: string, rel: string): Promise<unknown> => ipcRenderer.invoke(IPC.dev.readFile, id, rel),
    saveFile: (id: string, rel: string, content: string, hash: string): Promise<{ hash: string }> => ipcRenderer.invoke(IPC.dev.saveFile, id, rel, content, hash),
    changeSets: (): Promise<unknown> => ipcRenderer.invoke(IPC.dev.changeSets),
    fileDiff: (runId: string, p: string): Promise<unknown> => ipcRenderer.invoke(IPC.dev.fileDiff, runId, p),
    revertRun: (runId: string): Promise<unknown> => ipcRenderer.invoke(IPC.dev.revertRun, runId),
    undoLast: (): Promise<unknown> => ipcRenderer.invoke(IPC.dev.undoLast),
    revertFile: (runId: string, p: string): Promise<unknown> => ipcRenderer.invoke(IPC.dev.revertFile, runId, p),
    outputSearch: (id: string, q: string): Promise<unknown> => ipcRenderer.invoke(IPC.dev.outputSearch, id, q),
    processes: (): Promise<unknown> => ipcRenderer.invoke(IPC.dev.processes),
    processLogs: (id: string): Promise<unknown> => ipcRenderer.invoke(IPC.dev.processLogs, id),
    stopProcess: (id: string): Promise<void> => ipcRenderer.invoke(IPC.dev.stopProcess, id),
    commands: (): Promise<unknown> => ipcRenderer.invoke(IPC.dev.commands),
    checkEvidence: (runId: string): Promise<unknown> => ipcRenderer.invoke(IPC.dev.checkEvidence, runId),
    onCommand: (cb: (e: unknown) => void) => subscribe<unknown>(IPC.dev.commandEvent, cb),
    onProcesses: (cb: () => void) => subscribe<unknown>(IPC.dev.processEvent, () => cb()),
    propose: (input: unknown, runId: string): Promise<{ status: 'ok' | 'none' | 'unavailable'; proposal?: unknown; identity?: {providerId: string; model: string | null} }> => ipcRenderer.invoke(IPC.dev.propose, input, runId),
  },

  desktop: {
    status: (): Promise<ControlStatus> => ipcRenderer.invoke(IPC.desktop.status),
    onStatus: (cb: (s: ControlStatus) => void) => subscribe<ControlStatus>(IPC.desktop.statusChanged, cb),
    onHumanOverride: (cb: (e: { at: number }) => void) => subscribe<{ at: number }>(IPC.desktop.humanOverride, cb),
    onEmergencyStop: (cb: (e: { at: number }) => void) => subscribe<{ at: number }>(IPC.desktop.emergencyStop, cb),
    bindRun: (runId: string): Promise<ControlStatus> => ipcRenderer.invoke(IPC.desktop.bindRun, runId),
    releaseRun: (runId: string): Promise<ControlStatus> => ipcRenderer.invoke(IPC.desktop.releaseRun, runId),
    stop: (): Promise<ControlStatus> => ipcRenderer.invoke(IPC.desktop.stop),
    pause: (): Promise<ControlStatus> => ipcRenderer.invoke(IPC.desktop.pause),
    resume: (): Promise<ControlStatus> => ipcRenderer.invoke(IPC.desktop.resume),
    apps: (): Promise<DiscoveredApp[]> => ipcRenderer.invoke(IPC.desktop.apps),
    setEmergencyShortcut: (accelerator: string): Promise<{ ok: boolean; accelerator: string | null; error?: string }> =>
      ipcRenderer.invoke(IPC.desktop.setEmergencyShortcut, accelerator),
  },

  /** Machine intelligence. Read-only; nothing here installs or downloads. */
  machine: {
    identity: (): Promise<OSIdentity> => ipcRenderer.invoke(IPC.machine.identity),
    profile: (force?: boolean): Promise<{ profile: SystemProfile; performance: MachinePerformanceProfile; fingerprint: HardwareFingerprint }> =>
      ipcRenderer.invoke(IPC.machine.profile, force),
    useFixture: (fixtureId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.machine.useFixture, fixtureId),
    discoverLocalAI: (): Promise<LocalAIState> => ipcRenderer.invoke(IPC.machine.discoverLocalAI),
    localAIState: (): Promise<LocalAIState> => ipcRenderer.invoke(IPC.machine.localAIState),
    recommend: (): Promise<ModelRecommendation> => ipcRenderer.invoke(IPC.machine.recommend),
    catalog: (): Promise<LocalModelEntry[]> => ipcRenderer.invoke(IPC.machine.catalog),
    benchmark: (runtimeId: string, modelId: string): Promise<BenchmarkResult> =>
      ipcRenderer.invoke(IPC.machine.benchmark, runtimeId, modelId),
    cancelBenchmark: (): Promise<boolean> => ipcRenderer.invoke(IPC.machine.cancelBenchmark),
    openOfficialSource: (url: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.machine.openOfficialSource, url),
  },

  agent: {
    fsGetDrives: (level: string): Promise<PrivilegedResult<DriveInfo[]>> =>
      ipcRenderer.invoke(IPC.agent.fsGetDrives, level),
    fsList: (level: string, path: string): Promise<PrivilegedResult<FsEntry[]>> =>
      ipcRenderer.invoke(IPC.agent.fsList, level, path),
    fsStat: (level: string, path: string): Promise<PrivilegedResult<FsStat>> =>
      ipcRenderer.invoke(IPC.agent.fsStat, level, path),
    fsExists: (level: string, path: string): Promise<PrivilegedResult<boolean>> =>
      ipcRenderer.invoke(IPC.agent.fsExists, level, path),
    fsSearch: (level: string, options: { query: string; roots?: string[]; limit?: number; maxDepth?: number }): Promise<PrivilegedResult<FsEntry[]>> =>
      ipcRenderer.invoke(IPC.agent.fsSearch, level, options),
    fsReadText: (level: string, target: string): Promise<PrivilegedResult<import('./agent/FileSystemService').TextRead>> =>
      ipcRenderer.invoke(IPC.agent.fsReadText, level, target),
    fsSearchStatus: (): Promise<import('./agent/FileSystemService').SearchStatus | null> =>
      ipcRenderer.invoke(IPC.agent.fsSearchStatus),
    appList: (level: string, query?: string): Promise<PrivilegedResult<InstalledApp[]>> =>
      ipcRenderer.invoke(IPC.agent.appList, level, query),
    systemInfo: (level: string): Promise<PrivilegedResult<SystemInfo>> =>
      ipcRenderer.invoke(IPC.agent.systemInfo, level),
    processList: (level: string): Promise<PrivilegedResult<ProcessEntry[]>> =>
      ipcRenderer.invoke(IPC.agent.processList, level),
    ollamaHealth: (force?: boolean): Promise<OllamaHealth> =>
      ipcRenderer.invoke(IPC.agent.ollamaHealth, force),
    ollamaModels: (): Promise<OllamaModel[]> => ipcRenderer.invoke(IPC.agent.ollamaModels),
    route: (prompt: string, preferredModel?: string, runId?: string): Promise<RoutingDecision> =>
      ipcRenderer.invoke(IPC.agent.route, prompt, preferredModel, runId),
  },
};

contextBridge.exposeInMainWorld('jarvis', api);

// Isolated-world listener, before React. There is deliberately no public capture API.
// A synthetic renderer click/key event cannot mint user intent (isTrusted=false).
document.addEventListener('click', event => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const button = event.target.closest('button');
  if(button?.hasAttribute('data-intelligence-action'))ipcRenderer.send('intelligence:capture',button.getAttribute('data-intelligence-action'));
  if(button?.hasAttribute('data-mcp-queue')){
    const input=document.querySelector<HTMLTextAreaElement>('[data-mcp-input]');
    if(input)ipcRenderer.send('authority:capture-original',input.value.trim(),false);
  }
  if (button?.hasAttribute('data-bootstrap-action')) ipcRenderer.send('bootstrap:capture', button.getAttribute('data-bootstrap-action'));
  if (button?.hasAttribute('data-connected-execute')) {
    const input = document.querySelector<HTMLTextAreaElement>('[data-connected-prompt]');
    if (input) {
      ipcRenderer.send('authority:capture-original', input.value, false);
      ipcRenderer.send('connected:capture-selection', { prompt: input.value,
        providerId: document.querySelector<HTMLSelectElement>('[aria-label="Superficie conectada"]')?.value ?? '',
        model: document.querySelector<HTMLInputElement>('[aria-label="Modelo conectado"]')?.value ?? '',
        taskId: document.querySelector<HTMLInputElement>('[data-connected-task]')?.value ?? '',
        revision: Number(document.querySelector('[data-connected-checkpoint-revision]')?.getAttribute('data-connected-checkpoint-revision') ?? -1) });
    }
  }
  if (button?.hasAttribute('data-connected-artifact')) {
    const taskId = button.getAttribute('data-task-id') ?? '', revision = Number(button.getAttribute('data-revision')), sourceOperationId = button.getAttribute('data-source-operation') ?? '';
    const prompt = JSON.stringify({ taskId, revision, sourceOperationId });
    ipcRenderer.send('authority:capture-original', prompt, false);
    ipcRenderer.send('connected:capture-artifact', { taskId, revision, sourceOperationId, prompt });
  }
  if (button?.hasAttribute('data-connected-verify')) {
    try {
      const contract = JSON.parse(document.querySelector<HTMLTextAreaElement>('[data-verification-contract]')?.value ?? '');
      const payload = JSON.stringify({ taskId: button.getAttribute('data-task-id') ?? '', revision: Number(button.getAttribute('data-revision')), sourceOperationId: button.getAttribute('data-source-operation') ?? '', contract });
      ipcRenderer.send('authority:capture-original', payload, false); ipcRenderer.send('connected:capture-advanced', payload);
    } catch { /* Invalid criteria do not mint a gesture. */ }
  }
  if (button?.hasAttribute('data-connected-graph')) {
    try {
      const payload = JSON.stringify(JSON.parse(document.querySelector<HTMLTextAreaElement>('[data-concilius-plan]')?.value ?? ''));
      ipcRenderer.send('authority:capture-original', payload, false); ipcRenderer.send('connected:capture-advanced', payload);
    } catch { /* Invalid graph never receives a root admission. */ }
  }
  if(button?.hasAttribute('data-connected-organize')) {
    const payload=JSON.stringify({kind:document.querySelector<HTMLSelectElement>('[data-org-kind]')?.value??'summary',
      text:document.querySelector<HTMLTextAreaElement>('[data-org-input]')?.value??'',
      review:document.querySelector<HTMLInputElement>('[data-org-review]')?.checked??false});
    ipcRenderer.send('authority:capture-original',payload,false);ipcRenderer.send('connected:capture-advanced',payload);
  }
  if (button?.hasAttribute('data-authority-home-send')) {
    const input = document.querySelector<HTMLTextAreaElement>('[data-authority-home-input]');
    if (input) ipcRenderer.send('authority:capture-original', input.value, false);
  }
  if (button?.hasAttribute('data-authority-palette-ask')) {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Busca, ordena o pregunta"]');
    if (input) ipcRenderer.send('authority:capture-original', input.value, false);
  } else if (button?.hasAttribute('data-authority-action')) ipcRenderer.send('authority:capture-original', button.textContent ?? 'Acción del usuario', 'ACTION');
  if (button?.getAttribute('aria-label') === 'Enviar') {
    const input = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Pide algo a JARVIS"]');
    if (input) ipcRenderer.send('authority:capture-original', input.value, false);
  }
  if (button?.hasAttribute('data-native-execute')) {
    const form = button.closest('[data-native-console]');
    if (form) {
      const field = (name: string) => form.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? '';
      const original = JSON.stringify({ executable: field('executable'), cwd: field('cwd'), args: field('args') });
      ipcRenderer.send('authority:capture-original', original, false);
    }
  }
}, true);
document.addEventListener('keydown', event => {
  if (!event.isTrusted || event.key !== 'Enter' || event.shiftKey || !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)) return;
  const input = event.target;
  if (input.hasAttribute('data-authority-home-input')) { ipcRenderer.send('authority:capture-original', input.value, false); return; }
  if (input.placeholder === 'Busca, ordena o pregunta') {
    const selected = document.querySelector('[data-authority-palette] [data-selected="true"]');
    ipcRenderer.send('authority:capture-original', selected?.hasAttribute('data-authority-palette-ask') ? input.value : selected?.textContent ?? input.value, selected?.hasAttribute('data-authority-palette-ask') ? false : 'ACTION');
    return;
  }
  if (input.placeholder === 'Pide algo a JARVIS') ipcRenderer.send('authority:capture-original', input.value, false);
  else if (input.getAttribute('data-authority-omnibox') === 'true') {
    ipcRenderer.send('authority:capture-original', input.value, true);
    ipcRenderer.send('authority:capture-original', input.value, false);
  }
}, true);
export type JarvisBridge = typeof api;
export type { BrowserTab };
