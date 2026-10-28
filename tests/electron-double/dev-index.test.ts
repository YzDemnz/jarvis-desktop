/**
 * Indexer, watcher, search, context, ChangeSet and coding planner on the REAL
 * temporary filesystem. Watcher tests exercise the host's real fs.watch,
 * including NTFS when run on Windows.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NodeFsPort, NodeWatchPort, DirectoryTrashPort, DiskSnapshotPort } from '../../electron/dev/nodePorts';
import { PathGuard } from '../../src/dev/PathGuard';
import { ProjectService } from '../../src/dev/ProjectService';
import { ProjectIndexer } from '../../src/dev/ProjectIndexer';
import { ProjectWatcher } from '../../src/dev/ProjectWatcher';
import type { WatchEvent } from '../../src/dev/ProjectWatcher';
import { CodeSearch } from '../../src/dev/CodeSearch';
import { FileMutationService } from '../../src/dev/FileMutationService';
import { CodeContextBuilder } from '../../src/dev/coding';
import { massChangeReason } from '../../src/dev/ChangeSetStore';
import { planRun } from '../../src/agent/planner';
import { heuristicRoute } from '../../src/services/ai/routing';
import { sha256 } from '../../src/dev/hash';

let pass = 0, fail = 0;
const t = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};
const section = (s: string) => console.log(`\n— ${s}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await sleep(20); return cond(); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-index-'));
const ROOT = path.join(TMP, 'Projects');
const P = path.join(ROOT, 'app');
const w = (rel: string, content: string | Buffer) => { const f = path.join(P, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); return f; };
w('package.json', JSON.stringify({ name: 'app', scripts: { test: 'node t.js', typecheck: 'tsc' }, dependencies: { react: '18' } }, null, 2));
w('.gitignore', 'coverage-report/\n*.tmp\n/secret-build/\n');
w('src/browser/TabManager.ts', 'export class TabManager {\n  open(url: string) { return url; }\n  close() {}\n}\n');
w('src/app/App.tsx', "import { TabManager } from '../browser/TabManager';\nconst tabs = new TabManager();\nexport const App = () => tabs.open('home');\n");
w('src/util/format.ts', 'export function formatBytes(n: number) { return `${n} B`; }\n');
w('tests/tab.test.ts', "import { TabManager } from '../src/browser/TabManager';\ntest('open', () => new TabManager().open('x'));\n");
w('node_modules/react/index.js', 'module.exports = "TabManager en dependencias";');
w('dist/bundle.js', 'var TabManager=1;');
w('coverage-report/index.html', '<p>TabManager</p>');
w('secret-build/out.txt', 'TabManager');
w('scratch.tmp', 'TabManager');
w('.env', 'API_KEY=sk-live-realdisk-123456\n');
w('config/credentials.json', '{"token":"ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"}');
w('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]));
w('data/blob.dat', Buffer.from([1, 2, 0, 3, 4, 0, 5]));
w('logs/huge.log', Array.from({ length: 70_000 }, (_, i) => `línea ${i} TabManager ruido`).join('\n'));
w('packages/inner/package.json', JSON.stringify({ name: 'inner' }));
w('packages/inner/index.ts', 'export const inner = 1;\n');
const OUTSIDE = path.join(TMP, 'outside');
fs.mkdirSync(OUTSIDE);
fs.writeFileSync(path.join(OUTSIDE, 'leak.ts'), 'export const TabManager = "fuera";\n');
const OUTSIDE_LINK = path.join(P, 'linked-outside');
fs.symlinkSync(OUTSIDE, OUTSIDE_LINK, process.platform === 'win32' ? 'junction' : 'dir');

const nodeFs = new NodeFsPort();
const guard = new PathGuard(nodeFs, { protectedPaths: ['/etc', '/usr'], home: os.homedir() });
await guard.addRoot(ROOT);

/* ================================================================== */
section('ProjectIndexer (disco real)');
const idx = new ProjectIndexer(nodeFs, fs.realpathSync(P));
{
  const d = await idx.build();
  const files = idx.list().map((f) => f.relativePath);
  t('índice inicial con el código fuente', ['src/browser/TabManager.ts', 'src/app/App.tsx', 'tests/tab.test.ts'].every((f) => files.includes(f)) && d.added === idx.size);
  t('ignora node_modules y dist', !files.some((f) => f.startsWith('node_modules/') || f.startsWith('dist/')));
  t('respeta .gitignore: carpeta, extensión y ruta anclada', !files.some((f) => f.startsWith('coverage-report/') || f.endsWith('.tmp') || f.startsWith('secret-build/')));
  t('no sigue el symlink que sale del proyecto', !files.some((f) => f.startsWith('linked-outside')));
  t('binarios marcados por extensión, sin hash', idx.get('assets/logo.png')!.binary && !idx.get('assets/logo.png')!.hash);
  t('secretos marcados, sin hash', idx.get('.env')!.secret && idx.get('config/credentials.json')!.secret && !idx.get('.env')!.hash);
  t('archivo grande indexado por metadatos, sin hash', !!idx.get('logs/huge.log') && !idx.get('logs/huge.log')!.hash && idx.get('logs/huge.log')!.size > 1024 * 1024);
  t('hash SHA-256 correcto para texto pequeño', idx.get('src/util/format.ts')!.hash === sha256(fs.readFileSync(path.join(P, 'src/util/format.ts'), 'utf8')));
  t('mtime real registrado', Math.abs(idx.get('src/util/format.ts')!.mtimeMs - fs.statSync(path.join(P, 'src/util/format.ts')).mtimeMs) < 1);
  t('proyectos anidados: sus archivos pertenecen al índice del padre', files.includes('packages/inner/index.ts'));

  const r0 = await idx.refresh();
  t('refresh sin cambios: nada releído', r0.changed === 0 && r0.added === 0 && r0.removed === 0);
  const hashBefore = idx.get('src/util/format.ts')!.hash;
  await sleep(15);
  w('src/util/format.ts', 'export function formatBytes(n: number) { return `${n} bytes`; }\n');
  w('src/util/new.ts', 'export const n = 1;\n');
  fs.renameSync(path.join(P, 'tests/tab.test.ts'), path.join(P, 'tests/tabs.test.ts'));
  fs.unlinkSync(path.join(P, 'src/app/App.tsx'));
  const r1 = await idx.refresh();
  t('incremental: 1 modificado, 2 nuevos (incl. renombrado), 2 eliminados', r1.changed === 1 && r1.added === 2 && r1.removed === 2, JSON.stringify(r1));
  t('el hash cambia con el contenido', idx.get('src/util/format.ts')!.hash !== hashBefore);
  t('renombrado: desaparece el viejo y aparece el nuevo', !idx.get('tests/tab.test.ts') && !!idx.get('tests/tabs.test.ts'));
  t('borrado reflejado', !idx.get('src/app/App.tsx'));
  w('src/app/App.tsx', "import { TabManager } from '../browser/TabManager';\nconst tabs = new TabManager();\nexport const App = () => tabs.open('home');\n");
  t('update() de un solo archivo', (await idx.update('src/app/App.tsx')) === 'added' && (await idx.update('scratch.tmp')) === 'ignored');
  t('update() de un archivo borrado', (fs.unlinkSync(path.join(P, 'src/util/new.ts')), await idx.update('src/util/new.ts')) === 'removed');
}

