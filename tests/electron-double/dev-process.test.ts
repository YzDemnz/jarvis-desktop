/**
 * Real processes and real git on the host OS. Windows process-tree termination
 * uses taskkill; POSIX uses process groups.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { NodeProcessPort, filteredEnv } from '../../electron/dev/nodePorts';
import { TerminalService, ManagedProcessRegistry, DeveloperToolDiscovery, summarizeOutput, DEFAULT_OUTPUT_LIMITS } from '../../src/dev/TerminalService';
import { GitService, parsePorcelainZ, attributeChanges } from '../../src/dev/GitService';
import { classifyCommand } from '../../src/dev/commandPolicy';
import type { PolicyContext } from '../../src/dev/commandPolicy';

let pass = 0, fail = 0;
const t = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};
const section = (s: string) => console.log(`\n— ${s}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** A zombie (Z) has exited and only awaits reaping by init: it counts as dead. */
const alive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch { return false; }
  if (process.platform === 'win32') return true;
  try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.[0] !== 'Z'; } catch { return false; }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-proc-'));
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(PROJ, { recursive: true });
const script = (name: string, body: string) => { fs.writeFileSync(path.join(PROJ, name), body); return name; };

const port = new NodeProcessPort();
const term = new TerminalService(port, { ...DEFAULT_OUTPUT_LIMITS, headLines: 20, tailLines: 30, maxBytes: 8 * 1024 });

/* ================================================================== */
section('Política de comandos');
{
  // Keep POSIX policy vectors synthetic so this suite tests the same rules on Windows.
  const POLICY_PROJ = '/workspace/project';
  const ctx: PolicyContext = { flavor: 'posix', projectRoot: POLICY_PROJ, protectedPaths: ['/etc', '/usr'], home: '/home/test-user' };
  const c = (executable: string, args: string[], cwd = POLICY_PROJ, extra: Partial<PolicyContext> = {}, envSubset?: Record<string, string>) =>
    classifyCommand({ executable, args, cwd, ...(envSubset ? { envSubset } : {}) }, { ...ctx, ...extra });
  t('git status → SAFE', c('git', ['status']).risk === 'SAFE' && c('git', ['status']).allowed);
  t('npm test → SENSITIVE, permitido', c('npm', ['test']).risk === 'SENSITIVE' && c('npm', ['test']).allowed);
  t('npm run dev → proceso de larga duración', c('npm', ['run', 'dev']).longRunning && !c('npm', ['test']).longRunning);
  t('npm install → SENSITIVE (scripts de instalación)', c('npm', ['install']).risk === 'SENSITIVE');
  t('npm publish → bloqueado', !c('npm', ['publish']).allowed);
  t('npx sin --no-install → DESTRUCTIVE', c('npx', ['cowsay']).risk === 'DESTRUCTIVE');
  t('npx --no-install tsc → SENSITIVE', c('npx', ['--no-install', 'tsc', '--noEmit']).risk === 'SENSITIVE');
  t('node -e → DESTRUCTIVE', c('node', ['-e', 'require("fs").rmSync(".")']).risk === 'DESTRUCTIVE');
  t('python -c → DESTRUCTIVE', c('python3', ['-c', 'print(1)']).risk === 'DESTRUCTIVE');
  t('pip uninstall → DESTRUCTIVE', c('pip', ['uninstall', 'x']).risk === 'DESTRUCTIVE');
  for (const [args, label] of [[['push'], 'push'], [['push', '--force'], 'force push'], [['reset', '--hard'], 'reset --hard'], [['clean', '-fd'], 'clean -fd'], [['rebase', 'main'], 'rebase']] as [string[], string][]) {
    t(`git ${label} → bloqueado`, !c('git', args).allowed && c('git', args).risk === 'CRITICAL');
  }
  t('git -c alias.x=!cmd → bloqueado (ejecución vía config)', !c('git', ['-c', 'alias.x=!rm', 'x']).allowed);
  t('git commit sin habilitar → bloqueado', !c('git', ['commit', '-m', 'x']).allowed);
  t('git commit habilitado → SENSITIVE', c('git', ['commit', '-m', 'x'], POLICY_PROJ, { allowCommit: true }).risk === 'SENSITIVE');
  t('git checkout -- archivo → DESTRUCTIVE (descarta cambios)', c('git', ['checkout', '--', 'a.ts']).risk === 'DESTRUCTIVE');
  t('git restore . → bloqueado', !c('git', ['restore', '.']).allowed);
  t('cmake -E rm → bloqueado (borrado fuera de la papelera)', !c('cmake', ['-E', 'rm', '-rf', 'build']).allowed);
  for (const shell of ['cmd', 'powershell', 'pwsh.exe', 'bash', 'sh', 'sudo']) t(`«${shell}» no se puede invocar`, !c(shell, ['/c', 'dir']).allowed);
  t('un ejecutable fuera de la lista se rechaza', !c('curl', ['http://x']).allowed);
  t('una ruta como ejecutable se rechaza', !c('/usr/bin/node', ['x.js']).allowed);
  t('una línea de comando como ejecutable se rechaza', !c('npm test', []).allowed);
  for (const op of ['&&', '||', ';', '|', '>', '>>', '$(rm -rf /)', '`id`']) t(`operador de shell «${op}» se rechaza`, !c('npm', ['test', op, 'x']).allowed);
  t('cwd relativo se rechaza', !c('npm', ['test'], 'proj').allowed);
  t('cwd en la raíz se rechaza', !c('npm', ['test'], '/').allowed);
  t('cwd en la carpeta de usuario se rechaza', !c('npm', ['test'], ctx.home!).allowed);
  t('cwd en ruta del sistema se rechaza', !c('npm', ['test'], '/usr/lib').allowed);
  t('cwd fuera del proyecto se rechaza', !c('npm', ['test'], '/workspace/elsewhere').allowed);
  t('un argumento que sale del proyecto eleva a DESTRUCTIVE', c('node', ['../../other/script.js']).risk === 'DESTRUCTIVE');
  t('un argumento hacia ruta protegida se bloquea', !c('node', ['/etc/passwd']).allowed);
  t('variables con secretos se rechazan', !c('npm', ['test'], POLICY_PROJ, {}, { GITHUB_TOKEN: 'ghp_x' }).allowed);
  t('NODE_OPTIONS / PATH no se pueden fijar', !c('npm', ['test'], POLICY_PROJ, {}, { NODE_OPTIONS: '--require x' }).allowed && !c('npm', ['test'], POLICY_PROJ, {}, { PATH: '/tmp' }).allowed);
  t('una variable inocua se acepta', c('npm', ['test'], POLICY_PROJ, {}, { CI: '1' }).allowed);
  t('en Windows, argumentos con metacaracteres de cmd.exe se rechazan para .cmd',
    !classifyCommand({ executable: 'npm', args: ['run', 'x&calc'], cwd: 'D:\\P\\app' }, { flavor: 'win32', projectRoot: 'D:\\P\\app', protectedPaths: [], home: null }).allowed);
}

