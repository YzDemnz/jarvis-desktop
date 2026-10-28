/**
 * Developer agent logic over in-memory ports with Windows path semantics:
 * discovery, technologies, index, watcher, search, context, planner, parsers.
 */
import { MemoryFsPort, MemorySnapshotPort, MemoryTrashPort } from '../../src/dev/memoryPorts';
import { PathGuard } from '../../src/dev/PathGuard';
import { ProjectService, MemoryConfigPort } from '../../src/dev/ProjectService';
import { ProjectIndexer } from '../../src/dev/ProjectIndexer';
import { ProjectWatcher } from '../../src/dev/ProjectWatcher';
import type { WatchPort, WatchEvent } from '../../src/dev/ProjectWatcher';
import { CodeSearch, unsafeRegex } from '../../src/dev/CodeSearch';
import { detectTechnologies } from '../../src/dev/technology';
import { IgnoreMatcher } from '../../src/dev/ignore';
import { FileMutationService } from '../../src/dev/FileMutationService';
import { CodeContextBuilder, detectChecks, parseFailures, parseProposal, keywordsOf } from '../../src/dev/coding';
import { devPlan, planRun } from '../../src/agent/planner';
import { isSecretFile, looksBinary } from '../../src/dev/classify';
import { TerminalService } from '../../src/dev/TerminalService';
import { ScriptedProcessPort } from '../../src/dev/scriptedProcess';
import type { RoutingDecision } from '../../src/types';

let pass = 0, fail = 0;
const t = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};
const section = (s: string) => console.log(`\n— ${s}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ================================================================== */
section('Detección de tecnologías');
{
  const pkg = JSON.stringify({ dependencies: { react: '18' }, devDependencies: { electron: '33', vite: '5', typescript: '5', tailwindcss: '3' } });
  const r = detectTechnologies(['package.json', 'tsconfig.json', 'vite.config.ts', 'src', '.git'], pkg);
  t('Electron + React + TS + Vite + Tailwind a la vez', ['node', 'typescript', 'vite', 'electron', 'react', 'tailwind'].every((x) => r.technologies.includes(x as never)));
  t('tipo principal: Electron', r.type === 'Electron');
  t('Rust por Cargo.toml', detectTechnologies(['Cargo.toml', 'src']).technologies.includes('rust'));
  t('Python por pyproject', detectTechnologies(['pyproject.toml']).type === 'Python');
  t('.NET por .sln/.csproj', detectTechnologies(['Vigilia.sln']).technologies.includes('dotnet'));
  t('Go, Java y CMake', detectTechnologies(['go.mod']).type === 'Go' && detectTechnologies(['pom.xml']).type === 'Java' && detectTechnologies(['CMakeLists.txt']).technologies.includes('cpp'));
  t('package.json malformado sigue siendo Node', detectTechnologies(['package.json'], '{roto').type === 'Node.js');
  t('sólo .git → repositorio', detectTechnologies(['.git', 'notas.txt']).type === 'Repositorio Git');
}

/* ================================================================== */
const mem = new MemoryFsPort('win32', {
  'D:\\Projects\\JARVIS\\package.json': JSON.stringify({ name: 'jarvis-desktop', scripts: { typecheck: 'tsc --noEmit', test: 'node t.js', build: 'vite build' }, devDependencies: { typescript: '5', electron: '33' } }),
  'D:\\Projects\\JARVIS\\tsconfig.json': '{}',
  'D:\\Projects\\JARVIS\\.gitignore': '*.log\n/generated/\n!keep.log\n',
  'D:\\Projects\\JARVIS\\src\\browser\\TabManager.ts': 'export class TabManager {\n  open(url: string) { return url; }\n}\n',
  'D:\\Projects\\JARVIS\\src\\app\\App.tsx': "import { TabManager } from '../browser/TabManager';\nconst tabs = new TabManager();\nexport function App() { return tabs.open('x'); }\n",
  'D:\\Projects\\JARVIS\\src\\big.ts': Array.from({ length: 3000 }, (_, i) => `export const v${i} = ${i}; // TabManager`).join('\n'),
  'D:\\Projects\\JARVIS\\.env': 'API_KEY=sk-live-x\n',
  'D:\\Projects\\JARVIS\\debug.log': 'ruido',
  'D:\\Projects\\JARVIS\\keep.log': 'se conserva',
  'D:\\Projects\\JARVIS\\generated\\x.ts': 'export {}',
  'D:\\Projects\\JARVIS\\node_modules\\react\\index.js': 'module.exports = {}',
  'D:\\Projects\\JARVIS\\assets\\logo.png': 'binario',
  'D:\\Projects\\ArmaReforger\\Mods\\Vigilia\\addon.gproj': 'x',
  'D:\\Projects\\ArmaReforger\\Tools\\sync\\pyproject.toml': '[project]',
  'D:\\Projects\\Docs\\notas.txt': 'no es un proyecto',
  'D:\\Projects\\Deep\\a\\b\\c\\d\\package.json': '{}',
  'C:\\Windows\\System32\\drivers\\etc\\hosts': '127.0.0.1',
});

