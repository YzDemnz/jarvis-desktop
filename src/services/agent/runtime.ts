import type { AgentRun, PermissionLevel, RoutingDecision, ToolResult } from '@/types';
import { AgentRuntime, ToolBroker, approvalEngine, auditService, toolRegistry } from '@/agent';
import { buildBridgeAdapters } from '@/agent/adapters/bridge';
import { buildMockAdapters } from '@/agent/adapters/mock';
import { heuristicRoute } from '@/services/ai/routing';
import { scriptFor } from '@/services/agent/scripts';
import { desktopController } from '@/services/desktop/desktopControl';
import { devController } from '@/services/dev/devController';
import { createCodingDelegate, noProposer } from '@/dev/coding';
import type { PatchProposer, ProposedEdit } from '@/dev/coding';
import type { ToolAdapter } from '@/agent/adapters/types';
import type { ToolId } from '@/types';

/** Session permission level, read by the adapters on every privileged call. */
let sessionLevel: PermissionLevel = 'ASSIST';
export function setSessionPermission(level: PermissionLevel): void {
  sessionLevel = level;
}
export function getSessionPermission(): PermissionLevel {
  return sessionLevel;
}

const bridge = typeof window !== 'undefined' ? window.jarvis : undefined;

export const hasRealAgent = Boolean(bridge?.agent);

export const toolBroker = new ToolBroker({
  registry: toolRegistry,
  audit: auditService,
  approvals: approvalEngine,
  adapters: bridge?.agent && bridge.browser
    ? buildBridgeAdapters(bridge.agent, bridge.browser, () => sessionLevel)
    : buildMockAdapters(),
});

/** The run the desktop tools are currently bound to. */
let currentRunId = '';

// Desktop tools come from whichever controller hosts them. In production that
// is main over IPC (and main enforces its own gate); in the harness it is the
// in-process service with the fake Windows adapter.
toolBroker.registerAll(desktopController.adapters(() => sessionLevel, () => currentRunId));
const desktopPolicy = desktopController.policy();
if (desktopPolicy) toolBroker.addPolicy(desktopPolicy);

// Developer tools resolve their controller at call time: main over IPC in
// production, the in-memory service in the harness.
const DEV_TOOLS: ToolId[] = [
  'project.discover', 'project.list', 'project.inspect', 'project.open', 'project.checks', 'project.verify', 'code.search', 'code.searchText', 'code.searchFiles',
  'code.findReferences', 'code.findDefinition', 'code.context', 'file.read', 'file.proposePatch', 'file.create', 'file.write', 'file.patch',
  'file.rename', 'file.move', 'file.copy', 'directory.create', 'file.trash', 'terminal.execute', 'terminal.output', 'process.start',
  'process.status', 'process.logs', 'process.stop', 'dev.tools', 'git.status', 'git.diff', 'git.log', 'git.branch', 'git.show', 'git.add',
  'git.restore', 'git.checkoutFile', 'git.commit', 'changes.review', 'changes.revert', 'changes.undoLast',
];
toolBroker.registerAll(Object.fromEntries(DEV_TOOLS.map((id) => [id, (async (args: never, ctx) => {
  const adapter = devController().adapters(() => sessionLevel, () => currentRunId)[id as ToolId] as ToolAdapter<never, unknown> | undefined;
  if (!adapter) throw new Error('El agente de desarrollo no está disponible en este entorno.');
  return adapter(args, ctx);
}) as ToolAdapter<never, unknown>])));
toolBroker.addPolicy(async (input) => devController().policy()?.(input) ?? { ok: true });

/** Local model proposals (main), a scripted proposer in the harness, or none. */
let proposalIdentity: {providerId: string; model: string | null} | null = null;
let proposer: PatchProposer = bridge?.dev
  ? {
      available: true,
      identity: () => proposalIdentity,
      propose: async (input) => {
        proposalIdentity = null;
        const r = await bridge.dev!.propose(input, currentRunId);
        proposalIdentity = r.identity ?? null;
        return r.status === 'ok' ? (r.proposal as { edits: ProposedEdit[]; rationale: string }) : null;
      },
    }
  : noProposer;