/* ================================================================== */
section('Entorno filtrado');
{
  const env = filteredEnv({ PATH: '/bin', HOME: '/h', GITHUB_TOKEN: 'ghp_x', AWS_SECRET_ACCESS_KEY: 's', OPENAI_API_KEY: 'k', NODE_ENV: 'test', DATABASE_URL: 'postgres://u:p@h/db' });
  t('pasa PATH, HOME, NODE_ENV', env.PATH === '/bin' && env.HOME === '/h' && env.NODE_ENV === 'test');
  const caches = { DOTNET_CLI_HOME: 'E:/CODEX/caches/dotnet', DOTNET_BUNDLE_EXTRACT_BASE_DIR: 'E:/CODEX/caches/bundles', NUGET_PACKAGES: 'E:/CODEX/caches/nuget', npm_config_cache: 'E:/CODEX/caches/npm', npm_config_prefix: 'E:/CODEX/tools/npm', ELECTRON_CACHE: 'E:/CODEX/caches/electron', ELECTRON_BUILDER_CACHE: 'E:/CODEX/caches/builder', PLAYWRIGHT_BROWSERS_PATH: 'E:/CODEX/caches/playwright' };
  t('procesos conservan las rutas de cache externas sin heredar credenciales', Object.entries(caches).every(([k, v]) => filteredEnv({ ...caches, OPENAI_API_KEY: 'secret' })[k] === v) && !('OPENAI_API_KEY' in filteredEnv({ ...caches, OPENAI_API_KEY: 'secret' })));
  t('no pasa tokens, claves ni URLs con credenciales', !('GITHUB_TOKEN' in env) && !('AWS_SECRET_ACCESS_KEY' in env) && !('OPENAI_API_KEY' in env) && !('DATABASE_URL' in env));
  process.env.JARVIS_TEST_SECRET_TOKEN = 'no-debe-verse';
  script('env.js', 'console.log(Object.keys(process.env).join(","))');
  const r = await term.execute({ executable: 'node', args: ['env.js'], cwd: PROJ });
  t('un proceso hijo real no recibe los secretos del entorno de JARVIS', r.exitCode === 0 && !r.stdout.includes('JARVIS_TEST_SECRET_TOKEN') && r.stdout.includes('PATH'));
}