section('Project Roots y rutas Windows (MemoryFsPort)');
const guard = new PathGuard(mem, { home: 'C:\\Users\\ana' });
{
  t('C:\\ entero no puede ser root', await guard.addRoot('C:\\').then(() => false, () => true));
  t('C:\\Windows no puede ser root', await guard.addRoot('C:\\Windows').then(() => false, () => true));
  t('D:\\Projects sí (case-insensitive: d:\\projects)', (await guard.addRoot('d:\\projects')) === 'D:\\Projects');
  const g = await guard.check('src\\app\\App.tsx', { write: true, base: 'D:\\Projects\\JARVIS' });
  t('relativa con \\ se resuelve dentro del root', g.relative === 'JARVIS/src/app/App.tsx');
  t('"..\\..\\..\\Windows" se rechaza', await guard.check('..\\..\\..\\Windows\\win.ini', { write: false, base: 'D:\\Projects\\JARVIS' }).then(() => false, () => true));
  t('mayúsculas distintas no burlan la protección', await guard.check('c:\\WINDOWS\\system32\\x.dll', { write: false }).then(() => false, (e) => /protegida/.test(e.message)));
  t('nombre reservado CON se rechaza', await guard.check('D:\\Projects\\JARVIS\\con.ts', { write: true }).then(() => false, () => true));
  t('flujo alternativo archivo:flujo se rechaza', await guard.check('D:\\Projects\\JARVIS\\a.ts:zone', { write: true }).then(() => false, () => true));
  t('ruta UNC se rechaza', await guard.check('\\\\server\\share\\x', { write: false }).then(() => false, () => true));
  t('\\\\?\\ se rechaza', await guard.check('\\\\?\\C:\\Windows', { write: false }).then(() => false, () => true));
}

section('Descubrimiento de proyectos');
const config = new MemoryConfigPort();
const projects = new ProjectService(mem, guard, { config });
{
  const found = await projects.discover();
  const names = found.map((p) => p.name).sort();
  t('encuentra JARVIS por package.json (usa el nombre del manifiesto)', names.includes('jarvis-desktop'));
  t('encuentra un proyecto Python anidado', found.some((p) => p.rootPath.endsWith('Tools\\sync') && p.type === 'Python'));
  t('una carpeta sin marcadores no es proyecto', !found.some((p) => p.rootPath.endsWith('Docs')));
  t('no desciende más de 3 niveles', !found.some((p) => p.rootPath.includes('Deep')));
  t('no entra en node_modules', !found.some((p) => p.rootPath.includes('node_modules')));
  t('fuera de los roots no busca (C:\\Windows)', !found.some((p) => p.rootPath.startsWith('C:')));
  t('resolve por nombre dentro de una frase', projects.resolve('abre mi proyecto jarvis-desktop y corrige el build')?.name === 'jarvis-desktop');
}

section('Índice incremental y .gitignore');
const jarvisId = projects.resolve('jarvis-desktop')!.id;
const opened = await projects.open(jarvisId);
const idx = opened.indexer;
{
  const files = idx.list().map((f) => f.relativePath).sort();
  t('indexa código fuente', files.includes('src/browser/TabManager.ts') && files.includes('src/app/App.tsx'));
  t('ignora node_modules por defecto', !files.some((f) => f.startsWith('node_modules')));
  t('respeta *.log de .gitignore', !files.includes('debug.log'));
  t('respeta la negación !keep.log', files.includes('keep.log'));
  t('respeta /generated/ anclado', !files.some((f) => f.startsWith('generated')));
  t('marca secretos y binarios sin leerlos como texto', idx.get('.env')!.secret && idx.get('assets/logo.png')!.binary && !idx.get('.env')!.hash);
  t('idioma por extensión', idx.get('src/app/App.tsx')!.language === 'typescript');
  t('el proyecto queda indexado con su recuento', opened.project.status === 'indexed' && opened.project.files === idx.size);
  t('lastOpened persiste en la configuración', ((await config.load())?.lastOpened[jarvisId] ?? 0) > 0);

  const r0 = await idx.refresh();
  t('refresh sin cambios no relee nada', r0.changed === 0 && r0.added === 0 && r0.unchanged === idx.size);
  await sleep(5);
  await mem.userEdit('D:\\Projects\\JARVIS\\src\\app\\App.tsx', "export function App() { return 'nuevo'; }\n");
  mem.seed('D:\\Projects\\JARVIS\\src\\util.ts', 'export const u = 1;\n');
  const r1 = await idx.refresh();
  t('refresh detecta 1 modificado y 1 nuevo', r1.changed === 1 && r1.added === 1, JSON.stringify(r1));
  const ig = new IgnoreMatcher();
  ig.add('build/\n**/*.tmp\n');
  t('matcher: carpeta con / final y **', ig.ignores('build', true) && ig.ignores('a/b/c.tmp', false) && !ig.ignores('src/build.ts', false));
}

