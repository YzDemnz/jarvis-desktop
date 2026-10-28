import { create } from 'zustand';
import type {
  AgentEvent,
  AgentRun,
  AgentState,
  AgentStatus,
  ApprovalRequest,
  ApprovalVerdict,
  AuditEntry,
  ChatMessage,
  ModelLane,
  PermissionLevel,
  RoutingDecision,
} from '@/types';
import { agentRuntime, approvalEngine, auditService, desktopController, setSessionPermission, toolBroker } from '@/services/agent/runtime';
import { modelLabel, providerLabel } from '@/services/ai/ModelRouter';
import { uid } from '@/lib/id';
import { taskFromRun } from '@/fabric/ContinuityState';

interface JarvisState {
  state: AgentState;
  status: AgentStatus;
  permission: PermissionLevel;
  messages: ChatMessage[];
  events: AgentEvent[];
  lanes: ModelLane[];
  run: AgentRun | null;
  /** Finished runs, newest first. What History and Home read. */
  runs: AgentRun[];
  routing: RoutingDecision | null;
  approval: ApprovalRequest | null;
  audit: AuditEntry[];
  activityExpanded: boolean;
  running: boolean;
  bound: boolean;
  continuityError: string | null;

  bind: () => void;
  setPermission: (p: PermissionLevel) => void;
  setActivityExpanded: (v: boolean) => void;
  submit: (prompt: string) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  resolveApproval: (verdict: ApprovalVerdict) => void;
  clearConversation: () => void;
}

/**
 * Runs whose closing message has already been appended. Keyed by id rather than
 * inferred from the previous snapshot, so a run that settles inside a single
 * emission still produces exactly one message — never zero, never two.
 */
const settledRuns = new Set<string>();
const checkpointKeys = new Map<string, string>();
const runConversations = new Map<string, string>();
let conversationId = (() => {
  try {
    const existing = globalThis.localStorage?.getItem('jarvis.conversation.id');
    if (existing) return existing;
  } catch { /* storage unavailable in tests */ }
  return uid('conversation');
})();
try { globalThis.localStorage?.setItem('jarvis.conversation.id', conversationId); } catch { /* optional */ }

function persistMessage(message: ChatMessage, providerId: string | null = null, taskId: string | null = null): void {
  const bridge = typeof window !== 'undefined' ? window.jarvis?.fabric : undefined;
  if (!bridge) return;
  void bridge.appendMessage({ conversationId: taskId ? runConversations.get(taskId) ?? conversationId : conversationId, messageId: message.id, parentId: null, role: message.role,
    content: message.content, timestamp: message.createdAt, providerId, modelId: message.modelId ?? null,
    channel: 'jarvis-panel', taskId, tools: [], artifacts: [], usageIds: [], contextRefs: [], routingDecisionId: null }).catch(() => {});
}

const GREETING: ChatMessage = {
  id: 'msg-hello',
  role: 'assistant',
  content: 'Estoy en línea. Puedes pedirme que busque archivos, consulte el sistema, lea la página abierta o analice un mercado.',
  createdAt: Date.now(),
};

/** Lanes are derived from the run, not maintained by hand. */
function lanesFor(run: AgentRun | null, routing: RoutingDecision | null): ModelLane[] {
  if (!run) return [];
  const routerDone = run.steps[0]?.status === 'completed';
  const lanes: ModelLane[] = [{
    id: 'lane-router',
    label: 'Router',
    providerId: 'local',
    role: routing ? routing.taskType : 'clasificando',
    state: routerDone ? 'done' : 'working',
    ...(routing ? { note: routing.routedBy === 'ollama' ? 'Ollama' : 'heurístico' } : {}),
  }];

  const toolSteps = run.steps.filter((s) => s.toolId);
  if (toolSteps.length) {
    const failed = toolSteps.some((s) => s.status === 'failed');
    const active = toolSteps.some((s) => s.status === 'running' || s.status === 'awaiting_approval');
    const allDone = toolSteps.every((s) => s.status === 'completed');
    lanes.push({
      id: 'lane-tools',
      label: 'Herramientas',
      providerId: 'local',
      role: `${toolSteps.length} paso${toolSteps.length === 1 ? '' : 's'}`,
      state: failed ? 'failed' : active ? 'working' : allDone ? 'done' : 'queued',
      note: toolSteps.find((s) => s.status === 'running')?.title ?? '',
    });
  }

  if (routing && routing.modelTier !== 'LOCAL') {
    lanes.push({
      id: 'lane-model',
      label: providerLabel(routing.preferredProvider),
      providerId: routing.preferredProvider,
      role: routing.modelTier,
      state: run.status === 'completed' ? 'done' : 'queued',
      note: modelLabel(routing.selectedModelId),
    });
  }

  return lanes;
}