/* ================================================================== */
section('Ejecución, salida y límites (procesos reales)');
{
  script('ok.js', 'console.log("hola"); console.error("aviso"); process.exit(0)');
  const ok = await term.execute({ executable: 'node', args: ['ok.js'], cwd: PROJ });
  t('captura stdout, stderr, exitCode y duración', ok.exitCode === 0 && ok.stdout.trim() === 'hola' && ok.stderr.trim() === 'aviso' && ok.durationMs > 0);
  script('fail.js', 'console.error("boom"); process.exit(3)');
  t('código de salida distinto de cero', (await term.execute({ executable: 'node', args: ['fail.js'], cwd: PROJ })).exitCode === 3);
  script('secret.js', 'console.log("token=ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX y password: Hunter2!")');
  const sec = await term.execute({ executable: 'node', args: ['secret.js'], cwd: PROJ });
  t('la salida pasa por CredentialBoundary', !sec.stdout.includes('ghp_abcdef') && !sec.stdout.includes('Hunter2'));
  script('ansi.js', 'console.log("\\x1b[32m✓ ok\\x1b[0m")');
  t('los códigos ANSI se limpian', (await term.execute({ executable: 'node', args: ['ansi.js'], cwd: PROJ })).stdout.trim() === '✓ ok');

  script('flood.js', 'for (let i = 0; i < 20000; i++) console.log("línea " + i)');
  const flood = await term.execute({ executable: 'node', args: ['flood.js'], cwd: PROJ });
  t('salida enorme: se resume con cabeza y cola', flood.truncated && flood.stdout.includes('línea 0') && flood.stdout.includes('línea 19999') && /líneas omitidas/.test(flood.stdout));
  t('lo devuelto respeta el límite de bytes', flood.stdout.length <= 8 * 1024 + 200);
  t('la salida completa queda en el almacén temporal', !!flood.outputId && (term.outputs.get(flood.outputId!) ?? '').split('\n').length >= 20000);
  t('…y se puede buscar en ella', term.outputs.search(flood.outputId!, 'línea 12345').length === 1);
  const s = summarizeOutput(Array.from({ length: 10 }, (_, i) => `x${i}`).join('\n'), { ...DEFAULT_OUTPUT_LIMITS, headLines: 2, tailLines: 2 });
  t('summarizeOutput conserva cabeza y cola exactas', s.text === 'x0\nx1\n… 6 líneas omitidas …\nx8\nx9');

  script('slow.js', 'setTimeout(() => console.log("tarde"), 10000)');
  const t0 = Date.now();
  const to = await term.execute({ executable: 'node', args: ['slow.js'], cwd: PROJ, timeoutMs: 400 });
  t('timeout mata el proceso y lo informa', to.timedOut && Date.now() - t0 < 3000 && !to.stdout.includes('tarde'));
  t('un ejecutable no instalado falla claramente', await term.execute({ executable: 'cargo', args: ['build'], cwd: PROJ }).then(() => false, (e) => /no está instalado/.test(e.message)));
}

