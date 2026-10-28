import type { AgentStep, RoutingDecision, ToolId } from '@/types';
import { uid } from '@/lib/id';
import { appIdFromText } from '@/desktop/appIds';
import {workPlan} from '../workbench/contracts';

export interface PlanInput {
  runId: string;
  prompt: string;
  routing: RoutingDecision;
}

interface PlannedStep {
  kind: AgentStep['kind'];
  title: string;
  toolId?: ToolId;
  args?: unknown;
  delegate?: string;
}

/** Delegates the planner may emit. Anything else never reaches the runtime. */
const DELEGATES = ['coding','workbench'];

/** Everything the planner may emit. A tool outside this set is never planned. */
const PLANNABLE: ToolId[] = [
  'filesystem.search', 'filesystem.list', 'filesystem.getDrives', 'filesystem.readText',
  'browser.getActiveTab', 'browser.getPageText', 'browser.navigate',
  'system.getInfo', 'process.list', 'app.list',
  'app.launch', 'window.find', 'window.list', 'window.active', 'ui.inspect', 'ui.find', 'desktop.snapshot',
  'project.list', 'project.open', 'project.inspect', 'git.status', 'changes.review', 'changes.undoLast', 'code.findDefinition', 'code.findReferences', 'code.searchFiles',
];

/**
 * Developer requests. Direct questions map to one read tool; anything that
 * asks to change or verify code becomes a single `coding` delegate step,
 * which decides its sub-steps at run time (UNDERSTAND → CHANGE → VERIFY)
 * — each of them still a broker call.
 */