/* ================================================================== */
section('ProjectService: proyectos anidados y symlinks (disco real)');
{
  const svc = new ProjectService(nodeFs, guard);
  const found = await svc.discover();
  t('descubre el proyecto raíz, no desciende en él', found.some((p) => p.name === 'app') && !found.some((p) => p.name === 'inner'));
  t('no descubre nada a través del symlink externo', !found.some((p) => p.rootPath.startsWith(OUTSIDE)));
}

/* ================================================================== */
section('ProjectWatcher sobre fs.watch de Linux (lógica portable, no NTFS)');
{
  const watcher = new ProjectWatcher(new NodeWatchPort(), idx, 'posix', 60);
  const events: WatchEvent[] = [];
  watcher.onChange((e) => events.push(e));
  watcher.start();
  await sleep(100);
  w('src/watched.ts', 'export const a = 1;\n');
  t('create → evento y entrada en el índice', await until(() => events.some((e) => e.type === 'created' && e.path === 'src/watched.ts')) && !!idx.get('src/watched.ts'));
  await sleep(100);
  w('src/watched.ts', 'export const a = 2;\n');
  t('modify → evento modified y tamaño actualizado', await until(() => events.some((e) => e.type === 'modified' && e.path === 'src/watched.ts')));
  const n0 = events.length;
  for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(P, 'src/watched.ts'), `export const a = ${i};\n`);
  await sleep(400);
  t('ráfaga de 25 escrituras → como mucho 2 eventos (debounce)', events.length - n0 <= 2, String(events.length - n0));
  fs.renameSync(path.join(P, 'src/watched.ts'), path.join(P, 'src/watched-renamed.ts'));
  t('rename → renamed (o delete+create) y el índice sigue al archivo', await until(() => !!idx.get('src/watched-renamed.ts') && !idx.get('src/watched.ts')));
  t('…emparejado como renamed', events.some((e) => e.type === 'renamed' && e.toPath === 'src/watched-renamed.ts'), JSON.stringify(events.slice(-3)));
  fs.unlinkSync(path.join(P, 'src/watched-renamed.ts'));
  t('delete → deleted', await until(() => events.some((e) => e.type === 'deleted' && e.path === 'src/watched-renamed.ts') && !idx.get('src/watched-renamed.ts')));

  // Own writes: the index updates, no external event.
  const svc = new FileMutationService(nodeFs, guard, new DiskSnapshotPort(path.join(TMP, 'snaps-w')), new DirectoryTrashPort(path.join(TMP, 'bin-w')), { onSelfWrite: (p) => watcher.expectSelfWrite(p) });
  await sleep(150);
  const before = events.length;
  const base = fs.realpathSync(P);
  await svc.create('src/by-jarvis.ts', 'export const j = 1;\n', { runId: 'rw', base });
  await sleep(350);
  t('escritura propia de JARVIS: el índice se actualiza', !!idx.get('src/by-jarvis.ts'));
  t('…sin evento externo (no hay bucle)', events.slice(before).every((e) => e.path !== 'src/by-jarvis.ts'), JSON.stringify(events.slice(before)));
  fs.writeFileSync(path.join(P, 'src/by-jarvis.ts'), 'export const j = 2; // usuario\n');
  t('una edición humana posterior sí se notifica', await until(() => events.some((e) => e.path === 'src/by-jarvis.ts' && e.type === 'modified')));

  watcher.stop();
  const stopped = events.length;
  w('src/after-stop.ts', 'x');
  await sleep(300);
  t('stop: no llegan más eventos', events.length === stopped);
  watcher.start();
  await sleep(100);
  w('src/after-restart.ts', 'x');
  t('restart: vuelven los eventos', await until(() => events.some((e) => e.path === 'src/after-restart.ts')));
  watcher.stop();
  watcher.stop();
  t('stop doble no falla', true);
  fs.unlinkSync(path.join(P, 'src/after-stop.ts')); fs.unlinkSync(path.join(P, 'src/after-restart.ts'));
  await idx.refresh();
}