section('Watcher: cambios externos sí, escrituras de JARVIS no (sin bucles)');
{
  let emit: (rel: string) => void = () => {};
  const port: WatchPort = { watch: (_root, cb) => { emit = cb; return () => {}; } };
  const watcher = new ProjectWatcher(port, idx, 'win32', 10);
  const events: WatchEvent[] = [];
  watcher.onChange((e) => events.push(e));
  watcher.start();
  mem.seed('D:\\Projects\\JARVIS\\src\\nuevo.ts', 'x');
  emit('src\\nuevo.ts');
  await sleep(40);
  t('archivo creado por el usuario → evento created', events.some((e) => e.type === 'created' && e.path === 'src/nuevo.ts'));
  t('y entra en el índice', !!idx.get('src/nuevo.ts'));
  const svc = new FileMutationService(mem, guard, new MemorySnapshotPort(), new MemoryTrashPort(mem, 'D:\\$bin'), { onSelfWrite: (p) => watcher.expectSelfWrite(p) });
  await svc.read('src\\util.ts', { runId: 'w', base: 'D:\\Projects\\JARVIS' });
  const before = events.length;
  await svc.patch('src\\util.ts', [{ kind: 'edit', edit: { oldText: '= 1', newText: '= 2' } }], { runId: 'w', base: 'D:\\Projects\\JARVIS' });
  emit('src\\util.ts');
  await sleep(40);
  t('la escritura de JARVIS no genera evento externo', events.length === before);
  t('…pero el índice sí se actualiza', idx.get('src/util.ts')!.size === 'export const u = 2;\n'.length);
  await mem.userEdit('D:\\Projects\\JARVIS\\src\\util.ts', 'export const u = 3;\n');
  emit('src\\util.ts');
  await sleep(40);
  t('una edición posterior del usuario sí se notifica', events.some((e) => e.type === 'modified' && e.path === 'src/util.ts'));
  emit('src\\util.ts'); emit('src\\util.ts'); emit('src\\util.ts');
  const n = events.length;
  await sleep(40);
  t('ráfagas se agrupan (debounce)', events.length - n <= 1);
  await mem.rename('D:\\Projects\\JARVIS\\src\\nuevo.ts', 'D:\\Projects\\JARVIS\\src\\renombrado.ts');
  emit('src\\nuevo.ts'); await sleep(15); emit('src\\renombrado.ts');
  await sleep(40);
  t('borrado + creación consecutivos → renamed', events.some((e) => e.type === 'renamed' && e.path === 'src/nuevo.ts' && e.toPath === 'src/renombrado.ts'), JSON.stringify(events.slice(-2)));
  mem.seed('D:\\Projects\\JARVIS\\.x.jarvis-tmp-abc', 'tmp');
  emit('.x.jarvis-tmp-abc');
  await sleep(30);
  t('los temporales de JARVIS se ignoran', !idx.get('.x.jarvis-tmp-abc'));
  watcher.stop();
}

