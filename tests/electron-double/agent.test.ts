import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentRun, PermissionLevel, RoutingDecision, ToolDefinition, ToolResult } from '../../src/types';
import { AgentRuntime } from '../../src/agent/AgentRuntime';
import { ToolBroker } from '../../src/agent/ToolBroker';
import { ToolRegistry, TOOL_DEFINITIONS } from '../../src/agent/registry';
import { PermissionEngine, permissionRank } from '../../src/agent/permissions';
import { ApprovalEngine } from '../../src/agent/ApprovalEngine';
import { AuditService } from '../../src/agent/AuditService';
import { CancellationToken } from '../../src/agent/cancellation';
import { redactString, redactValue, summarizeArgs, REDACTED } from '../../src/agent/redaction';
import { planRun, extractQuery } from '../../src/agent/planner';
import {
  heuristicCategory, heuristicRoute, validateRouterPayload, payloadToDecision, ROUTER_CATEGORIES,
} from '../../src/services/ai/routing';
import { FileSystemService } from '../../electron/agent/FileSystemService';
import { ApplicationService } from '../../electron/agent/ApplicationService';
import { SystemService } from '../../electron/agent/SystemService';
import { OllamaProvider, parseJsonLoose } from '../../electron/agent/OllamaProvider';

let pass = 0, fail = 0;
const t = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* Helpers ------------------------------------------------------------ */

function makeBroker(overrides: Partial<Record<string, unknown>> = {}) {
  const audit = new AuditService();
  const approvals = new ApprovalEngine();
  const registry = new ToolRegistry(TOOL_DEFINITIONS);
  const broker = new ToolBroker({ registry, audit, approvals, permissions: new PermissionEngine() });
  broker.registerAll({
    'filesystem.search': async (args: { query: string }) => [{ name: `${args.query}.txt`, path: `D:/x/${args.query}.txt`, kind: 'file' }],
    'filesystem.list': async () => [],
    'system.getInfo': async () => ({ platform: 'test', cpuCount: 4, totalMemory: 8e9 }),
    'app.list': async () => [{ id: 'code', name: 'Visual Studio Code', path: 'C:/code.lnk', source: 'start-menu' }],
    'browser.getActiveTab': async () => ({ id: 'tab-1', url: 'https://a.dev', title: 'A', loading: false }),
    'browser.getPageText': async () => 'hola mundo del navegador',
    ...overrides,
  });
  return { broker, audit, approvals, registry };
}

const ROUTING: RoutingDecision = {
  taskType: 'file_search', difficulty: 2, contextSize: 20, requiresWeb: false, requiresVision: false,
  requiresFiles: true, requiresCode: false, requiresReasoning: false, preferredProvider: 'local',
  modelTier: 'LOCAL', selectedModelId: 'test', reason: 'test', confidence: 0.9,
  routedBy: 'heuristic', elapsedMs: 1,
};

function makeRuntime(broker: ToolBroker, routing: RoutingDecision = ROUTING) {
  return new AgentRuntime({
    broker,
    route: async () => routing,
    compose: (run: AgentRun, results: Map<string, ToolResult>) =>
      `pasos:${run.steps.length} resultados:${results.size}`,
  });
}

/* ==================================================================== */
console.log('\n— Permisos —');
const engine = new PermissionEngine();
const registry = new ToolRegistry(TOOL_DEFINITIONS);
const fsSearch = registry.get('filesystem.search')!;
const fsDelete = registry.get('filesystem.delete')!;
const credential = registry.get('credential.show')!;

t('jerarquía ordenada', permissionRank('OBSERVE') < permissionRank('ASSIST')
  && permissionRank('ASSIST') < permissionRank('CONTROL')
  && permissionRank('CONTROL') < permissionRank('ADMIN'));