export function setPatchProposer(p: PatchProposer): void { proposer = p; }
let maxRepairIterations = 3;
export function setMaxRepairIterations(n: number): void { maxRepairIterations = Math.max(1, Math.min(10, n)); }

/**
 * Classification goes to the main process when it exists, because that is where
 * Ollama can be reached. Without the bridge, or when the daemon is offline, the
 * heuristic answers instead — the app never blocks on a missing model.
 */
async function route(prompt: string, signal: AbortSignal): Promise<RoutingDecision> {
  if (!bridge?.agent) return heuristicRoute(prompt);
  try {
    const decision = await bridge.agent.route(prompt, undefined, agentRuntime.snapshot().run?.id);
    if (signal.aborted) return decision;
    return decision;
  } catch {
    return heuristicRoute(prompt);
  }
}

/**
 * Builds the reply from what actually happened. Steps that were refused or
 * failed are reported plainly instead of being papered over — a run that could
 * not read the disk should say so, not invent a result.
 */
async function compose(run: AgentRun, results: Map<string, ToolResult>): Promise<string> {
  const delegate = run.steps.find((step) => step.kind === 'delegate');
  if (delegate) {
    const identity = (results.get(delegate.id)?.data as {identity?: {providerId: string; model: string | null}} | undefined)?.identity;
    if (identity) run.intelligence = {providerId: identity.providerId, modelId: identity.model, messageId: run.id + ':coding-answer', mainRecorded: false};
    return delegate.summary ?? delegate.error ?? 'La tarea delegada terminó sin un resultado verificable.';
  }
  if (!run.steps.some(step => step.toolId) && bridge?.bootstrap) {
    try { const answer=await bridge.bootstrap.answer(run.id, run.prompt);run.intelligence={providerId:answer.providerId,modelId:answer.model,messageId:answer.messageId,mainRecorded:answer.mainRecorded};return answer.text; }
    catch { return 'La inteligencia no está operativa o su política impide esta respuesta. Puedes conectarla o verificar IA local en Ajustes → IA local. Las herramientas de JARVIS siguen disponibles.'; }
  }
  const lines: string[] = [];

  for (const step of run.steps) {
    if (!step.toolId) continue;
    const result = results.get(step.id);
    if (!result) continue;

    if (!result.ok) {
      if (result.reason === 'permission_denied') {
        lines.push(`No pude ejecutar ${step.toolId}: el nivel de permiso actual no lo permite.`);
      } else if (result.reason === 'tool_disabled' || result.reason === 'not_implemented') {
        lines.push(`${step.toolId} está declarada pero deshabilitada en esta versión.`);
      } else if (result.reason === 'approval_denied') {
        lines.push(`Cancelaste la aprobación de ${step.toolId}, así que no hice nada.`);
      } else {
        lines.push(`${step.toolId} falló: ${result.error ?? 'error desconocido'}.`);
      }
      continue;
    }

    const data = result.data;
    if (step.toolId === 'filesystem.search' && Array.isArray(data)) {
      const entries = data as { name: string; path: string; kind: string }[];
      if (!entries.length) {
        lines.push('No encontré nada que coincida bajo las rutas que puedo leer.');
      } else {
        lines.push(`Encontré ${entries.length} coincidencia${entries.length === 1 ? '' : 's'}:`);
        entries.slice(0, 5).forEach((e) => lines.push(`· ${e.name} — ${e.path}`));
        if (entries.length > 5) lines.push(`…y ${entries.length - 5} más. Los tienes todos en Files.`);
      }
    } else if (step.toolId === 'filesystem.readText' && data) {
      const read = data as {path:string;text:string;truncated:boolean};
      lines.push('Texto leído de ' + read.path + (read.truncated ? ' (fragmento acotado)' : '') + ':\n' + read.text);
    } else if (step.toolId === 'app.list' && Array.isArray(data)) {
      const apps = data as { name: string }[];
      lines.push(apps.length
        ? `Aplicaciones que coinciden: ${apps.slice(0, 5).map((a) => a.name).join(', ')}.`
        : 'No encontré ninguna aplicación que coincida.');
    } else if (step.toolId === 'browser.getActiveTab' && data) {
      const tab = data as { title: string; url: string };
      lines.push(`Pestaña activa: ${tab.title} (${tab.url}).`);
    } else if (step.toolId === 'browser.getPageText' && typeof data === 'string') {
      const words = data.trim().split(/\s+/).length;
      lines.push(`Leí la página: unas ${words} palabras.`);
    } else if ((step.toolId === 'project.open' || step.toolId === 'project.inspect') && data) {
      const project = data as {name?: string; files?: number; technologies?: string[]};
      lines.push(`Proyecto ${project.name ?? 'consultado'}: ${project.files ?? 'UNKNOWN'} archivos indexados; tecnologías detectadas: ${(project.technologies ?? []).join(', ') || 'UNKNOWN'}. Esta consulta no demuestra que las pruebas pasen.`);
    } else if (step.toolId === 'system.getInfo' && data) {
      const info = data as { platform: string; cpuCount: number; totalMemory: number };
      lines.push(`Sistema ${info.platform}, ${info.cpuCount} núcleos, ${Math.round(info.totalMemory / 1e9)} GB de RAM.`);
    }
  }

  if (lines.length) return [...new Set(lines)].join('\n');

  if (bridge?.agent) return 'La consulta terminó. No hay un resultado comprobado que permita concluir más. Revisa los pasos y sus resultados; no se aplicó un parche por esta consulta.';
  // Scripted demo answers are restricted to the browser-only demonstration.
  const script = scriptFor(
    (run.steps[0]?.summary?.split(' ')[0] as never) ?? ('chat' as never),
    run.prompt,
  );
  return script.answer;
}

