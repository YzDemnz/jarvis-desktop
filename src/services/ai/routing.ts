import { appIdFromText } from '@/desktop/appIds';
import type { ModelTier, RoutingDecision, TaskType, ToolId } from '@/types';
import { routePrompt } from './ModelRouter';

/**
 * Coarse buckets the fallback classifier must be able to tell apart. The
 * structured router produces richer output, but everything collapses to one of
 * these when Ollama is not available.
 */
export const ROUTER_CATEGORIES = [
  'browser', 'filesystem', 'coding', 'market', 'research', 'system', 'general_ai',
] as const;

export type RouterCategory = (typeof ROUTER_CATEGORIES)[number];

const CATEGORY_TASK: Record<RouterCategory, TaskType> = {
  browser: 'web_research',
  filesystem: 'file_search',
  coding: 'code_debugging',
  market: 'market_analysis',
  research: 'web_research',
  system: 'computer_control',
  general_ai: 'chat',
};

const TASK_CATEGORY: Record<TaskType, RouterCategory> = {
  chat: 'general_ai',
  code_generation: 'coding',
  code_debugging: 'coding',
  web_research: 'research',
  market_analysis: 'market',
  file_search: 'filesystem',
  computer_control: 'system',
  summarization: 'general_ai',
  vision: 'general_ai',
  planning: 'general_ai',
};

/** Tools the router is allowed to *suggest*. It can never run them. */
const SUGGESTIBLE: ToolId[] = [
  'filesystem.search', 'filesystem.list', 'filesystem.stat', 'filesystem.getDrives',
  'browser.getActiveTab', 'browser.getPageText', 'browser.navigate', 'browser.back', 'browser.forward',
  'system.getInfo', 'process.list', 'app.list',
];

const TOOLS_BY_TASK: Partial<Record<TaskType, ToolId[]>> = {
  file_search: ['filesystem.search'],
  web_research: ['browser.getActiveTab', 'browser.getPageText'],
  computer_control: ['system.getInfo', 'app.list'],
};

const TASK_TYPES: TaskType[] = [
  'chat', 'code_generation', 'code_debugging', 'web_research', 'market_analysis',
  'file_search', 'computer_control', 'summarization', 'vision', 'planning',
];

const TIERS: ModelTier[] = ['LOCAL', 'FAST', 'STANDARD', 'REASONING', 'MAX'];

/* ------------------------------------------------------------------ */
/* Prompt for the local model                                          */
/* ------------------------------------------------------------------ */

export const ROUTER_SYSTEM_PROMPT = [
  'Eres un clasificador. No resuelves la petición, sólo la describes.',
  'Respondes ÚNICAMENTE con un objeto JSON, sin texto alrededor y sin explicaciones.',
  'Campos obligatorios: taskType, difficulty, requiresWeb, requiresFiles, requiresVision,',
  'requiresCode, requiresReasoning, suggestedTier, tools.',
  `taskType debe ser uno de: ${TASK_TYPES.join(', ')}.`,
  'difficulty es un entero de 1 a 10.',
  `suggestedTier debe ser uno de: ${TIERS.join(', ')}.`,
  `tools es un array, posiblemente vacío, con elementos de: ${SUGGESTIBLE.join(', ')}.`,
  'No inventes herramientas. No añadas campos.',
].join(' ');

export function buildRouterPrompt(prompt: string): string {
  return `Clasifica esta petición del usuario:\n\n"""${prompt.slice(0, 2000)}"""\n\nJSON:`;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface RouterPayload {
  taskType: TaskType;
  difficulty: number;
  requiresWeb: boolean;
  requiresFiles: boolean;
  requiresVision: boolean;
  requiresCode: boolean;
  requiresReasoning: boolean;
  suggestedTier: ModelTier;
  tools: ToolId[];
}

/**
 * Anything a model produces is untrusted input. A payload that fails any check
 * is rejected whole rather than patched, so a half-understood classification
 * never reaches the planner.
 */
export function validateRouterPayload(raw: unknown): RouterPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  const taskType = value.taskType;
  if (typeof taskType !== 'string' || !TASK_TYPES.includes(taskType as TaskType)) return null;

  const difficultyRaw = value.difficulty;
  const difficulty = typeof difficultyRaw === 'number'
    ? difficultyRaw
    : typeof difficultyRaw === 'string' ? Number(difficultyRaw) : NaN;
  if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 10) return null;

  const tier = value.suggestedTier;
  if (typeof tier !== 'string' || !TIERS.includes(tier as ModelTier)) return null;

  const flag = (key: string): boolean | null => {
    const v = value[key];
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  };
  const requiresWeb = flag('requiresWeb');
  const requiresFiles = flag('requiresFiles');
  const requiresVision = flag('requiresVision');
  const requiresCode = flag('requiresCode');
  const requiresReasoning = flag('requiresReasoning');
  if ([requiresWeb, requiresFiles, requiresVision, requiresCode, requiresReasoning].some((f) => f === null)) {
    return null;
  }

  // Unknown tool ids are dropped, not rejected: a hallucinated name should not
  // discard an otherwise sound classification, but it must never survive.
  const toolsRaw = Array.isArray(value.tools) ? value.tools : [];
  const tools = toolsRaw
    .filter((t): t is string => typeof t === 'string')
    .filter((t) => (SUGGESTIBLE as string[]).includes(t))
    .slice(0, 6) as ToolId[];

  return {
    taskType: taskType as TaskType,
    difficulty: Math.round(difficulty),
    requiresWeb: requiresWeb as boolean,
    requiresFiles: requiresFiles as boolean,
    requiresVision: requiresVision as boolean,
    requiresCode: requiresCode as boolean,
    requiresReasoning: requiresReasoning as boolean,
    suggestedTier: tier as ModelTier,
    tools,
  };
}

