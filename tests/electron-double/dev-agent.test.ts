/**
 * The whole chain on a real disk with real processes:
 *   AgentRuntime → ToolBroker → PermissionEngine → dev policy → DevService
 * A real Node project whose real `npm test` fails; a scripted proposer stands
 * in for the model (no model is installable here). Nothing reaches the disk or
 * a process except through the broker.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AgentRuntime } from '../../src/agent/AgentRuntime';
import { ToolBroker } from '../../src/agent/ToolBroker';
import { ToolRegistry, TOOL_DEFINITIONS } from '../../src/agent/registry';
import { AuditService } from '../../src/agent/AuditService';
import { ApprovalEngine } from '../../src/agent/ApprovalEngine';
import { PermissionEngine } from '../../src/agent/permissions';
import { CancellationToken } from '../../src/agent/cancellation';
import { DevService } from '../../src/dev/DevService';
import { createCodingDelegate, noProposer, ScriptedProposer } from '../../src/dev/coding';
import type { PatchProposer, ProposalInput } from '../../src/dev/coding';
import { NodeFsPort, NodeProcessPort, DirectoryTrashPort, DiskSnapshotPort } from '../../electron/dev/nodePorts';
import type { ApprovalRequest, PermissionLevel, RoutingDecision } from '../../src/types';

let pass = 0, fail = 0;
const t = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};
const section = (s: string) => console.log(`\n— ${s}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const alive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch { return false; }
  if (process.platform === 'win32') return true;
  try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.[0] !== 'Z'; } catch { return false; }
};

const ROUTE: RoutingDecision = {
  taskType: 'code_debugging', difficulty: 5, contextSize: 200, requiresWeb: false, requiresVision: false,
  requiresFiles: true, requiresCode: true, requiresReasoning: true, preferredProvider: 'local',
  modelTier: 'LOCAL', selectedModelId: 'test', reason: 'test', confidence: 0.9, routedBy: 'heuristic', elapsedMs: 1,
} as RoutingDecision;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agent-'));
if (process.platform === 'win32' && !path.resolve(TMP).toLowerCase().startsWith('e:\\codex\\')) throw Error('EXTERNAL_TEST_TEMP_REQUIRED');
const ROOT = path.join(TMP, 'Projects');
const BUGGY = 'module.exports.sum = (a, b) => a - b;\n';

function makeProject(name: string, testBody?: string): string {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', scripts: { test: 'node test.js' } }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'src', 'math.js'), BUGGY);
  fs.writeFileSync(path.join(dir, 'test.js'), testBody ?? [
    "const { sum } = require('./src/math');",
    "const got = sum(2, 3);",
    "if (got !== 5) { console.log('✗ sum(2, 3) debería ser 5, dio ' + got); process.exit(1); }",
    "console.log('✓ 1 prueba pasó');",
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# ' + name + '\n');
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-q', '-m', 'init');
  // The user's own unfinished work, before JARVIS starts.
  fs.writeFileSync(path.join(dir, 'README.md'), '# ' + name + '\n\nNotas del usuario sin commitear.\n');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'borrador\n');
  return dir;
}

/** Scripted like a model would: each attempt edits the file as it is NOW (from the context it received). */
const fixSum = (wrong = false, from = 'a - b') => ({ edits: [{ path: 'src/math.js', ops: [{ kind: 'edit' as const, edit: { oldText: from, newText: wrong ? 'a * b' : 'a + b' } }] }], rationale: wrong ? 'Primer intento' : 'sum debe sumar' });
const fromContext = (input: ProposalInput) => (input.context.files.find((f) => f.path === 'src/math.js')?.content.includes('a * b') ? 'a * b' : 'a - b');