export const agentRuntime = new AgentRuntime({
  prepareRun: bridge?.authority ? async (id, text) => {
    const state = await bridge.authority.begin(id, text);
    if (state.run?.strongRequired) throw new Error('STRONG_REQUIRED_NO_ATTESTED_BACKEND');
    setSessionPermission(state.accessMode); return state.accessMode;
  } : undefined,
  broker: toolBroker,
  route,
  compose,
  // Desktop control is bound to a visible run and follows it exactly: no run,
  // no control. Pause, resume and finish move in lockstep.
  onStart: (runId) => { currentRunId = runId; },
  delegates: { coding: (ctx) => createCodingDelegate({ proposer: () => proposer, maxRepairIterations })(ctx),
    workbench:async ctx=>{if(!bridge?.workbench)return {ok:false,summary:'El controlador de documentos y multimedia no está disponible.'};ctx.note('JARVIS conserva el control y delega únicamente las capacidades seleccionadas.');const receipt=await bridge.workbench.run(ctx.runId,ctx.prompt);ctx.token.throwIfCancelled();return {ok:!['FAILED','BLOCKED','STOPPED'].includes(receipt.state),summary:receipt.answer,data:receipt};} },
  // Control is bound only when the fixed plan contains a tool that changes the
  // desktop. A file search never shows "JARVIS CONTROL", and a desktop action
  // that was not in the plan finds no bound run and is refused.
  onPlan: (runId, steps) => {
    const drivesDesktop = steps.some((s) => s.toolId && toolBroker.registry.get(s.toolId)?.interactive);
    if (drivesDesktop) desktopController.bindRun(runId);
  },
  onFinish: (runId) => { desktopController.releaseRun(runId); if (currentRunId === runId) currentRunId = ''; },
  // STOP reaches running commands and the dev servers this run started.
  onCancel: (runId) => { void devController().cancelRun(runId); },
  onPause: () => desktopController.pause(),
  onResume: () => desktopController.resume(),
});

// The user grabbing the mouse pauses the run — never a fight over the cursor.
desktopController.onHumanOverride(() => { agentRuntime.pause('Pausado: tomaste el control del ratón o el teclado.'); });

export { desktopController };
export { approvalEngine, auditService, toolRegistry };