/** Turns a validated payload into the decision the rest of the app consumes. */
export function payloadToDecision(
  payload: RouterPayload,
  prompt: string,
  meta: { elapsedMs: number; model: string },
): RoutingDecision {
  const base = routePrompt(prompt, prompt.length);
  const tools = payload.tools.length ? payload.tools : TOOLS_BY_TASK[payload.taskType] ?? [];
  return {
    ...base,
    taskType: payload.taskType,
    difficulty: payload.difficulty,
    requiresWeb: payload.requiresWeb,
    requiresFiles: payload.requiresFiles,
    requiresVision: payload.requiresVision,
    requiresCode: payload.requiresCode,
    requiresReasoning: payload.requiresReasoning,
    preferredProvider: 'local',
    modelTier: 'LOCAL',
    selectedModelId: meta.model,
    reason: `Clasificado por el router local (${meta.model})`,
    routedBy: 'ollama',
    elapsedMs: meta.elapsedMs,
    suggestedTools: tools as string[],
  };
}

/* ------------------------------------------------------------------ */
/* Heuristic fallback                                                  */
/* ------------------------------------------------------------------ */

const CATEGORY_SIGNALS: { category: RouterCategory; re: RegExp }[] = [
  { category: 'market', re: /\b(nvidia|nvda|amd|tsm|btc|eth|acci[oó]n|acciones|bolsa|mercado|ticker|cotiza|precio de|invertir|trading)\b/i },
  { category: 'coding', re: /\b(c[oó]digo|bug|error|stack|excepci[oó]n|compila|typescript|javascript|python|refactor|depura|commit|rama|funci[oó]n|componente)\b/i },
  { category: 'filesystem', re: /\b(archivo|archivos|carpeta|directorio|ruta|disco|unidad|en mi (pc|equipo|disco))\b|\.(json|ts|tsx|js|md|csv|pdf|png|zip|xlsx|txt)\b/i },
  { category: 'system', re: /\b(abre|abrir|ejecuta|lanza|cierra|instala|proceso|procesos|memoria|cpu|sistema operativo|versi[oó]n de windows)\b/i },
  { category: 'browser', re: /\b(p[aá]gina|pesta[nñ]a|navega|url|sitio web|esta web|este sitio|enlace)\b|https?:\/\//i },
  { category: 'research', re: /\b(investiga|documentaci[oó]n|noticias|qu[eé] dicen|resume|resumen|fuentes|compara)\b/i },
];

const LAUNCH_VERB = /\b(abre|abrir|ábreme|abreme|lanza|lanzar|inicia|iniciar|ejecuta|ejecutar|arranca|open|launch|start)\b/i;

/** "Abre VS Code…": a launch verb plus a known app. */
export function launchesKnownApp(prompt: string): boolean {
  return LAUNCH_VERB.test(prompt) && appIdFromText(prompt) !== null;
}

export function heuristicCategory(prompt: string): RouterCategory {
  // "Abre VS Code, busca Vigilia y abre package.json" is about driving an app,
  // even though it names a file. A launch verb plus a known app wins first.
  if (launchesKnownApp(prompt)) return 'system';
  for (const { category, re } of CATEGORY_SIGNALS) {
    if (re.test(prompt)) return category;
  }
  return 'general_ai';
}

/**
 * Works with no daemon, no network and no model. This is what keeps JARVIS
 * usable when Ollama is offline, which is the normal case on a fresh machine.
 */
export function heuristicRoute(prompt: string, contextSize = prompt.length): RoutingDecision {
  const started = Date.now();
  const base = routePrompt(prompt, contextSize);
  const category = heuristicCategory(prompt);

  // The keyword table in ModelRouter is more specific than the coarse buckets,
  // so it wins where it produced something other than a plain chat.
  // Except when the prompt launches a known app: that is computer control no
  // matter which file or search words come after it.
  const taskType: TaskType = launchesKnownApp(prompt) ? 'computer_control'
    : base.taskType === 'chat' ? CATEGORY_TASK[category] : base.taskType;
  const tools = TOOLS_BY_TASK[taskType] ?? [];

  return {
    ...base,
    taskType,
    preferredProvider: 'local',
    modelTier: 'LOCAL',
    selectedModelId: 'local/heuristic',
    reason: `Clasificador heurístico local (${category})`,
    routedBy: 'heuristic',
    confidence: Math.min(base.confidence, 0.72),
    elapsedMs: Math.max(1, Date.now() - started),
    suggestedTools: tools as string[],
  };
}

export function categoryOf(decision: RoutingDecision): RouterCategory {
  return TASK_CATEGORY[decision.taskType] ?? 'general_ai';
}

export { CATEGORY_TASK, SUGGESTIBLE as ROUTER_SUGGESTIBLE_TOOLS, TOOLS_BY_TASK };
