import { create } from 'zustand';
import type { ChangeSetSummary, DevProject, IndexedFile, ProjectRoot, RevertReport } from '@/types';
import { devController, onDevControllerChange } from '@/services/dev/devController';
import type { CommandLogEntry } from '@/services/dev/devController';
import { patchResult } from '@/dev/patch';

export interface EditorTab {
  rel: string;
  content: string;
  /** Last content known to be on disk. */
  saved: string;
  hash: string;
  binary: boolean;
  secret: boolean;
  truncated: boolean;
  /** Set when a save found the file changed on disk. */
  conflict: boolean;
  error: string | null;
  cursor: { line: number; column: number };
}

export interface DiffView { title: string; runId: string | null; path: string; before: string; after: string; diff: string }

export type RevertOutcome = { kind: 'success' | 'partial' | 'conflict' | 'failure'; message: string; report: RevertReport | null };

interface DevState {
  mode: 'ipc' | 'local' | 'unavailable';
  roots: ProjectRoot[];
  projects: DevProject[];
  loading: boolean;
  error: string | null;
  activeProjectId: string | null;
  project: DevProject | null;
  files: IndexedFile[];
  tabs: EditorTab[];
  activeTab: string | null;
  diff: DiffView | null;
  changeSets: ChangeSetSummary[];
  commands: CommandLogEntry[];
  lastRevert: RevertOutcome | null;
  bottom: 'terminal' | 'changes';
  /** Subscriptions currently held — exposed so tests can prove no duplicates. */
  subscriptions: number;