t('OBSERVE no alcanza para filesystem.search', !engine.check(fsSearch, 'OBSERVE').allowed);
t('ASSIST sí alcanza', engine.check(fsSearch, 'ASSIST').allowed);
t('ADMIN no resucita una herramienta deshabilitada', !engine.check(fsDelete, 'ADMIN').allowed);
t('el motivo nombra la herramienta', String((engine.check(fsDelete, 'ADMIN') as { reason: string }).reason).includes('Eliminar'));
t('CRITICAL sigue bloqueada en ADMIN', !engine.check(credential, 'ADMIN').allowed);
t('herramienta desconocida se rechaza', !engine.check(undefined, 'ADMIN').allowed);
t('DESTRUCTIVE exige aprobación', engine.needsApproval(fsDelete));
t('SAFE no exige aprobación', !engine.needsApproval(fsSearch));

console.log('\n— Registro de herramientas —');
t('todas las definiciones tienen id, riesgo y permiso',
  TOOL_DEFINITIONS.every((d: ToolDefinition) => d.id && d.risk && d.requiredPermission && d.category));
t('ids únicos', new Set(TOOL_DEFINITIONS.map((d) => d.id)).size === TOOL_DEFINITIONS.length);
t('ninguna CRITICAL está habilitada', TOOL_DEFINITIONS.filter((d) => d.risk === 'CRITICAL').every((d) => !d.enabled));
t('fs.delete declarada pero inerte', !fsDelete.enabled && !fsDelete.implemented);
t('terminal.run declarada pero inerte', !registry.get('terminal.run')!.enabled);
t('process.terminate declarada pero inerte', !registry.get('process.terminate')!.enabled);
t('availableAt(OBSERVE) excluye ASSIST', !registry.availableAt('OBSERVE').some((d) => d.id === 'filesystem.search'));
t('availableAt(ADMIN) nunca incluye deshabilitadas', registry.availableAt('ADMIN').every((d) => d.enabled));
let threw = false;
try { new ToolBroker({ registry }).register('herramienta.inventada', async () => null); } catch { threw = true; }
t('registrar un id no declarado lanza', threw);

console.log('\n— Broker: bloqueos —');
{
  const { broker, audit } = makeBroker();
  const token = new CancellationToken();
  broker.openRun('run-1', 'OBSERVE', token);

  const escalation = await broker.execute({ runId: 'run-1', toolId: 'filesystem.search', args: { query: 'x' } });
  t('escalada de permisos bloqueada', !escalation.ok && escalation.reason === 'permission_denied', String(escalation.reason));

  const disabled = await broker.execute({ runId: 'run-1', toolId: 'filesystem.delete', args: { path: 'D:/x' } });
  t('herramienta deshabilitada bloqueada', !disabled.ok && disabled.reason === 'tool_disabled', String(disabled.reason));

  const unknown = await broker.execute({ runId: 'run-1', toolId: 'nope.nope', args: {} });
  t('tool id desconocido bloqueado', !unknown.ok && unknown.reason === 'tool_unknown', String(unknown.reason));

  const noRun = await broker.execute({ runId: 'run-inexistente', toolId: 'system.getInfo', args: {} });
  t('llamada sin run abierto bloqueada', !noRun.ok);

  const observable = await broker.execute({ runId: 'run-1', toolId: 'system.getInfo', args: {} });
  t('OBSERVE sí puede leer el sistema', observable.ok);

  broker.setPermission('run-1', 'ASSIST');
  const allowed = await broker.execute({ runId: 'run-1', toolId: 'filesystem.search', args: { query: 'vigilia' } });
  t('subir el nivel desbloquea', allowed.ok);
  broker.closeRun('run-1');

  const entries = audit.list('run-1');
  t('cada intento deja auditoría', entries.length >= 5, String(entries.length));
  t('la llamada sin run se audita aparte', audit.list('run-inexistente').length === 1);
  t('los bloqueos se auditan como blocked', entries.some((e) => e.result === 'blocked'));
  t('los éxitos se auditan como ok', entries.some((e) => e.result === 'ok'));
  t('la auditoría registra permiso y riesgo', entries.every((e) => e.permission && e.risk));
  t('la auditoría registra duración', entries.every((e) => typeof e.durationMs === 'number'));
}