section('Búsqueda de código');
const search = opened.search;
{
  const def = await search.findDefinition('TabManager');
  t('findDefinition: la clase exportada, con la columna del símbolo', def[0]?.file === 'src/browser/TabManager.ts' && def[0]?.line === 1 && def[0]?.column === 'export class TabManager {'.indexOf('TabManager') + 1);
  const refs = await search.findReferences('TabManager');
  t('findReferences incluye import y uso (con línea y columna)', refs.some((r) => r.file === 'src/browser/TabManager.ts') && new Set(refs.map((r) => r.file)).size >= 2 && refs.every((r) => r.line > 0 && r.column > 0));
  t('un archivo ruidoso no acapara los resultados (tope por archivo)', refs.filter((r) => r.file === 'src/big.ts').length <= 20);
  t('búsqueda de archivos por nombre', search.searchFiles('tabmanager')[0]?.file === 'src/browser/TabManager.ts');
  t('búsqueda difusa', search.searchFiles('tbmgr').length > 0);
  const text = await search.searchText('open(url');
  t('searchText con preview y puntuación', text[0]?.preview.includes('open(url: string)') && text[0]!.score > 0);
  t('nunca busca en secretos', (await search.searchText('sk-live')).length === 0);
  t('regex con cuantificadores anidados rechazada', unsafeRegex('(a+)+$') !== null && await search.searchText('(a+)+$', { regex: true }).then(() => false, () => true));
  t('regex segura permitida', (await search.searchText('class\\s+Tab', { regex: true })).length === 1);
  t('símbolo inválido rechazado', await search.findReferences('a b').then(() => false, () => true));
}

section('CodeContextBuilder: límites y secretos');
{
  const builder = new CodeContextBuilder(mem, idx, search, { maxBytes: 3000, maxFiles: 3, maxBytesPerFile: 1200, windowLines: 5 });
  const ctx = await builder.build({ project: opened.project, query: 'arregla TabManager', failures: [{ check: 'typecheck', exitCode: 2, excerpt: '', errors: [{ file: 'src/big.ts', line: 1500, column: 3, message: 'TS2322' }] }] });
  t('el archivo del error va primero', ctx.files[0]?.path === 'src/big.ts' && ctx.files[0]!.reason === 'aparece en un error');
  t('un archivo grande se recorta alrededor de la línea del error', ctx.files[0]!.truncated && ctx.files[0]!.content.includes('1500: export const v1499') && !ctx.files[0]!.content.includes('v10 '));
  t('respeta el máximo de archivos', ctx.files.length <= 3);
  t('respeta el presupuesto de bytes', ctx.bytes <= 3000 && ctx.approxTokens === Math.ceil(ctx.bytes / 4));
  t('excluye secretos: sólo se sabe que existen', ctx.excluded.includes('.env') && !JSON.stringify(ctx.files).includes('sk-live'));
  t('incluye metadatos y scripts del paquete', ctx.project.scripts.typecheck === 'tsc --noEmit');
  const vague = await builder.build({ project: opened.project, query: 'fallan las pruebas', failures: [{ check: 'test', exitCode: 1, excerpt: 'npm test falló', errors: [] }] });
  t('un fallo de pruebas sin ruta incluye código fuente del proyecto pequeño', vague.files.some((f) => f.path === 'src/app/App.tsx') && !vague.files.some((f) => f.path === '.env'));
  t('palabras clave sin relleno', keywordsOf('Corrige el error del navegador TabManager').join() === 'navegador,TabManager');
}

section('Verificación, fallos y propuestas');
{
  const checks = detectChecks({ technologies: ['node', 'typescript'] }, { typecheck: 'tsc', lint: 'eslint .', test: 'vitest', build: 'vite build' }, () => true);
  t('elige typecheck, lint, build y tests del proyecto, en ese orden', checks.map((c) => c.id).join() === 'typecheck,lint,build,test');
  t('sin script de tipos usa npx --no-install tsc', detectChecks({ technologies: ['node', 'typescript'] }, {}, () => true)[0]?.request.args.join(' ') === '--no-install tsc --noEmit');
  t('el test por defecto de npm no cuenta', !detectChecks({ technologies: ['node'] }, { test: 'echo "Error: no test specified" && exit 1' }, () => true).length);
  t('Rust sin cargo instalado → sin verificación (no asume)', detectChecks({ technologies: ['rust'] }, {}, (x) => x !== 'cargo').length === 0);
  const f = parseFailures('typecheck', 2, "src/browser/TabManager.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/app/App.tsx:3:7 - error TS2554: Expected 1 arguments");
  t('parsea errores de tsc (dos formatos)', f.errors.length === 2 && f.errors[0]!.file === 'src/browser/TabManager.ts' && f.errors[0]!.line === 12 && f.errors[1]!.line === 3);
  t('parsea tracebacks de Python y fallos de tests', parseFailures('t', 1, '  File "app/main.py", line 7, in x\n✗ suma falla').errors.length === 2);
  t('propuesta JSON válida', parseProposal('bla {"rationale":"r","edits":[{"path":"src/a.ts","ops":[{"kind":"insert","atLine":1,"text":"x"}]}]} fin')?.edits.length === 1);
  t('propuesta con ruta absoluta o ".." se descarta', parseProposal('{"edits":[{"path":"C:/Windows/x","ops":[{"kind":"insert","atLine":1,"text":"x"}]}]}') === null && parseProposal('{"edits":[{"path":"../x","ops":[{"kind":"insert","atLine":1,"text":"x"}]}]}') === null);
  t('propuesta con operación desconocida se descarta', parseProposal('{"edits":[{"path":"a","ops":[{"kind":"shell","cmd":"rm"}]}]}') === null);
}