/* ================================================================== */
section('Cancelación y árbol de procesos');
{
  // parent → child → grandchild, each printing its pid.
  script('tree.js', `
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['-e', "const {spawn}=require('child_process'); const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log('GRAND '+g.pid); setInterval(()=>{},1000)"], { stdio: ['ignore', 'inherit', 'inherit'] });
    console.log('CHILD ' + child.pid);
    setInterval(() => {}, 1000);
  `);
  // An unrelated process JARVIS did not start: must survive.
  const bystander = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const ac = new AbortController();
  let out = '';
  const running = term.execute({ executable: 'node', args: ['tree.js'], cwd: PROJ }, { runId: 'run-tree', signal: ac.signal, onOutput: (c) => { out += c; } });
  for (let i = 0; i < 50 && !/GRAND \d+/.test(out); i++) await sleep(50);
  const child = Number(out.match(/CHILD (\d+)/)?.[1]);
  const grand = Number(out.match(/GRAND (\d+)/)?.[1]);
  t('el árbol arrancó (hijo y nieto vivos)', alive(child) && alive(grand));
  t('el streaming de salida llega mientras corre', /CHILD \d+/.test(out));
  t('el run tiene un comando en curso', term.runningCount('run-tree') === 1);
  ac.abort();
  const r = await running;
  await sleep(600);
  t('STOP: el comando termina como cancelado', r.cancelled);
  t('el hijo murió', !alive(child));
  t('el nieto también', !alive(grand));
  t('un proceso ajeno sigue vivo', alive(bystander.pid!));
  t('JARVIS (este proceso) sigue vivo', alive(process.pid));
  bystander.kill();

  // cancelRun: only that run's commands.
  const a = term.execute({ executable: 'node', args: ['slow.js'], cwd: PROJ }, { runId: 'run-x' });
  const b = term.execute({ executable: 'node', args: ['slow.js'], cwd: PROJ, timeoutMs: 1500 }, { runId: 'run-y' });
  await sleep(150);
  t('cancelRun detiene los comandos de ese run', (await term.cancelRun('run-x')) === 1);
  const [ra, rb] = await Promise.all([a, b]);
  t('…y no los de otro run', ra.exitCode !== 0 && rb.timedOut);
}

/* ================================================================== */
section('Procesos gestionados (larga duración)');
{
  script('server.js', 'let n=0; setInterval(() => console.log("tick " + (n++)), 50)');
  const reg = new ManagedProcessRegistry(term, port);
  const svc = await reg.start({ executable: 'node', args: ['server.js'], cwd: PROJ }, { runId: 'run-dev', label: 'npm run dev' });
  await sleep(400);
  t('start devuelve estado running con pid', svc.status === 'running' && !!svc.pid && alive(svc.pid!));
  t('logs acumula la salida', reg.logs(svc.id).some((l) => l.startsWith('tick')));
  t('list sólo contiene lo que JARVIS inició', reg.list().length === 1);
  t('no se puede detener un id ajeno', await reg.stop('svc_ajeno').then(() => false, (e) => /no inició/.test(e.message)));
  const stopped = await reg.stopRun('run-dev');
  await sleep(500);
  t('stopRun detiene los servicios del run', stopped === 1 && reg.status(svc.id)!.status === 'stopped' && !alive(svc.pid!));
}

/* ================================================================== */
section('Descubrimiento de herramientas (reales)');
{
  const tools = await new DeveloperToolDiscovery(port, term).discover();
  console.log('TOOL_DISCOVERY ' + JSON.stringify(tools));
  const get = (id: string) => tools.find((x) => x.id === id)!;
  t('node detectado con versión', get('node').available && /^\d+\.\d+/.test(get('node').version ?? ''));
  t('git detectado con versión', get('git').available && get('git').version === execFileSync('git', ['--version']).toString().match(/\d+\.\d+\.\d+/)![0]);
  t('python3 se informa según el host', get('python3').available === !!(await port.which('python3')));
  t('java se informa según el host', get('java').available === !!(await port.which('java')));
  t('cargo, go y dotnet se informan según el host',
    (await Promise.all(['cargo', 'go', 'dotnet'].map(async (id) => get(id).available === !!(await port.which(id)) && (get(id).available || get(id).path === null)))).every(Boolean));
}