/* ================================================================== */
section('CodeSearch (disco real)');
const search = new CodeSearch(nodeFs, idx);
{
  const text = await search.searchText('TabManager');
  t('varios resultados con línea, columna y vista previa', text.length >= 3 && text.every((h) => h.line > 0 && h.column > 0 && h.preview.length > 0));
  t('código fuente por delante de pruebas en el ranking', text.findIndex((h) => h.file.startsWith('src/')) < text.findIndex((h) => h.file.startsWith('tests/')));
  t('nunca devuelve node_modules, dist, ignorados ni el symlink externo', !text.some((h) => /node_modules|dist\/|coverage-report|secret-build|\.tmp$|linked-outside/.test(h.file)));
  t('nunca busca en .env ni credenciales', (await search.searchText('sk-live')).length === 0 && (await search.searchText('ghp_')).length === 0);
  t('archivos grandes (>1 MB) no se escanean', !text.some((h) => h.file === 'logs/huge.log'));
  t('binarios excluidos', (await search.searchText('PNG')).length === 0);
  t('sin resultados → lista vacía', (await search.searchText('zzz-no-existe-zzz')).length === 0);
  t('mayúsculas: por defecto insensible, opcionalmente sensible', (await search.searchText('tabmanager')).length > 0 && (await search.searchText('tabmanager', { caseSensitive: true })).length === 0);
  const files = search.searchFiles('format');
  t('searchFiles: coincidencia exacta de nombre primero', files[0]?.file === 'src/util/format.ts');
  t('searchFiles sin resultados', search.searchFiles('qqqqzz').length === 0);
  const def = await search.findDefinition('formatBytes');
  t('findDefinition de una función exportada', def[0]?.file === 'src/util/format.ts' && def[0]?.line === 1);
  const refs = await search.findReferences('TabManager');
  t('findReferences: definición, import en App y en las pruebas', ['src/browser/TabManager.ts', 'src/app/App.tsx', 'tests/tabs.test.ts'].every((f) => refs.some((r) => r.file === f)));
  t('findReferences no confunde subcadenas', !(await search.findReferences('Tab')).length);
}