console.log('\n— Aprobaciones —');
{
  // Una herramienta sensible con adaptador, para poder probar el flujo completo.
  const defs = TOOL_DEFINITIONS.map((d) => (d.id === 'app.launch' ? { ...d, enabled: true, implemented: true } : d));
  const reg = new ToolRegistry(defs);
  const approvals = new ApprovalEngine();
  const audit = new AuditService();
  const broker = new ToolBroker({ registry: reg, approvals, audit });
  let launched = 0;
  broker.register('app.launch', async () => { launched += 1; return { ok: true }; });

  const token = new CancellationToken();
  broker.openRun('run-a', 'ASSIST', token);

  // allow once
  const p1 = broker.execute({ runId: 'run-a', toolId: 'app.launch', args: { name: 'Blender' } });
  await sleep(5);
  t('se abre una solicitud de aprobación', approvals.pendingCount() === 1);
  t('la solicitud describe objetivo y riesgo',
    approvals.current()?.target === 'Blender' && approvals.current()?.risk === 'SENSITIVE');
  approvals.resolveCurrent('allow_once');
  const r1 = await p1;
  t('allow once ejecuta', r1.ok && launched === 1);

  // allow once no persiste
  const p2 = broker.execute({ runId: 'run-a', toolId: 'app.launch', args: { name: 'Obsidian' } });
  await sleep(5);
  t('allow once no se recuerda', approvals.pendingCount() === 1);
  approvals.resolveCurrent('allow_for_run');
  const r2 = await p2;
  t('allow for run ejecuta', r2.ok && launched === 2);

  // allow for run sí persiste
  const r3 = await broker.execute({ runId: 'run-a', toolId: 'app.launch', args: { name: 'Code' } });
  t('allow for run se recuerda dentro del run', r3.ok && launched === 3);
  t('ya no hay aprobaciones pendientes', approvals.pendingCount() === 0);

  // deny
  broker.closeRun('run-a');
  const token2 = new CancellationToken();
  broker.openRun('run-b', 'ASSIST', token2);
  const p4 = broker.execute({ runId: 'run-b', toolId: 'app.launch', args: { name: 'Blender' } });
  await sleep(5);
  approvals.resolveCurrent('deny');
  const r4 = await p4;
  t('deny bloquea la ejecución', !r4.ok && r4.reason === 'approval_denied', String(r4.reason));
  t('deny no ejecuta el adaptador', launched === 3);
  t('el permiso concedido no cruza de run', approvals.pendingCount() === 0);
  t('deny queda auditado', audit.list('run-b').some((e) => e.approval === 'denied'));

  // cancel entire run
  const p5 = broker.execute({ runId: 'run-b', toolId: 'app.launch', args: { name: 'Blender' } });
  await sleep(5);
  approvals.resolveCurrent('cancel_run');
  const r5 = await p5;
  t('cancel run cancela', !r5.ok && r5.reason === 'cancelled', String(r5.reason));
  t('cancel run marca el run como cancelado', broker.isRunCancelled('run-b'));
  const after = await broker.execute({ runId: 'run-b', toolId: 'system.getInfo', args: {} });
  t('tras cancelar no se ejecuta nada más', !after.ok && after.reason === 'cancelled', String(after.reason));
  broker.closeRun('run-b');
}

console.log('\n— Cancelación y STOP AGENT —');
{
  const { broker, approvals } = makeBroker({
    'filesystem.search': async (_args: unknown, ctx: { signal: AbortSignal }) => {
      await sleep(60);
      if (ctx.signal.aborted) throw new Error('abortado');
      return [{ name: 'tarde', path: 'x', kind: 'file' }];
    },
  });
  const runtime = makeRuntime(broker);
  const started = runtime.start('busca vigilia', { workspaceId: 'ws', permission: 'ASSIST' });
  await sleep(15);
  t('el runtime está corriendo', runtime.isRunning);
  const stopped = runtime.stop('Detenido por el usuario');
  t('stop devuelve true mientras corre', stopped);
  const run = await started;
  t('el run queda cancelado', run.status === 'cancelled', run.status);
  t('ningún paso queda en running', !run.steps.some((s) => s.status === 'running'));
  t('los pasos pendientes quedan cancelados', run.steps.some((s) => s.status === 'cancelled'));
  t('no quedan aprobaciones abiertas', approvals.pendingCount() === 0);
  t('stop sobre un run terminado devuelve false', !runtime.stop());
  const snapshot = runtime.snapshot();
  t('el evento de cancelación queda registrado',
    snapshot.events.some((e) => e.status === 'cancelled'));
  t('el estado visual vuelve a idle', snapshot.state === 'idle');
}