/* ================================================================== */
section('Git real: estado previo, cambios de JARVIS y restauración');
{
  const repo = path.join(TMP, 'repo');
  fs.mkdirSync(repo);
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
  g('init', '-q', '-b', 'main');
  g('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, 'b.ts'), 'export const b = 1;\n');
  g('add', '.'); g('commit', '-q', '-m', 'init');
  // Pre-existing user work.
  fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 2; // del usuario\n');
  fs.writeFileSync(path.join(repo, 'notes.md'), 'borrador\n');

  const git = new GitService(term);
  const st = await git.status(repo);
  t('status real: rama main, a.ts modificado, notes.md sin seguimiento', st.isRepo && st.branch === 'main' && st.entries.some((e) => e.path === 'a.ts' && e.worktree === 'M') && st.entries.some((e) => e.path === 'notes.md' && e.index === '?'));
  const baseline = await git.dirtyPaths(repo);
  t('un árbol sucio no impide trabajar', baseline.length === 2);

  // JARVIS changes b.ts; the user touches another file meanwhile.
  fs.writeFileSync(path.join(repo, 'b.ts'), 'export const b = 2;\n');
  fs.writeFileSync(path.join(repo, 'c.ts'), 'nuevo del usuario\n');
  const attr = attributeChanges({ baseline, now: await git.dirtyPaths(repo), jarvis: ['b.ts'] });
  t('atribución: a.ts y notes.md eran previos', attr.preExisting.includes('a.ts') && attr.preExisting.includes('notes.md'));
  t('atribución: b.ts es de JARVIS', attr.byJarvis.join() === 'b.ts');
  t('atribución: c.ts lo hizo el usuario durante la tarea', attr.byUserDuringRun.join() === 'c.ts');

  const diff = await git.diff(repo, { path: 'b.ts' });
  t('diff real de un archivo', diff.includes('-export const b = 1;') && diff.includes('+export const b = 2;'));
  t('log real', (await git.log(repo)).map((c) => c.subject).join() === 'init');
  t('branches', (await git.branches(repo)).current === 'main');
  t('show de HEAD:archivo', (await git.show(repo, 'HEAD', 'b.ts')).trim() === 'export const b = 1;');
  t('una ref que empieza por "-" se rechaza', await git.show(repo, '--output=/tmp/x').then(() => false, () => true));
  t('una ruta con ".." se rechaza', await git.diff(repo, { path: '../fuera' }).then(() => false, () => true));

  await git.restoreFiles(repo, ['b.ts'], baseline);
  t('restaurar un archivo que estaba limpio antes de JARVIS', fs.readFileSync(path.join(repo, 'b.ts'), 'utf8') === 'export const b = 1;\n');
  t('restaurar uno con cambios previos del usuario se niega', await git.restoreFiles(repo, ['a.ts'], baseline).then(() => false, (e) => /antes de que JARVIS empezara/.test(e.message)));
  t('…y su trabajo sigue intacto', fs.readFileSync(path.join(repo, 'a.ts'), 'utf8').includes('del usuario'));
  await git.add(repo, ['c.ts']);
  t('git add real', (await git.status(repo)).entries.some((e) => e.path === 'c.ts' && e.index === 'A'));
  await git.unstage(repo, ['c.ts']);
  t('unstage no toca el disco', fs.existsSync(path.join(repo, 'c.ts')) && (await git.status(repo)).entries.some((e) => e.path === 'c.ts' && e.index === '?'));
  t('commit deshabilitado por defecto', await git.commit(repo, 'x').then(() => false, (e) => /deshabilitados/.test(e.message)));
  t('GitService no tiene push, reset, clean ni rebase', !['push', 'reset', 'clean', 'rebase', 'forcePush'].some((m) => m in git));

  // Hostile repo config: fsmonitor would run a command on `git status`.
  const marker = path.join(TMP, 'pwned');
  g('config', 'core.fsmonitor', `touch ${marker}`);
  await git.status(repo);
  t('core.fsmonitor malicioso del repo NO se ejecuta', !fs.existsSync(marker));
  g('config', 'diff.external', `sh -c 'touch ${marker}'`);
  await git.diff(repo);
  t('diff.external malicioso del repo NO se ejecuta', !fs.existsSync(marker));

  t('porcelain -z con renombrado', (() => {
    const s = parsePorcelainZ('## main\0R  nuevo.ts\0viejo.ts\0 M a.ts\0');
    return s.branch === 'main' && s.entries[0]!.path === 'nuevo.ts' && s.entries[0]!.origPath === 'viejo.ts' && s.entries[1]!.worktree === 'M';
  })());
  const notRepo = await git.status(PROJ);
  t('una carpeta sin git no es repo, sin error', !notRepo.isRepo);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} ok · ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