/* ================================================================== */
section('CodeContextBuilder (disco real): sólo lo relevante');
{
  const total = idx.list().filter((f) => !f.binary).reduce((n, f) => n + f.size, 0);
  const builder = new CodeContextBuilder(nodeFs, idx, search, { maxBytes: 4096, maxFiles: 4, maxBytesPerFile: 1500, windowLines: 3 });
  const project = { id: 'x', name: 'app', rootPath: P, type: 'React', technologies: ['react', 'node'], markers: [], git: { isRepo: false, branch: null, dirty: false, changedFiles: 0 }, files: idx.size, status: 'indexed', lastOpened: null } as never;
  const ctx = await builder.build({
    project, query: 'corrige formatBytes', recent: ['src/app/App.tsx'],
    failures: [{ check: 'test', exitCode: 1, excerpt: '', errors: [{ file: 'src/browser/TabManager.ts', line: 3, message: 'close is not a function' }, { file: 'logs/huge.log', line: 50000, message: 'x' }] }],
  });
  const paths = ctx.files.map((f) => f.path);
  t('prioridad: error → cambio reciente → coincidencia', paths[0] === 'src/browser/TabManager.ts' && paths.indexOf('src/app/App.tsx') < paths.indexOf('src/util/format.ts'), paths.join());
  t('incluye la coincidencia de búsqueda (definición)', paths.includes('src/util/format.ts') && ctx.matches.some((m) => m.kind === 'definition' && m.file === 'src/util/format.ts'));
  t('incluye los errores', ctx.errors.length === 2);
  t('metadatos del paquete', ctx.project.scripts.test === 'node t.js');
  t('.env y credenciales excluidos, sólo nombrados', ctx.excluded.includes('.env') && ctx.excluded.includes('config/credentials.json') && !JSON.stringify(ctx.files).includes('sk-live') && !JSON.stringify(ctx.files).includes('ghp_'));
  t('un archivo gigante del error se recorta alrededor de la línea', (() => { const huge = ctx.files.find((f) => f.path === 'logs/huge.log'); return !huge || (huge.truncated && huge.content.includes('50000:') && huge.content.length <= 1500); })());
  t('binarios nunca entran', !paths.some((p) => /\.png$|\.dat$/.test(p)));
  t('respeta el presupuesto de bytes y de archivos', ctx.bytes <= 4096 && ctx.files.length <= 4);
  t(`no manda el proyecto completo (${ctx.bytes} de ${total} bytes)`, ctx.bytes < total / 50);
}

/* ================================================================== */
section('ChangeSet ampliado (disco real)');
{
  const snapDir = path.join(TMP, 'snaps-cs');
  const svc = new FileMutationService(nodeFs, guard, new DiskSnapshotPort(snapDir), new DirectoryTrashPort(path.join(TMP, 'bin-cs')));
  const base = fs.realpathSync(P);
  const run = 'cs-1';
  for (const f of ['src/util/format.ts', 'src/browser/TabManager.ts']) await svc.read(f, { runId: run, base });
  await svc.patch('src/util/format.ts', [{ kind: 'edit', edit: { oldText: 'bytes', newText: 'B' } }], { runId: run, base });
  await svc.patch('src/browser/TabManager.ts', [{ kind: 'edit', edit: { oldText: 'close() {}', newText: 'close() { return true; }' } }], { runId: run, base });
  await svc.create('src/new/one.ts', 'export const one = 1;\n', { runId: run, base });
  await svc.move('src/new/one.ts', 'src/new/uno.ts', { runId: run, base }, 'rename');
  w('obsolete.md', 'viejo\n');
  await svc.trash('obsolete.md', { runId: run, base });
  const sum = svc.changes.summary(run)!;
  const st = Object.fromEntries(sum.files.map((f) => [f.toPath ? path.basename(f.toPath) : path.basename(f.path), f.status]));
  t('varios archivos: M, M, R (creado y renombrado), T', st['format.ts'] === 'M' && st['TabManager.ts'] === 'M' && st['uno.ts'] === 'R' && st['obsolete.md'] === 'T', JSON.stringify(st));

  // User edits TabManager after JARVIS on a DIFFERENT line.
  const tm = path.join(P, 'src/browser/TabManager.ts');
  fs.writeFileSync(tm, fs.readFileSync(tm, 'utf8').replace('export class TabManager {', '// del usuario\nexport class TabManager {'));
  const partial = await svc.revertFile(run, fs.realpathSync(path.join(P, 'src/util/format.ts')));
  t('Revert File: sólo ese archivo vuelve atrás', fs.readFileSync(path.join(P, 'src/util/format.ts'), 'utf8').includes('bytes') && fs.readFileSync(tm, 'utf8').includes('return true') && partial.restored.length === 1);
  t('el run no queda marcado como revertido tras un revert parcial', !svc.changes.get(run)!.reverted);
  const full = await svc.revertRun(run);
  t('Revert Run: TabManager restaurado conservando la línea del usuario', !fs.readFileSync(tm, 'utf8').includes('return true') && fs.readFileSync(tm, 'utf8').includes('// del usuario'));
  t('…archivo creado y renombrado retirado, papelera restaurada', !fs.existsSync(path.join(P, 'src/new/uno.ts')) && fs.readFileSync(path.join(P, 'obsolete.md'), 'utf8') === 'viejo\n');
  t('…sin conflictos', full.conflicts.length === 0, JSON.stringify(full));

  // Conflict: the user rewrote the very line JARVIS changed.
  await svc.read('src/util/format.ts', { runId: 'cs-2', base });
  await svc.patch('src/util/format.ts', [{ kind: 'edit', edit: { oldText: 'bytes', newText: 'octetos' } }], { runId: 'cs-2', base });
  fs.writeFileSync(path.join(P, 'src/util/format.ts'), fs.readFileSync(path.join(P, 'src/util/format.ts'), 'utf8').replace('octetos', 'octetos!!'));
  const clash = await svc.revertRun('cs-2');
  t('conflicto: se informa y no se toca el archivo', clash.conflicts.length === 1 && fs.readFileSync(path.join(P, 'src/util/format.ts'), 'utf8').includes('octetos!!'));

  const snapsBefore = fs.readdirSync(snapDir).length;
  const gone = await svc.forgetRun(run);
  t('limpieza de instantáneas: forgetRun borra sólo las no referenciadas', gone.deleted > 0 && fs.readdirSync(snapDir).length === snapsBefore - gone.deleted && fs.readdirSync(snapDir).length > 0);
  t('…y el run olvidado ya no se puede revertir', (await svc.revertRun(run)).restored.length === 0);
  t('cambio masivo por ChangeSet completo, no por llamada', massChangeReason(svc.changes.get('cs-2'), { path: path.join(P, 'x'), bytes: 1, trash: false }, { maxFiles: 1, maxBytes: 1e9, maxTrash: 9 }) !== null);
}