console.log('\n— Cancellation token —');
{
  const token = new CancellationToken();
  let notified = 0;
  token.onCancel(() => { notified += 1; });
  t('no está cancelado al crearse', !token.cancelled);
  token.cancel('motivo');
  t('cancelar marca el token', token.cancelled);
  t('el AbortSignal se aborta', token.signal.aborted);
  t('se notifica una vez', notified === 1);
  token.cancel('otra vez');
  t('cancelar dos veces no re-notifica', notified === 1);
  t('conserva el motivo', token.reason === 'motivo');
  let threwCancel = false;
  try { token.throwIfCancelled(); } catch { threwCancel = true; }
  t('throwIfCancelled lanza', threwCancel);
}

console.log('\n— Redacción —');
{
  t('api key redactada', !redactString('mi clave sk-abcdef0123456789ghij').includes('abcdef0123456789'));
  t('token de github redactado', !redactString('ghp_ABCDEFGHIJKLMNOPQRST0123').includes('ABCDEFGHIJKLMNOPQRST'));
  t('clave de google redactada', !redactString('AIzaSyA12345678901234567890abc').includes('SyA12345678901234567890'));
  t('jwt redactado', !redactString('eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM').includes('SflKxwRJSM'));
  t('bearer redactado', !redactString('Authorization: Bearer abcdefghijklmnop').includes('abcdefghijklmnop'));
  t('credenciales en url redactadas', !redactString('https://user:hunter2@host/x').includes('hunter2'));
  const redacted = redactValue({ password: 'hunter2', apiKey: 'x', nested: { token: 'abc', safe: 'visible' } }) as Record<string, unknown>;
  t('campo password redactado por nombre', redacted.password === REDACTED);
  t('campo apiKey redactado por nombre', redacted.apiKey === REDACTED);
  t('token anidado redactado', (redacted.nested as Record<string, unknown>).token === REDACTED);
  t('los campos inocuos sobreviven', (redacted.nested as Record<string, unknown>).safe === 'visible');
  t('summarizeArgs acota la longitud', summarizeArgs({ a: 'x'.repeat(500) }).length <= 221);
  t('summarizeArgs redacta', !summarizeArgs({ password: 'hunter2' }).includes('hunter2'));
  t('summarizeArgs tolera ciclos', typeof summarizeArgs((() => { const o: Record<string, unknown> = {}; o.self = o; return o; })()) === 'string');
}

console.log('\n— Auditoría —');
{
  const audit = new AuditService();
  audit.record({
    runId: 'r', actor: 'agent', tool: 'filesystem.search', action: 'execute',
    args: { query: 'x', token: 'ghp_ABCDEFGHIJKLMNOPQRST0123' },
    permission: 'ASSIST', risk: 'SAFE', approval: 'not_required', result: 'ok', durationMs: 12,
  });
  const entry = audit.list('r')[0]!;
  t('la entrada trae todos los campos',
    Boolean(entry.timestamp && entry.runId && entry.actor && entry.tool && entry.action
      && entry.permission && entry.risk && entry.approval && entry.result !== undefined));
  t('los argumentos llegan redactados', !entry.argsSummary.includes('ghp_ABCDEFGHIJKLMNOPQRST'));
  t('el argumento inocuo sobrevive', entry.argsSummary.includes('"x"'));
  let notified = 0;
  const off = audit.subscribe(() => { notified += 1; });
  audit.record({ runId: 'r', actor: 'user', tool: 'model.classify', action: 'x', permission: 'OBSERVE', risk: 'SAFE', approval: 'not_required', result: 'ok', durationMs: 0 });
  t('los suscriptores reciben las entradas', notified === 1);
  off();
  t('filtra por run', audit.list('otro').length === 0);
}