function harness(opts: { permission: PermissionLevel; proposer: PatchProposer; max?: number; massLimits?: { maxFiles: number; maxBytes: number; maxTrash: number }; approve?: (r: ApprovalRequest) => 'allow_once' | 'allow_for_run' | 'deny' }) {
  const dev = new DevService({
    fs: new NodeFsPort(), trash: new DirectoryTrashPort(path.join(TMP, 'bin')), snapshots: new DiskSnapshotPort(path.join(TMP, 'snaps')),
    processes: new NodeProcessPort(), protectedPaths: ['/etc', '/usr'], home: os.homedir(), ...(opts.massLimits ? { massLimits: opts.massLimits } : {}),
  });
  const audit = new AuditService();
  const approvals = new ApprovalEngine();
  const registry = new ToolRegistry(TOOL_DEFINITIONS);
  const broker = new ToolBroker({ registry, audit, approvals, permissions: new PermissionEngine() });
  broker.registerAll(dev.adapters());
  broker.addPolicy(dev.policy());
  const asked: ApprovalRequest[] = [];
  const seen = new Set<string>();
  approvals.subscribe((req) => {
    if (!req || seen.has(req.id)) return;
    seen.add(req.id);
    asked.push(req);
    queueMicrotask(() => approvals.resolve(req.id, opts.approve?.(req) ?? 'allow_for_run'));
  });
  const runtime = new AgentRuntime({
    broker, route: async () => ROUTE, compose: () => 'ok',
    delegates: { coding: createCodingDelegate({ proposer: () => opts.proposer, maxRepairIterations: opts.max ?? 3 }) },
    onCancel: (runId) => { void dev.cancelRun(runId); },
  });
  /** A direct tool call inside an open run at this harness's permission level. */
  const exec = (runId: string, toolId: string, args: unknown) => {
    try { broker.openRun(runId, opts.permission, new CancellationToken()); } catch { /* already open */ }
    return broker.execute({ runId, toolId, args });
  };
  return { dev, audit, approvals, broker, runtime, asked, exec };
}