  attach: () => () => void;
  refresh: () => Promise<void>;
  addRoot: (path: string) => Promise<void>;
  removeRoot: (path: string) => Promise<void>;
  openProject: (id: string) => Promise<boolean>;
  openFile: (rel: string) => Promise<void>;
  editTab: (rel: string, content: string) => void;
  setCursor: (rel: string, line: number, column: number) => void;
  saveTab: (rel: string) => Promise<boolean>;
  reloadTab: (rel: string) => Promise<void>;
  closeTab: (rel: string) => void;
  setActiveTab: (rel: string) => void;
  showTabDiff: (rel: string) => void;
  loadChanges: () => Promise<void>;
  showChangeDiff: (runId: string, path: string) => Promise<void>;
  closeDiff: () => void;
  revertFile: (runId: string, path: string) => Promise<RevertOutcome>;
  revertRun: (runId: string) => Promise<RevertOutcome>;
  undoLast: () => Promise<RevertOutcome>;
  setBottom: (b: DevState['bottom']) => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function describeRevert(report: RevertReport | null, error?: unknown): RevertOutcome {
  if (error) return { kind: 'failure', message: `No se pudo revertir: ${message(error)}`, report: null };
  if (!report) return { kind: 'failure', message: 'No hay nada que revertir.', report: null };
  const restored = report.restored.length, conflicts = report.conflicts.length, skipped = report.skipped.length;
  if (!restored && !conflicts && !skipped) return { kind: 'failure', message: 'No había cambios de JARVIS pendientes de deshacer.', report };
  if (conflicts && !restored) return { kind: 'conflict', message: `Conflicto: ${report.conflicts.join(', ')} cambió después de JARVIS de forma incompatible. No se tocó.`, report };
  if (conflicts || skipped) {
    return { kind: 'partial', message: `Revertido en parte: ${restored} restaurado(s); ${conflicts ? `conflicto en ${report.conflicts.join(', ')} (sin tocar)` : ''}${conflicts && skipped ? '; ' : ''}${skipped ? `${skipped} sin instantánea (restaurar desde la Papelera)` : ''}.`, report };
  }
  return { kind: 'success', message: `Revertido: ${restored} archivo(s). Tus ediciones posteriores se conservaron.`, report };
}

let detach: (() => void) | null = null;
let consumers = 0;

export const useDevStore = create<DevState>((set, get) => ({
  mode: devController().mode,
  roots: [],
  projects: [],
  loading: false,
  error: null,
  activeProjectId: null,
  project: null,
  files: [],
  tabs: [],
  activeTab: null,
  diff: null,
  changeSets: [],
  commands: [],
  lastRevert: null,
  bottom: 'terminal',
  subscriptions: 0,

  /**
   * One live subscription at most, however many times the workspace mounts.
   * Returns the release for the effect cleanup.
   */
  attach: () => {
    consumers++;
    if (!detach) {
      const offCmd = devController().subscribe(() => {
        set({ commands: devController().commands() });
        void get().loadChanges();
      });
      const offSwap = onDevControllerChange(() => { set({ mode: devController().mode }); void get().refresh(); });
      detach = () => { offCmd(); offSwap(); detach = null; set({ subscriptions: 0 }); };
      set({ subscriptions: 1, mode: devController().mode, commands: devController().commands() });
    }
    // Reference-counted: the last consumer to unmount releases the subscription.
    let released = false;
    return () => {
      if (released) return;
      released = true;
      consumers = Math.max(0, consumers - 1);
      if (consumers === 0) detach?.();
    };
  },

  refresh: async () => {
    set({ loading: true, error: null, mode: devController().mode });
    try {
      const [roots, projects] = await Promise.all([devController().roots(), devController().discover()]);
      set({ roots, projects, loading: false });
      const id = get().activeProjectId;
      if (id && !projects.some((p) => p.id === id)) set({ activeProjectId: null, project: null, files: [], error: 'El proyecto abierto ya no existe en los Project Roots.' });
    } catch (e) {
      set({ loading: false, error: message(e) });
    }
  },

  addRoot: async (path) => {
    try { await devController().addRoot(path); await get().refresh(); }
    catch (e) { set({ error: message(e) }); }
  },
  removeRoot: async (path) => {
    try { await devController().removeRoot(path); await get().refresh(); }
    catch (e) { set({ error: message(e) }); }
  },

  openProject: async (id) => {
    set({ loading: true, error: null });
    try {
      const { project, files } = await devController().openProject(id);
      const same = get().activeProjectId === id;
      set({ activeProjectId: id, project, files, loading: false, ...(same ? {} : { tabs: [], activeTab: null, diff: null }) });
      set({ projects: get().projects.map((p) => (p.id === id ? project : p)) });
      return true;
    } catch (e) {
      set({ loading: false, error: `No se pudo abrir el proyecto: ${message(e)}` });
      return false;
    }
  },

  openFile: async (rel) => {
    const id = get().activeProjectId;
    if (!id) return;
    if (get().tabs.some((t) => t.rel === rel)) { set({ activeTab: rel, diff: null }); return; }
    try {
      const r = await devController().readFile(id, rel);
      const content = r.content ?? '';
      const tab: EditorTab = { rel, content, saved: content, hash: r.hash, binary: r.binary, secret: r.secret, truncated: r.truncated, conflict: false, error: null, cursor: { line: 1, column: 1 } };
      set({ tabs: [...get().tabs, tab], activeTab: rel, diff: null, error: null });
    } catch (e) {
      set({ error: `No se pudo abrir ${rel}: ${message(e)}` });
    }
  },

  editTab: (rel, content) => set({ tabs: get().tabs.map((t) => (t.rel === rel && !t.binary && !t.secret && !t.truncated ? { ...t, content } : t)) }),
  setCursor: (rel, line, column) => set({ tabs: get().tabs.map((t) => (t.rel === rel ? { ...t, cursor: { line, column } } : t)) }),

  saveTab: async (rel) => {
    const id = get().activeProjectId;
    const tab = get().tabs.find((t) => t.rel === rel);
    if (!id || !tab || tab.content === tab.saved) return false;
    try {
      const { hash } = await devController().saveFile(id, rel, tab.content, tab.hash);
      set({ tabs: get().tabs.map((t) => (t.rel === rel ? { ...t, saved: t.content, hash, conflict: false, error: null } : t)) });
      return true;
    } catch (e) {
      const conflict = /cambió|ConflictError|apareció/.test(message(e));
      set({ tabs: get().tabs.map((t) => (t.rel === rel ? { ...t, conflict, error: message(e) } : t)) });
      return false;
    }
  },

  reloadTab: async (rel) => {
    const id = get().activeProjectId;
    if (!id) return;
    try {
      const r = await devController().readFile(id, rel);
      set({ tabs: get().tabs.map((t) => (t.rel === rel ? { ...t, content: r.content ?? '', saved: r.content ?? '', hash: r.hash, conflict: false, error: null } : t)) });
    } catch (e) {
      set({ tabs: get().tabs.map((t) => (t.rel === rel ? { ...t, error: `El archivo ya no se puede leer: ${message(e)}` } : t)) });
    }
  },

  closeTab: (rel) => {
    const tabs = get().tabs.filter((t) => t.rel !== rel);
    const active = get().activeTab === rel ? tabs.at(-1)?.rel ?? null : get().activeTab;
    set({ tabs, activeTab: active });
  },
  setActiveTab: (rel) => set({ activeTab: rel, diff: null }),

  showTabDiff: (rel) => {
    const tab = get().tabs.find((t) => t.rel === rel);
    if (!tab) return;
    set({ diff: { title: `${rel} · cambios sin guardar`, runId: null, path: rel, before: tab.saved, after: tab.content, diff: patchResult(tab.saved, tab.content, rel).diff } });
  },

  loadChanges: async () => {
    try { set({ changeSets: await devController().changeSets(), commands: devController().commands() }); }
    catch (e) { set({ error: message(e) }); }
  },

  showChangeDiff: async (runId, path) => {
    try {
      const d = await devController().fileDiff(runId, path);
      if (!d) { set({ error: 'Ese cambio ya no está disponible (el ChangeSet no existe o se olvidó).', diff: null }); return; }
      set({ diff: { title: path.split(/[\\/]/).pop() ?? path, runId, path, ...d } });
    } catch (e) {
      set({ error: `No se pudo calcular el diff: ${message(e)}`, diff: null });
    }
  },
  closeDiff: () => set({ diff: null }),

  revertFile: async (runId, path) => {
    let outcome: RevertOutcome;
    try { outcome = describeRevert(await devController().revertFile(runId, path)); }
    catch (e) { outcome = describeRevert(null, e); }
    set({ lastRevert: outcome });
    await get().loadChanges();
    await Promise.all(get().tabs.map((t) => (t.content === t.saved ? get().reloadTab(t.rel) : Promise.resolve())));
    return outcome;
  },
  revertRun: async (runId) => {
    let outcome: RevertOutcome;
    try { outcome = describeRevert(await devController().revertRun(runId)); }
    catch (e) { outcome = describeRevert(null, e); }
    set({ lastRevert: outcome });
    await get().loadChanges();
    await Promise.all(get().tabs.map((t) => (t.content === t.saved ? get().reloadTab(t.rel) : Promise.resolve())));
    return outcome;
  },
  undoLast: async () => {
    let outcome: RevertOutcome;
    try { outcome = describeRevert(await devController().undoLast()); }
    catch (e) { outcome = describeRevert(null, e); }
    set({ lastRevert: outcome });
    await get().loadChanges();
    await Promise.all(get().tabs.map((t) => (t.content === t.saved ? get().reloadTab(t.rel) : Promise.resolve())));
    return outcome;
  },

  setBottom: (bottom) => set({ bottom }),
}));