console.log('\n— Planner —');
{
  const steps = planRun({ runId: 'r', prompt: 'Encuentra el proyecto Vigilia', routing: ROUTING });
  t('el plan empieza clasificando', steps[0]?.kind === 'classify');
  t('el plan termina respondiendo', steps.at(-1)?.kind === 'respond');
  t('el plan incluye una búsqueda', steps.some((s) => s.toolId === 'filesystem.search'));
  t('los índices son correlativos', steps.every((s, i) => s.index === i));
  t('todos los pasos empiezan en cola', steps.every((s) => s.status === 'queued'));
  t('ningún paso planifica una herramienta deshabilitada',
    steps.every((s) => !s.toolId || registry.get(s.toolId)?.enabled === true));
  t('extractQuery encuentra el nombre', extractQuery('Encuentra el proyecto Vigilia').toLowerCase().includes('vigilia'));
  t('extractQuery prefiere el nombre de archivo', extractQuery('busca el archivo config.json de mi servidor') === 'config.json');
  t('extractQuery respeta las comillas', extractQuery('busca "mi carpeta rara"') === 'mi carpeta rara');
}

console.log('\n— AgentRuntime —');
{
  const { broker } = makeBroker();
  const runtime = makeRuntime(broker);
  const snapshots: string[] = [];
  const off = runtime.subscribe((s) => snapshots.push(s.status));
  const run = await runtime.start('Encuentra el proyecto Vigilia', { workspaceId: 'ws', permission: 'ASSIST' });
  off();
  t('el run termina completado', run.status === 'completed', run.status);
  t('tiene varios pasos', run.steps.length >= 3, String(run.steps.length));
  t('todos los pasos completados', run.steps.every((s) => s.status === 'completed'), run.steps.map((s) => s.status).join(','));
  t('produce respuesta', Boolean(run.answer));
  t('pasó por planning y running', snapshots.includes('planning') && snapshots.includes('running'));
  t('emitió evento de inicio y de fin',
    runtime.snapshot().events.some((e) => e.type === 'run_started')
    && runtime.snapshot().events.some((e) => e.type === 'run_finished'));
  t('el paso de búsqueda trae resumen', Boolean(run.steps.find((s) => s.toolId === 'filesystem.search')?.summary));
  t('el routing queda expuesto', runtime.snapshot().routing?.taskType === 'file_search');
}

console.log('\n— Runtime con permiso insuficiente —');
{
  const { broker } = makeBroker();
  const runtime = makeRuntime(broker);
  const run = await runtime.start('Encuentra Vigilia', { workspaceId: 'ws', permission: 'OBSERVE' });
  const step = run.steps.find((s) => s.toolId === 'filesystem.search');
  t('el run termina aunque la herramienta se bloquee', run.status === 'completed', run.status);
  t('el paso bloqueado queda como fallido', step?.status === 'failed', String(step?.status));
  t('el error explica el permiso', String(step?.error).includes('ASSIST'), String(step?.error));
}

console.log('\n— Router: salida estructurada —');
{
  const valid = validateRouterPayload({
    taskType: 'file_search', difficulty: 2, requiresWeb: false, requiresFiles: true,
    requiresVision: false, requiresCode: false, requiresReasoning: false,
    suggestedTier: 'LOCAL', tools: ['filesystem.search'],
  });
  t('un payload válido se acepta', valid !== null);
  t('conserva el tipo de tarea', valid?.taskType === 'file_search');
  t('conserva las herramientas sugeridas', valid?.tools[0] === 'filesystem.search');

  t('rechaza taskType desconocido', validateRouterPayload({ ...valid, taskType: 'hackear' }) === null);
  t('rechaza dificultad fuera de rango', validateRouterPayload({ ...valid, difficulty: 42 }) === null);
  t('rechaza tier inválido', validateRouterPayload({ ...valid, suggestedTier: 'ULTRA' }) === null);
  t('rechaza flags no booleanos', validateRouterPayload({ ...valid, requiresWeb: 'quizá' }) === null);
  t('rechaza null', validateRouterPayload(null) === null);
  t('rechaza un array', validateRouterPayload([1, 2, 3]) === null);
  t('rechaza texto suelto', validateRouterPayload('file_search' as unknown) === null);
  t('acepta booleanos como cadena', validateRouterPayload({ ...valid, requiresWeb: 'false' })?.requiresWeb === false);

  const hallucinated = validateRouterPayload({ ...valid, tools: ['filesystem.delete', 'shell.run', 'filesystem.search'] });
  t('descarta herramientas no sugeribles', hallucinated?.tools.length === 1 && hallucinated.tools[0] === 'filesystem.search',
    JSON.stringify(hallucinated?.tools));
  t('nunca sugiere una destructiva', !(hallucinated?.tools ?? []).includes('filesystem.delete' as never));

  const decision = payloadToDecision(valid!, 'busca config.json', { elapsedMs: 40, model: 'llama3.2:1b' });
  t('la decisión marca origen ollama', decision.routedBy === 'ollama');
  t('la decisión conserva la dificultad', decision.difficulty === 2);
  t('la decisión nombra el modelo', decision.reason.includes('llama3.2:1b'));
  t('la UI identifica el modelo local real, no un proveedor simulado', decision.preferredProvider === 'local' && decision.selectedModelId === 'llama3.2:1b' && decision.modelTier === 'LOCAL');
}