/* ================================================================== */
section('Planificador: frases variadas y enrutado');
{
  const plan = (prompt: string) => planRun({ runId: 'r', prompt, routing: heuristicRoute(prompt) });
  const kind = (prompt: string) => {
    const steps = plan(prompt);
    const tools = steps.map((s) => s.toolId).filter(Boolean) as string[];
    if (steps.some((s) => s.kind === 'delegate')) return 'developer';
    if (tools.some((x) => /^(app|window|ui|desktop)\./.test(x))) return 'desktop';
    if (tools.some((x) => /^(project|git|code|changes)\./.test(x))) return 'developer-read';
    if (tools.some((x) => x.startsWith('filesystem.'))) return 'filesystem';
    if (tools.some((x) => x.startsWith('browser.'))) return 'browser';
    return 'general';
  };
  const cases: [string, string][] = [
    ['Corrige el error de TypeScript', 'developer'],
    ['Encuentra por qué falla npm test', 'developer'],
    ['Cambia este componente y prueba que siga funcionando', 'developer'],
    ['Arregla el build pero no cambies dependencias', 'developer'],
    ['Abre mi proyecto JARVIS, encuentra por qué falla el build y corrígelo', 'developer'],
    ['Revisa este proyecto sin modificarlo', 'developer-read'],
    ['git status', 'developer-read'],
    ['find symbol TabManager', 'developer-read'],
    ['Abre VS Code', 'desktop'],
    ['Abre Blender', 'desktop'],
    ['Busca el archivo presupuesto.xlsx en mis documentos', 'filesystem'],
    ['¿Qué es una mónada?', 'general'],
  ];
  for (const [prompt, expected] of cases) t(`«${prompt}» → ${expected}`, kind(prompt) === expected, kind(prompt));
  const noDeps = plan('Arregla el build pero no cambies dependencias').find((s) => s.kind === 'delegate');
  t('"no cambies dependencias" viaja como restricción del delegado', (noDeps?.args as { constraints?: { noDependencies?: boolean } })?.constraints?.noDependencies === true, JSON.stringify(noDeps?.args));
  const ro = plan('Revisa este proyecto sin modificarlo');
  t('sólo lectura: ninguna herramienta que escriba', !ro.some((s) => /^(file\.|directory\.|terminal\.|git\.(add|restore|commit)|changes\.(revert|undo))/.test(s.toolId ?? '')));
}

if (fs.lstatSync(OUTSIDE_LINK, { throwIfNoEntry: false })) fs.unlinkSync(OUTSIDE_LINK);
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} ok · ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