await (async () => {
  fs.mkdirSync(ROOT, { recursive: true });

  /* ================================================================ */
  section('FULL CONTROL: encontrar, corregir, reparar y verificar (disco y npm reales)');
  {
    const dir = makeProject('vigilia');
    const seenErrors: string[] = [];
    const proposer = new ScriptedProposer((input: ProposalInput) => { seenErrors.push(input.failures.map((f) => f.excerpt).join()); return fixSum(input.attempt === 1, fromContext(input)); });
    const h = harness({ permission: 'ADMIN', proposer });
    await h.dev.projects.addRoot(ROOT);
    const run = await h.runtime.start('Abre mi proyecto vigilia, encuentra por qué fallan las pruebas, corrígelo y ejecuta las pruebas', { workspaceId: 'w', permission: 'ADMIN' });
    const delegate = run.steps.find((s) => s.kind === 'delegate');
    const subs = run.steps.filter((s) => s.parentId === delegate?.id);
    t('el plan es un único paso delegado de programación', !!delegate && delegate.delegate === 'coding');
    t('el doble sin recibo main termina con checks pasados y resultado no verificado', run.status === 'completed' && delegate?.status === 'completed' && /Comprobaciones pasan/.test(delegate?.summary ?? '') && delegate?.outcome === 'unverified', delegate?.summary ?? delegate?.error);
    t('cada acción fue un sub-paso visible por el broker', ['project.open', 'git.status', 'project.checks', 'terminal.execute', 'code.context', 'file.read', 'file.patch', 'changes.review'].every((id) => subs.some((s) => s.toolId === id)));
    t('iteró: el primer parche no bastó, el segundo sí', proposer.calls === 2 && /2 intento/.test(delegate?.summary ?? ''));
    t('el proponedor vio el error real de npm test (y el del intento fallido)', /dio -1/.test(seenErrors[0] ?? '') && /dio 6/.test(seenErrors[1] ?? ''));
    t('el archivo en disco quedó corregido', fs.readFileSync(path.join(dir, 'src', 'math.js'), 'utf8').includes('a + b'));
    t('y npm test pasa de verdad fuera de JARVIS', execFileSync('node', ['test.js'], { cwd: dir }).toString().includes('✓'));
    t('en FULL CONTROL no hubo interrupciones', h.asked.length === 0, h.asked.map((a) => a.toolId).join());
    const patchAudit = h.audit.list().filter((e) => e.tool === 'file.patch');
    t('auditoría de file.patch sin contenido de archivo', patchAudit.length === 2 && patchAudit.every((e) => !JSON.stringify(e).includes('a + b;\\n')));
    const review = await h.exec('r-review', 'changes.review', { runId: run.id });
    if (!review.ok) console.log('review:', review.reason, review.error);
    const attr = (review.data as { attribution: { preExisting: string[]; byJarvis: string[] } }).attribution;
    t('Review: los cambios previos del usuario se separan', attr.preExisting.includes('README.md') && attr.preExisting.includes('notes.md'));
    t('Review: JARVIS sólo cambió src/math.js', attr.byJarvis.join() === 'src/math.js');
    const revert = await h.dev.files.revertRun(run.id);
    t('Revert Run devuelve math.js a su estado previo', fs.readFileSync(path.join(dir, 'src', 'math.js'), 'utf8') === BUGGY && revert.conflicts.length === 0);
    t('…sin tocar el trabajo previo del usuario', fs.readFileSync(path.join(dir, 'README.md'), 'utf8').includes('Notas del usuario') && fs.existsSync(path.join(dir, 'notes.md')));
  }

  /* ================================================================ */
  section('Límite de reparación y escalada del fallo');
  {
    makeProject('terca');
    const proposer = new ScriptedProposer(() => ({ edits: [{ path: 'src/math.js', ops: [{ kind: 'replace', startLine: 1, endLine: 1, text: `module.exports.sum = (a, b) => a * b + ${Math.random().toFixed(3)};` }] }], rationale: 'intento' }));
    const h = harness({ permission: 'ADMIN', proposer, max: 2 });
    await h.dev.projects.addRoot(ROOT);
    const run = await h.runtime.start('Corrige las pruebas del proyecto terca', { workspaceId: 'w', permission: 'ADMIN' });
    const d = run.steps.find((s) => s.kind === 'delegate')!;
    t('se detiene tras maxRepairIterations', proposer.calls === 2 && d.status === 'failed');
    t('informa qué cambió, qué sigue fallando y el último error', /Me detuve tras 2 intentos/.test(d.error ?? '') && /src\/math\.js/.test(d.error ?? '') && /test/.test(d.error ?? '') && /Último error/.test(d.error ?? ''), d.error);
  }

  /* ================================================================ */
  section('El siguiente intento recibe el rechazo real de un parche');
  {
    const dir = makeProject('rechazo-ancla'), seen: ProposalInput[] = [];
    const proposer = new ScriptedProposer(input => { seen.push(input); return fixSum(false, input.attempt === 1 ? 'missing_exact_anchor' : 'a - b'); });
    const h = harness({permission: 'ADMIN', proposer, max: 2});
    await h.dev.projects.addRoot(ROOT);
    const run = await h.runtime.start('Corrige las pruebas del proyecto rechazo-ancla', {workspaceId: 'w', permission: 'ADMIN'});
    t('un ancla rechazada por el mutador llega al siguiente contexto de propuesta', seen.length === 2 && seen[1]!.failures.some(f => f.check === 'patch' && /No se encontró/.test(f.excerpt)));
    t('el rechazo no se trata como escritura: sólo el segundo parche cambia el disco', fs.readFileSync(path.join(dir, 'src/math.js'), 'utf8').includes('a + b') && h.dev.files.changes.get(run.id)?.changes.length === 1);
    t('tras corregir el ancla pasan las pruebas reales sin afirmar recibo main ausente', run.status === 'completed' && run.steps.find(s => s.kind === 'delegate')?.outcome === 'unverified' && execFileSync('node', ['test.js'], {cwd: dir}).toString().includes('✓'));
  }

  section('Sin modelo: entiende y verifica, no inventa cambios');
  {
    const dir = makeProject('sinmodelo');
    const h = harness({ permission: 'ADMIN', proposer: noProposer });
    await h.dev.projects.addRoot(ROOT);
    const run = await h.runtime.start('Arregla el build del proyecto sinmodelo', { workspaceId: 'w', permission: 'ADMIN' });
    const d = run.steps.find((s) => s.kind === 'delegate')!;
    t('dice que no hay modelo y qué falla', /No hay un modelo configurado/.test(d.error ?? '') && /test/.test(d.error ?? ''), d.error);
    t('no modificó nada', fs.readFileSync(path.join(dir, 'src', 'math.js'), 'utf8') === BUGGY);
  }

  /* ================================================================ */
  section('Niveles de permiso');
  {
    const dir = makeProject('criterios');
    const before = fs.readFileSync(path.join(dir, 'test.js'), 'utf8');
    const h = harness({permission: 'ADMIN', proposer: new ScriptedProposer(() => ({edits: [
      ...fixSum().edits, {path: 'test.js', ops: [{kind: 'edit' as const, edit: {oldText: before, newText: 'console.log("forged pass");\n'}}]}
    ], rationale: 'Intento de fuente y de alterar criterios'}))});
    await h.dev.projects.addRoot(ROOT);
    const run = await h.runtime.start('Corrige el proyecto criterios sin cambiar dependencias ni pruebas', {workspaceId: 'w', permission: 'ADMIN'});
    t('restricción del usuario conserva tests ante propuesta de alterarlos', fs.readFileSync(path.join(dir, 'test.js'), 'utf8') === before && run.status === 'completed');
    t('…permite reparar fuente y registra el input omitido', fs.readFileSync(path.join(dir, 'src/math.js'), 'utf8').includes('a + b') && JSON.stringify(run).includes('test.js'));
  }
  {
    const dir = makeProject('permisos');
    const assist = harness({ permission: 'ASSIST', proposer: new ScriptedProposer(() => fixSum()) });
    await assist.dev.projects.addRoot(ROOT);
    const r1 = await assist.runtime.start('Corrige las pruebas del proyecto permisos', { workspaceId: 'w', permission: 'ASSIST' });
    t('ASSIST: no ejecuta comandos ni aplica parches', r1.steps.filter((s) => s.toolId === 'file.patch' || s.toolId === 'terminal.execute').every((s) => s.status === 'failed'));
    t('…el archivo sigue igual', fs.readFileSync(path.join(dir, 'src', 'math.js'), 'utf8') === BUGGY);
    const prop = await assist.exec('r-assist', 'file.proposePatch', { project: 'permisos', path: 'src/math.js', ops: [{ kind: 'edit', edit: { oldText: 'a - b', newText: 'a + b' } }] });
    t('ASSIST sí puede proponer un parche (diff sin escribir)', prop.ok && /\+module\.exports\.sum = \(a, b\) => a \+ b;/.test((prop.data as { diff: string }).diff) && fs.readFileSync(path.join(dir, 'src', 'math.js'), 'utf8') === BUGGY);

    const control = harness({ permission: 'CONTROL', proposer: new ScriptedProposer(() => fixSum()) });
    await control.dev.projects.addRoot(ROOT);
    const r2 = await control.runtime.start('Corrige las pruebas del proyecto permisos', { workspaceId: 'w', permission: 'CONTROL' });
    t('CONTROL: modifica tras aprobar, una vez por herramienta', r2.status === 'completed' && fs.readFileSync(path.join(dir, 'src', 'math.js'), 'utf8').includes('a + b'));
    t('…pidió aprobación para terminal.execute y file.patch', ['terminal.execute', 'file.patch'].every((id) => control.asked.some((a) => a.toolId === id)) && control.asked.length === 2, control.asked.map((a) => a.toolId).join());

    const obs = harness({ permission: 'OBSERVE', proposer: noProposer });
    await obs.dev.projects.addRoot(ROOT);
    const w = await obs.exec('r-obs', 'file.write', { project: 'permisos', path: 'x.txt', content: 'x' });
    t('OBSERVE: ninguna escritura', !w.ok && w.reason === 'permission_denied' && !fs.existsSync(path.join(dir, 'x.txt')));
  }

  /* ================================================================ */
  section('STOP durante un comando real');
  {
    const dir = makeProject('lento', [
      "const { spawn } = require('child_process');",
      "const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });",
      "require('fs').writeFileSync(__dirname + '/pids.txt', process.pid + ' ' + c.pid);",
      "setTimeout(() => {}, 60000);",
    ].join('\n'));
    const h = harness({ permission: 'ADMIN', proposer: noProposer });
    await h.dev.projects.addRoot(ROOT);
    const started = h.runtime.start('Ejecuta las pruebas del proyecto lento', { workspaceId: 'w', permission: 'ADMIN' });
    const pidFile = path.join(dir, 'pids.txt');
    const startedDeadline = Date.now() + 20000;
    while (!fs.existsSync(pidFile) && Date.now() < startedDeadline) await sleep(50);
    if (!fs.existsSync(pidFile)) { h.runtime.stop(); await started; throw Error('Owned test command did not produce its PID receipt within 20s'); }
    await sleep(100);
    const [testPid, childPid] = fs.readFileSync(pidFile, 'utf8').split(' ').map(Number);
    t('el comando real está corriendo (npm → node test.js → hijo)', alive(testPid!) && alive(childPid!) && h.dev.terminal.runningCount() === 1);
    const t0 = Date.now();
    h.runtime.stop();
    const run = await started;
    await sleep(700);
    t('STOP cancela la tarea', run.status === 'cancelled');
    t('…y mata el árbol del comando: npm, node test.js y su hijo', !alive(testPid!) && !alive(childPid!), `${alive(testPid!)} ${alive(childPid!)}`);
    t('…rápido', Date.now() - t0 < 3000);
    t('no queda ningún comando del run', h.dev.terminal.runningCount() === 0);
  }

  /* ================================================================ */
  section('PAUSE antes de escribir');
  {
    const dir = makeProject('pausa');
    let h!: ReturnType<typeof harness>;
    const proposer = new ScriptedProposer(() => { h.runtime.pause(); return fixSum(); });
    h = harness({ permission: 'ADMIN', proposer });
    await h.dev.projects.addRoot(ROOT);
    const started = h.runtime.start('Corrige las pruebas del proyecto pausa', { workspaceId: 'w', permission: 'ADMIN' });
    const proposerDeadline = Date.now() + 30000;
    while (proposer.calls === 0 && Date.now() < proposerDeadline) await sleep(50);
    if (proposer.calls === 0) throw Error('PAUSE fixture did not reach its proposer within 30 seconds');
    await sleep(400);
    t('en pausa: el parche propuesto NO se escribe', fs.readFileSync(path.join(dir, 'src', 'math.js'), 'utf8') === BUGGY && h.runtime.currentRun?.status === 'paused');
    h.runtime.resume();
    const run = await started;
    t('al reanudar, continúa y verifica', run.status === 'completed' && fs.readFileSync(path.join(dir, 'src', 'math.js'), 'utf8').includes('a + b'));
  }

  /* ================================================================ */
  section('Cambios masivos y secretos: aprobación aun en FULL CONTROL');
  {
    const dir = makeProject('masivo');
    for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(dir, 'src', `m${i}.js`), `module.exports.v = ${i};\n`);
    const edits = Array.from({ length: 4 }, (_, i) => ({ path: `src/m${i}.js`, ops: [{ kind: 'edit' as const, edit: { oldText: `= ${i}`, newText: `= ${i + 10}` } }] }));
    const h = harness({ permission: 'ADMIN', proposer: new ScriptedProposer(() => ({ edits, rationale: 'masivo' })), max: 1,
      massLimits: { maxFiles: 3, maxBytes: 100 * 1048576, maxTrash: 10 }, approve: (r) => (r.risk === 'DESTRUCTIVE' ? 'deny' : 'allow_once') });
    await h.dev.projects.addRoot(ROOT);
    await h.runtime.start('Corrige las pruebas del proyecto masivo', { workspaceId: 'w', permission: 'ADMIN' });
    const esc = h.asked.find((a) => /Cambio masivo/.test(a.reason));
    t('el 4.º archivo de la tarea escala a DESTRUCTIVE aunque sea FULL CONTROL', !!esc && esc.risk === 'DESTRUCTIVE' && esc.toolId === 'file.patch', h.asked.map((a) => `${a.toolId}:${a.risk}`).join());
    t('los 3 primeros se escribieron, el 4.º (denegado) no', [0, 1, 2].every((i) => fs.readFileSync(path.join(dir, 'src', `m${i}.js`), 'utf8').includes(`= ${i + 10}`)) && fs.readFileSync(path.join(dir, 'src', 'm3.js'), 'utf8').includes('= 3;'));

    fs.writeFileSync(path.join(dir, '.env'), 'API_URL=http://localhost\nAPI_KEY=sk-live-abcdefghijklmnop\n');
    const h2 = harness({ permission: 'ADMIN', proposer: noProposer, approve: () => 'allow_once' });
    await h2.dev.projects.addRoot(ROOT);
    const read = await h2.exec('r-env', 'file.read', { project: 'masivo', path: '.env' });
    t('.env se lee redactado', read.ok && !JSON.stringify(read.data).includes('sk-live') && JSON.stringify(read.data).includes('API_KEY=[redactado]'));
    const envPatch = await h2.exec('r-env', 'file.patch', { project: 'masivo', path: '.env', ops: [{ kind: 'replace', startLine: 1, endLine: 1, text: 'API_URL=http://localhost:4000' }] });
    t('editar .env pide aprobación SENSITIVE aun en FULL CONTROL', envPatch.ok && h2.asked.some((a) => a.toolId === 'file.patch' && /secretos/.test(a.reason)));
    t('…la clave se conserva y el diff no la expone', fs.readFileSync(path.join(dir, '.env'), 'utf8').includes('sk-live-abcdefghijklmnop') && !JSON.stringify(envPatch.data).includes('sk-live'));
    t('el audit no contiene el valor secreto', !JSON.stringify(h2.audit.list()).includes('sk-live'));
  }

  /* ================================================================ */
  section('Comandos a través del broker');
  {
    makeProject('comandos');
    const h = harness({ permission: 'ADMIN', proposer: noProposer, approve: () => 'deny' });
    await h.dev.projects.addRoot(ROOT);
    const x = (args: Record<string, unknown>) => h.exec('r-cmd', 'terminal.execute', { project: 'comandos', ...args });
    const push = await x({ executable: 'git', args: ['push', '--force'] });
    t('git push --force: vetado por la política', !push.ok && push.reason === 'policy_blocked');
    const shell = await x({ executable: 'bash', args: ['-c', 'rm -rf /'] });
    t('bash -c: vetado', !shell.ok && shell.reason === 'policy_blocked');
    const chain = await x({ executable: 'npm', args: ['test', '&&', 'rm', '-rf', '.'] });
    t('npm test && rm …: vetado (dos ToolCalls, no una cadena)', !chain.ok && /llamada separada/.test(chain.error ?? ''));
    const dev = await x({ executable: 'npm', args: ['run', 'dev'] });
    t('npm run dev como comando: rechazado, debe ser process.start', !dev.ok && /process\.start/.test(dev.error ?? ''));
    const inline = await x({ executable: 'node', args: ['-e', 'console.log(1)'] });
    t('node -e: escala a DESTRUCTIVE y respeta la denegación', !inline.ok && inline.reason === 'approval_denied' && h.asked.some((a) => a.risk === 'DESTRUCTIVE'));
    const outside = await x({ executable: 'git', args: ['status'], cwd: TMP });
    t('cwd fuera del proyecto: rechazado', !outside.ok);
    const ok = await x({ executable: 'git', args: ['status', '--short'] });
    t('git status: permitido sin interrupción', ok.ok && (ok.data as { exitCode: number }).exitCode === 0);
  }

  /* ================================================================ */
  section('Procesos gestionados a través del broker');
  {
    const dir = makeProject('servidor');
    fs.writeFileSync(path.join(dir, 'server.js'), "setInterval(() => console.log('listo en :5173'), 100);\n");
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    pkg.scripts.dev = 'node server.js';
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    const h = harness({ permission: 'ADMIN', proposer: noProposer });
    await h.dev.projects.addRoot(ROOT);
    const start = await h.exec('r-svc', 'process.start', { project: 'servidor', executable: 'npm', args: ['run', 'dev'] });
    const info = start.data as { id: string; pid: number };
    // Startup latency is not the contract. Observe actual owned-server output
    // within a finite bound, without changing the success/STOP assertions.
    const logDeadline = Date.now() + 20000;
    let logs = await h.exec('r-svc', 'process.logs', { id: info.id });
    while (!(logs.data as string[]).some(l => l.includes('listo en :5173')) && Date.now() < logDeadline) {
      await sleep(100); logs = await h.exec('r-svc', 'process.logs', { id: info.id });
    }
    t('npm run dev arranca como proceso gestionado y sus logs se leen', start.ok && (logs.data as string[]).some((l) => l.includes('listo en :5173')));
    const foreign = await h.exec('r-svc', 'process.stop', { id: 'svc_de_otro' });
    t('no puede detener procesos que no inició', !foreign.ok);
    t('process.kill genérico sigue deshabilitado', !(await h.exec('r-svc', 'process.kill', { pid: 1 })).ok);
    await h.dev.cancelRun('r-svc');
    await sleep(600);
    t('STOP del run detiene su servidor', !alive(info.pid));
  }
})();

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} ok · ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