console.log('\n— Router: JSON malformado —');
{
  t('extrae json entre prosa', parseJsonLoose('Claro: {"a":1} espero que sirva')?.a === 1);
  t('extrae json entre fences', parseJsonLoose('```json\n{"a":2}\n```')?.a === 2);
  t('devuelve null con basura', parseJsonLoose('no soy json') === null);
  t('devuelve null con json truncado', parseJsonLoose('{"a":') === null);
  t('devuelve null con cadena vacía', parseJsonLoose('') === null);
  const fromGarbage = validateRouterPayload(parseJsonLoose('no soy json'));
  t('basura del modelo no produce payload', fromGarbage === null);
}

console.log('\n— Router heurístico (fallback) —');
{
  t('categorías completas', ROUTER_CATEGORIES.length === 7);
  t('mercado', heuristicCategory('analiza NVIDIA hoy') === 'market');
  t('archivos', heuristicCategory('busca el archivo config.json') === 'filesystem');
  t('código', heuristicCategory('tengo un bug de typescript') === 'coding');
  t('sistema', heuristicCategory('abre Blender') === 'system');
  t('navegador', heuristicCategory('resume esta página') === 'browser' || heuristicCategory('resume esta página') === 'research');
  t('investigación', heuristicCategory('investiga la documentación de Electron') === 'research');
  t('general', heuristicCategory('hola qué tal') === 'general_ai');

  const decision = heuristicRoute('busca config.json en mi PC');
  t('el fallback marca su origen', decision.routedBy === 'heuristic');
  t('el fallback clasifica archivos', decision.taskType === 'file_search', decision.taskType);
  t('el fallback sugiere la búsqueda', (decision.suggestedTools ?? []).includes('filesystem.search'));
  t('el fallback baja la confianza', decision.confidence <= 0.72);
  t('el fallback nunca lanza', Boolean(heuristicRoute('')));
}

console.log('\n— Ollama offline —');
{
  // Puerto cerrado a propósito: así se comporta una máquina sin Ollama.
  const provider = new OllamaProvider('http://127.0.0.1:1');
  const health = await provider.health(true);
  t('health resuelve sin lanzar', health !== null);
  t('reporta offline', !health.online);
  t('explica el motivo', Boolean(health.error));
  t('la lista de modelos queda vacía', health.models.length === 0);
  t('listModels no lanza', (await provider.listModels()).length === 0);
  t('structuredGenerate devuelve null', (await provider.structuredGenerate({ model: 'x', prompt: 'y' })) === null);
  t('pickRouterModel con lista vacía devuelve null', provider.pickRouterModel([]) === null);
  const models = [
    { name: 'llama3.2:3b', size: 3e9, family: 'llama', parameterSize: '3B', modifiedAt: '' },
    { name: 'qwen2.5:0.5b', size: 4e8, family: 'qwen', parameterSize: '0.5B', modifiedAt: '' },
  ];
  t('prefiere el modelo pedido', provider.pickRouterModel(models, 'llama3.2:3b') === 'llama3.2:3b');
  t('sin preferencia elige el más pequeño', provider.pickRouterModel(models) === 'qwen2.5:0.5b');
  t('tolera una preferencia inexistente', provider.pickRouterModel(models, 'no-existe') === 'qwen2.5:0.5b');
}