export const useJarvisStore = create<JarvisState>((set, get) => ({
  continuityError: null,
  state: 'idle',
  status: 'idle',
  permission: 'ASSIST',
  messages: [GREETING],
  events: [],
  lanes: [],
  run: null,
  runs: [],
  routing: null,
  approval: null,
  audit: [],
  activityExpanded: false,
  running: false,
  bound: false,

  /**
   * Mirrors the runtime. The store holds no orchestration of its own: every
   * event, step and status comes from AgentRuntime, so what the panel shows is
   * what actually executed.
   */
  bind: () => {
    if (get().bound) return;
    set({ bound: true });
    if (window.jarvis?.authority) {
      const mirror = (value: { accessMode: import('@/types').AccessMode; activeRun?: string; run?: { stopped: boolean } | null }) => {
        setSessionPermission(value.accessMode);
        const run = get().run; if (run) toolBroker.setPermission(run.id, value.accessMode);
        set({ permission: value.accessMode });
        if (value.run?.stopped && agentRuntime.snapshot().run?.id === value.activeRun) agentRuntime.stop('Autoridad revocada en main');
      };
      void window.jarvis.authority.snapshot().then(mirror);
      window.jarvis.authority.onChanged(mirror);
    }
    setSessionPermission(get().permission);

    const activeConversation = conversationId;
    void window.jarvis?.fabric?.messagePage(activeConversation, 50).then((rows) => {
      if (conversationId !== activeConversation || get().messages.length !== 1) return;
      const history = rows.reverse().filter(({ message }) => message.role !== 'tool').map(({ message }): ChatMessage => ({ id: message.messageId, role: message.role === 'tool' ? 'system' : message.role,
        content: message.content, createdAt: message.timestamp,
        ...(message.modelId ? { modelId: message.modelId } : {}) }));
      if (history.length) set({ messages: history });
    }).catch(() => {});

    agentRuntime.subscribe((snapshot) => {
      set({
        run: snapshot.run,
        events: snapshot.events,
        status: snapshot.status,
        state: snapshot.state,
        routing: snapshot.routing,
        running: snapshot.status === 'planning' || snapshot.status === 'running' || snapshot.status === 'waiting_approval' || snapshot.status === 'paused',
        lanes: lanesFor(snapshot.run, snapshot.routing),
      });

      // A run that just settled contributes exactly one message.
      const run = snapshot.run;
      if (!run) return;
      if (!runConversations.has(run.id)) runConversations.set(run.id, conversationId);
      const checkpointKey = JSON.stringify([run.status, run.steps.map(s => [s.id, s.status, s.summary, s.error])]);
      if (checkpointKeys.get(run.id) !== checkpointKey) {
        checkpointKeys.set(run.id, checkpointKey);
        if (checkpointKeys.size > 100) {
          const oldest = checkpointKeys.keys().next().value!;
          checkpointKeys.delete(oldest); runConversations.delete(oldest);
        }
        void window.jarvis?.fabric?.saveTask(taskFromRun(run, runConversations.get(run.id)!))
          .then(() => set({ continuityError: null }))
          .catch(() => set({ continuityError: 'No se pudo guardar el checkpoint. Esta tarea puede no sobrevivir al reinicio.' }));
      }
      const settled = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
      if (!settled || settledRuns.has(run.id)) return;
      settledRuns.add(run.id);

      if (run.status === 'completed' && run.answer) {
        const reply: ChatMessage = {
          id: run.intelligence?.messageId??uid('msg'),
          role: 'assistant',
          content: run.answer,
          createdAt: Date.now(),
          ...(run.intelligence?{modelId:run.intelligence.modelId??'UNKNOWN'}:snapshot.routing ? { modelId: snapshot.routing.selectedModelId } : {}),
        };
        get().messages.push(reply);
        if(!run.intelligence?.mainRecorded)persistMessage(reply, run.intelligence?.providerId??snapshot.routing?.preferredProvider ?? null, run.id);
      } else if (run.status === 'cancelled') {
        const reply: ChatMessage = {
          id: uid('msg'), role: 'system',
          content: 'Agente detenido. Ninguna acción pendiente se ejecutó.',
          createdAt: Date.now(),
        };
        get().messages.push(reply); persistMessage(reply, null, run.id);
      } else if (run.status === 'failed') {
        const reply: ChatMessage = {
          id: uid('msg'), role: 'system',
          content: `La ejecución falló: ${run.error ?? 'error desconocido'}`,
          createdAt: Date.now(),
        };
        get().messages.push(reply); persistMessage(reply, null, run.id);
      }
      set({
        messages: [...get().messages],
        runs: [{ ...run }, ...get().runs.filter((r) => r.id !== run.id)].slice(0, 50),
      });
    });

    approvalEngine.subscribe((approval) => set({ approval }));
    auditService.subscribe(() => set({ audit: auditService.list().slice(0, 200) }));
  },

  setPermission: (permission) => {
    if (window.jarvis?.authority) { void window.jarvis.authority.choose(); return; }
    setSessionPermission(permission);
    const run = get().run;
    if (run) toolBroker.setPermission(run.id, permission);
    set({ permission });
  },

  setActivityExpanded: (activityExpanded) => set({ activityExpanded }),

  submit: (prompt) => {
    const text = prompt.trim();
    if (!text) return;
    get().bind();
    const userMessage: ChatMessage = { id: uid('msg'), role: 'user', content: text, createdAt: Date.now() };
    set({ messages: [...get().messages, userMessage] });
    void agentRuntime.start(text, { workspaceId: 'current', permission: get().permission });
    persistMessage(userMessage, null, agentRuntime.currentRun?.id ?? null);
  },

  /**
   * STOP AGENT. Order matters: halt input first (so a drag or a typing sequence
   * stops mid-motion), then cancel the run, then settle approvals.
   */
  stop: () => {
    void window.jarvis?.authority?.stop();
    desktopController.stop();
    agentRuntime.stop('Detenido por el usuario');
    approvalEngine.cancelAll();
  },

  pause: () => { agentRuntime.pause(); },
  resume: () => { agentRuntime.resume(); },

  resolveApproval: (verdict) => {
    approvalEngine.resolveCurrent(verdict);
  },

  clearConversation: () => {
    conversationId = uid('conversation');
    try { globalThis.localStorage?.setItem('jarvis.conversation.id', conversationId); } catch { /* optional */ }
    settledRuns.clear();
    agentRuntime.clear();
    auditService.clear();
    set({ messages: [GREETING], events: [], lanes: [], routing: null, run: null, runs: [], audit: [], approval: null });
  },
}));