section('Planificador de programación');
{
  const route = { taskType: 'chat' } as RoutingDecision;
  const plan = planRun({ runId: 'r', prompt: 'Abre mi proyecto JARVIS, encuentra por qué falla el build, corrígelo y ejecuta las pruebas', routing: route });
  t('tarea de código → un paso delegado "coding"', plan.some((s) => s.kind === 'delegate' && s.delegate === 'coding'));
  t('git status → herramienta de sólo lectura', devPlan('git status', 'chat')?.[0]?.toolId === 'git.status');
  t('find symbol TabManager → definición + referencias', devPlan('find symbol TabManager', 'chat')?.map((s) => s.toolId).join() === 'code.findDefinition,code.findReferences');
  t('deshacer cambios de JARVIS → changes.undoLast', devPlan('Deshaz los cambios de JARVIS', 'chat')?.[0]?.toolId === 'changes.undoLast');
  t('mostrar cambios → changes.review', devPlan('muéstrame los cambios', 'chat')?.[0]?.toolId === 'changes.review');
  t('"Abre VS Code…" sigue siendo control del escritorio', !planRun({ runId: 'r', prompt: 'Abre VS Code y el proyecto Vigilia', routing: { taskType: 'computer_control' } as RoutingDecision }).some((s) => s.toolId === 'project.open'));
  t('una conversación normal no genera plan de código', devPlan('¿qué tiempo hace hoy?', 'chat') === null);
  const constrained = devPlan('Corrige las pruebas del proyecto demo, sin cambiar dependencias ni pruebas.', 'code_debugging')?.[0];
  t('restricciones de dependencias/tests no cancelan reparación de fuente', constrained?.delegate === 'coding' && JSON.stringify(constrained.args).includes('"noDependencies":true') && JSON.stringify(constrained.args).includes('"noCheckChanges":true'));
  t('readonly global conserva veto incluso con restricciones específicas', !devPlan('Revisa el proyecto demo sin modificar nada, sin cambiar dependencias.', 'code_debugging')?.some(s => s.kind === 'delegate'));
  t('restricciones inglesas conservan delegate y checks inmutables', JSON.stringify(devPlan('Fix project demo without changing dependencies and tests', 'code_debugging')).includes('"noCheckChanges":true'));
}

section('Clasificación de archivos');
t('secretos: .env, .env.local, id_ed25519, *.pem, credentials.json', ['.env', '.env.local', 'id_ed25519', 'server.pem', 'credentials.json', 'secrets.yaml'].every(isSecretFile));
t('.env.example no es secreto', !isSecretFile('.env.example'));
t('binario por byte nulo', looksBinary(new Uint8Array([72, 0, 73])) && !looksBinary(new TextEncoder().encode('hola\nmundo')));

section('Terminal con puerto de procesos con guion (Windows simulado)');
{
  const port = new ScriptedProcessPort(({ command }) => (command === 'npm test' ? { stdout: ['✓ 12\n', '✗ 1\n'], code: 1, delayMs: 20 } : command.startsWith('npm run dev') ? { stdout: 'listo', forever: true } : null), ['npm', 'node']);
  const term = new TerminalService(port);
  const r = await term.execute({ executable: 'npm', args: ['test'], cwd: 'D:\\Projects\\JARVIS' });
  t('código de salida y salida de un comando con guion', r.exitCode === 1 && r.stdout.includes('✗ 1'));
  const ac = new AbortController();
  const p = term.execute({ executable: 'npm', args: ['run', 'dev'], cwd: 'D:\\Projects\\JARVIS' }, { signal: ac.signal, runId: 'x' });
  await sleep(20); ac.abort();
  const pr = await p;
  t('cancelar mata el árbol (killTree) del proceso propio', pr.cancelled && port.spawned.at(-1)!.killed);
  t('un ejecutable no instalado falla sin asumir', await term.execute({ executable: 'cargo', args: ['build'], cwd: 'D:\\P' }).then(() => false, (e) => /no está instalado/.test(e.message)));
}

console.log(`\n${pass} ok · ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