export function devPlan(prompt: string, taskType: string): PlannedStep[] | null {
  const p = prompt.toLowerCase();
  const symbol = prompt.match(/(?:s[ií]mbolo|symbol|definici[oó]n de|define)\s+([A-Za-z_$][\w$]*)/i)?.[1];
  if (/\bgit status\b|estado de git/.test(p)) return [{ kind: 'tool', title: 'Revisando el estado de Git', toolId: 'git.status', args: {} }, { kind: 'inspect', title: 'Revisando cambios' }];
  if (/(deshaz|deshacer|undo|revierte|revertir).*(cambio|jarvis|change)/.test(p)) return [{ kind: 'tool', title: 'Deshaciendo el último cambio de JARVIS', toolId: 'changes.undoLast', args: {} }];
  if (/(muestra|mu[eé]strame|ver|show|revisa).*(cambios|changes|diff)/.test(p) && !/(corrige|arregla|fix)/.test(p)) return [{ kind: 'tool', title: 'Revisando los cambios de JARVIS', toolId: 'changes.review', args: {} }];
  if (symbol) return [{ kind: 'tool', title: `Buscando la definición de ${symbol}`, toolId: 'code.findDefinition', args: { symbol } }, { kind: 'tool', title: `Buscando referencias de ${symbol}`, toolId: 'code.findReferences', args: { symbol } }];
  const mentionsProject = /(proyecto|project|repo|c[oó]digo|code|build|pruebas|tests?\b|typescript|componente|component|npm)/.test(p);
  // A file search inside the open project — but "busca el archivo X en mis
  // documentos" is a general filesystem search, not a developer request.
  const fileQuery = prompt.match(/(?:find file|busca(?:r)? (?:el )?archivo)\s+([\w./-]+)/i)?.[1];
  if (fileQuery && (/\bfind file\b/i.test(prompt) || mentionsProject)) return [{ kind: 'tool', title: `Buscando el archivo ${fileQuery}`, toolId: 'code.searchFiles', args: { query: fileQuery } }];
  // "Review without changing it" is read-only: inspect, status, checks — no delegate.
  // Resource constraints do not cancel an explicit request to repair source.
  const constraints = p.match(/(?:sin|no) (?:cambiar|modificar|tocar|cambies|modifiques|toques|actualices|a[nñ]adas|instales)? ?(?:las |los )?(?:dependencias|paquetes|deps|package\.json|lockfile|pruebas|tests)(?:\s*(?:,|ni|y)\s*(?:las |los )?(?:dependencias|paquetes|deps|pruebas|tests))*|(?:don'?t|do not|without) (?:change|changing|modify|modifying|touch|add|update)(?: any)? (?:dependencies|packages|deps|tests)(?: and (?:dependencies|packages|deps|tests))*/g) ?? [];
  const intent = constraints.reduce((text, constraint) => text.replace(constraint, ''), p);
  const readOnly = /(sin (modificar|cambiar|tocar)|no (modifiques|cambies nada|toques)|s[oó]lo (revisa|lee|mira)|without (changing|modifying)|read[- ]only)/.test(intent);
  if (readOnly && mentionsProject) {
    return [
      { kind: 'tool', title: 'Abriendo el proyecto', toolId: 'project.open', args: { project: prompt } },
      { kind: 'tool', title: 'Inspeccionando el proyecto', toolId: 'project.inspect', args: {} },
      { kind: 'tool', title: 'Revisando el estado de Git', toolId: 'git.status', args: {} },
      { kind: 'inspect', title: 'Resumiendo sin modificar nada' },
    ];
  }
  const coding = /(corrige|arregla|repara|fix|falla|error|build|compila|typecheck|pruebas|tests?\b|refactoriza|implementa|renombra|cambia|modifica)/.test(p) || taskType === 'code_debugging' || taskType === 'code_generation';
  if (coding && mentionsProject) {
    const noDependencies = constraints.some(c => /dependencias|paquetes|deps|package\.json|lockfile|dependencies|packages/.test(c));
    const noCheckChanges = constraints.some(c => /pruebas|tests/.test(c));
    return [{ kind: 'delegate', title: 'Trabajando en el proyecto', delegate: 'coding', args: { project: prompt, goal: prompt, constraints: {noDependencies, noCheckChanges} } }];
  }
  if (/(abre|abrir|open).*(proyecto|project)/.test(p)) return [{ kind: 'tool', title: 'Abriendo el proyecto', toolId: 'project.open', args: { project: prompt } }, { kind: 'inspect', title: 'Revisando el proyecto' }];
  if (/(mis proyectos|lista.*proyectos|list projects)/.test(p)) return [{ kind: 'tool', title: 'Listando proyectos', toolId: 'project.list', args: {} }];
  return null;
}

/**
 * Turns a routing decision into an ordered plan. Deliberately rule-based: the
 * model classifies, the planner decides, and the broker enforces. Letting a
 * model emit the plan directly would put tool selection inside the thing we do
 * not trust.
 */
export function planRun(input: PlanInput): AgentStep[] {
  const { runId, prompt, routing } = input;
  const planned: PlannedStep[] = [{ kind: 'classify', title: 'Clasificando la petición' }];
  const localFile = prompt.match(/"([A-Za-z]:[\\/][^"\r\n]+)"/)?.[1];
  const readPlan: PlannedStep[] | null = localFile && /\b(lee|leer|read|resume|resumir|contenido)\b/i.test(prompt)
    ? [{kind:'tool',title:'Leyendo el texto solicitado',toolId:'filesystem.readText',args:{path:localFile}}] : null;

  // "Abre VS Code…" is desktop control, not a project request.
  const workspace=workPlan(prompt);
  const dev = workspace?[{kind:'delegate' as const,title:'Coordinando documentos y multimedia',delegate:'workbench',args:{}}]:readPlan ?? (routing.taskType === 'computer_control' && appIdFromText(prompt) ? null : devPlan(prompt, routing.taskType));
  if (dev) planned.push(...dev);
  else switch (routing.taskType) {
    case 'file_search': {
      const query = extractQuery(prompt);
      planned.push({ kind: 'tool', title: `Buscando «${query}»`, toolId: 'filesystem.search', args: { query, limit: 40 } });
      planned.push({ kind: 'inspect', title: 'Revisando resultados' });
      break;
    }
    case 'computer_control': {
      const app = appIdFromText(prompt);
      if (app) {
        // Indices are fixed by construction: 0 classify, 1 find, 2 launch, 3 locate, 4 inspect.
        planned.push({ kind: 'tool', title: `Buscando ${app.name}`, toolId: 'app.list', args: { query: app.name } });
        planned.push({ kind: 'tool', title: `Abriendo ${app.name}`, toolId: 'app.launch', args: { appId: app.id } });
        // Found by process name via the stable id: titles change, processes don't.
        planned.push({ kind: 'tool', title: 'Localizando su ventana', toolId: 'window.find', args: { appId: app.id } });
        planned.push({ kind: 'tool', title: 'Inspeccionando la ventana', toolId: 'ui.inspect', args: { windowId: { $from: 3, path: '0.windowId' }, depth: 4 } });
        planned.push({ kind: 'inspect', title: 'Comprobando el resultado' });
      } else {
        planned.push({ kind: 'tool', title: 'Revisando el escritorio', toolId: 'desktop.snapshot', args: {} });
        planned.push({ kind: 'tool', title: 'Buscando la aplicación', toolId: 'app.list', args: { query: extractQuery(prompt) } });
        planned.push({ kind: 'inspect', title: 'Revisando coincidencias' });
      }
      break;
    }
    case 'web_research': {
      planned.push({ kind: 'tool', title: 'Leyendo la pestaña activa', toolId: 'browser.getActiveTab', args: {} });
      planned.push({ kind: 'tool', title: 'Extrayendo el texto de la página', toolId: 'browser.getPageText', args: {} });
      planned.push({ kind: 'inspect', title: 'Resumiendo lo leído' });
      break;
    }
    default:
      planned.push({ kind: 'inspect', title: 'Preparando la respuesta' });
      break;
  }

  planned.push({ kind: 'respond', title: 'Redactando la respuesta' });

  return planned
    .filter((step) => (!step.toolId || PLANNABLE.includes(step.toolId)) && (step.kind !== 'delegate' || DELEGATES.includes(step.delegate ?? '')))
    .map((step, index) => ({
      id: uid('step'),
      runId,
      index,
      kind: step.kind,
      title: step.title,
      status: 'queued' as const,
      ...(step.toolId ? { toolId: step.toolId } : {}),
      ...(step.args !== undefined ? { args: step.args } : {}),
      ...(step.delegate ? { delegate: step.delegate } : {}),
    }));
}

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'mi', 'mis', 'su', 'para', 'por', 'con',
  'busca', 'buscar', 'encuentra', 'encontrar', 'localiza', 'abre', 'abrir', 'quiero', 'dame',
  'proyecto', 'archivo', 'carpeta', 'que', 'se', 'llama', 'llamado', 'pc', 'equipo', 'disco',
]);

/** Pulls the thing being looked for out of a sentence. */
export function extractQuery(prompt: string): string {
  const quoted = prompt.match(/["«“']([^"»”']{2,})["»”']/);
  if (quoted?.[1]) return quoted[1].trim();

  const filename = prompt.match(/[\w.-]+\.(json|ts|tsx|js|md|csv|pdf|png|jpg|zip|xlsx|txt|ini|yml|yaml)\b/i);
  if (filename?.[0]) return filename[0];

  const words = prompt
    .split(/\s+/)
    .map((w) => w.replace(/[.,;:!¡¿?]/g, ''))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));

  return words.slice(0, 3).join(' ') || prompt.trim().slice(0, 40);
}