console.log('\n— FileSystemService (sólo lectura) —');
{
  const service = new FileSystemService();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-fs-'));
  const home = os.homedir();

  t('no expone escritura', !('write' in service) && !('delete' in service) && !('move' in service));
  t('el home está permitido', service.isAllowed(home));
  t('una ruta de sistema no está permitida', !service.isAllowed(process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc'));
  t('el escape con .. fuera de todas las raíces se rechaza', !service.isAllowed(process.platform==='win32'?path.join('C:\\Users\\owned','..','..','Windows'):path.join('/home/owned','..','..','etc')));

  const nested = path.join(home, `.jarvis-test-${Date.now()}`);
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'vigilia-config.json'), '{"a":1}');
  fs.mkdirSync(path.join(nested, 'subcarpeta'), { recursive: true });

  t('exists encuentra la carpeta', await service.exists(nested));
  t('exists rechaza fuera de las raíces', !(await service.exists('/etc/passwd')));

  const listed = await service.listDirectory(nested);
  t('listDirectory devuelve las entradas', listed.length === 2, String(listed.length));
  t('las carpetas van primero', listed[0]?.kind === 'dir');
  t('trae tamaño y fecha', listed.every((e) => typeof e.size === 'number' && e.modifiedAt > 0));

  const stat = await service.stat(path.join(nested, 'vigilia-config.json'));
  t('stat reporta el tipo', stat.kind === 'file');
  t('stat reporta la extensión', stat.ext === 'json');
  t('stat reporta tamaño', stat.size > 0);

  const hits = await service.search({ query: 'vigilia-config', roots: [nested], limit: 10 });
  t('search encuentra por nombre', hits.length === 1, String(hits.length));
  t('search devuelve la ruta completa', hits[0]?.path.includes('vigilia-config.json'));
  t('search ignora consultas de un carácter', (await service.search({ query: 'a', roots: [nested] })).length === 0);
  t('search respeta el límite', (await service.search({ query: 'a', roots: [nested], limit: 1 })).length <= 1);

  const controller = new AbortController();
  controller.abort();
  let aborted = false;
  try { await service.search({ query: 'vigilia', roots: [nested] }, controller.signal); } catch { aborted = true; }
  t('search respeta la cancelación', aborted);

  let outside = false;
  try { await service.listDirectory(process.platform === 'win32' ? 'C:\\Windows' : '/etc'); } catch { outside = true; }
  t('listar fuera de las raíces lanza', outside);

  fs.rmSync(nested, { recursive: true, force: true });
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('\n— ApplicationService y SystemService —');
{
  const apps = new ApplicationService();
  const list = await apps.list();
  t('list no lanza', Array.isArray(list));
  t('no expone launch', !('launch' in apps));
  t('search acepta consulta vacía', Array.isArray(await apps.search('')));

  const system = new SystemService();
  const info = system.getInfo();
  t('reporta plataforma', typeof info.platform === 'string' && info.platform.length > 0);
  t('reporta núcleos', info.cpuCount > 0);
  t('reporta memoria', info.totalMemory > 0);
  t('no expone kill', !('kill' in system));
  t('listProcesses devuelve algo', system.listProcesses().length > 0);
}

console.log('\n— Ejecución tras cancelar —');
{
  const { broker } = makeBroker();
  const token = new CancellationToken();
  broker.openRun('run-z', 'ASSIST', token);
  const before = await broker.execute({ runId: 'run-z', toolId: 'system.getInfo', args: {} });
  t('antes de cancelar sí ejecuta', before.ok);
  broker.cancelRun('run-z');
  const after = await broker.execute({ runId: 'run-z', toolId: 'system.getInfo', args: {} });
  t('después de cancelar no ejecuta', !after.ok && after.reason === 'cancelled', String(after.reason));
  t('el run figura como cancelado', broker.isRunCancelled('run-z'));
  broker.closeRun('run-z');
}

console.log(`\n${pass} ok · ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
