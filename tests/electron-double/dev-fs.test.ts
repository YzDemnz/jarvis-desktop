/**
 * Developer agent against a REAL temporary filesystem. On Windows directory
 * links use NTFS junctions, which do not require Developer Mode.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NodeFsPort, DirectoryTrashPort, DiskSnapshotPort } from '../../electron/dev/nodePorts';
import { PathGuard, PathDeniedError } from '../../src/dev/PathGuard';
import { FileMutationService, ConflictError } from '../../src/dev/FileMutationService';
import { sha256 } from '../../src/dev/hash';
import { massChangeReason } from '../../src/dev/ChangeSetStore';

let pass = 0, fail = 0;
const t = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};
const section = (s: string) => console.log(`\n— ${s}`);
const throwsAsync = async (fn: () => Promise<unknown>, match?: RegExp | (new (...a: never[]) => Error)): Promise<boolean> => {
  try { await fn(); return false; } catch (e) {
    if (!match) return true;
    if (match instanceof RegExp) return match.test(e instanceof Error ? e.message : String(e));
    return e instanceof match;
  }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-devfs-'));
const ROOT = path.join(TMP, 'Projects');
const PROJ = path.join(ROOT, 'vigilia');
const OUTSIDE = path.join(TMP, 'outside');
const BIN = path.join(TMP, 'bin');
const SNAPS = path.join(TMP, 'snapshots');
const IS_WINDOWS = process.platform === 'win32';
const SYSTEM_PROTECTED = IS_WINDOWS ? (process.env.SystemRoot ?? 'C:\\Windows') : '/etc';
const links: string[] = [];
function directoryLink(target: string, name: string): void {
  fs.symlinkSync(target, name, IS_WINDOWS ? 'junction' : 'dir');
  links.push(name);
}
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
fs.mkdirSync(OUTSIDE, { recursive: true });
fs.writeFileSync(path.join(PROJ, 'package.json'), '{\n  "name": "vigilia",\n  "scripts": { "test": "node test.js" }\n}\n');
fs.writeFileSync(path.join(PROJ, 'src', 'app.ts'), 'export const port = 3000;\nexport function start() {\n  return port;\n}\n');
fs.writeFileSync(path.join(OUTSIDE, 'secret.txt'), 'fuera del root\n');
fs.writeFileSync(path.join(PROJ, '.env'), 'API_KEY=sk-live-1234567890abcdef\nDEBUG=true\n');
fs.writeFileSync(path.join(PROJ, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3]));

const nodeFs = new NodeFsPort();
function makeService(opts: { protectedPaths?: string[] } = {}) {
  const guard = new PathGuard(nodeFs, { protectedPaths: opts.protectedPaths ?? [SYSTEM_PROTECTED, path.join(TMP, 'protected')], home: os.homedir() });
  const selfWrites: string[] = [];
  const svc = new FileMutationService(nodeFs, guard, new DiskSnapshotPort(SNAPS), new DirectoryTrashPort(BIN), { onSelfWrite: (p) => selfWrites.push(p) });
  return { guard, svc, selfWrites };
}
const read = (p: string) => fs.readFileSync(p, 'utf8');

/* ================================================================== */
section('Project Roots');
{
  const { guard } = makeService();
  t('un root válido se acepta y se canonicaliza', (await guard.addRoot(ROOT)) === fs.realpathSync(ROOT));
  t('una unidad completa no puede ser root', await throwsAsync(() => guard.addRoot(path.parse(TMP).root), /unidad completa/));
  t('una carpeta del sistema no puede ser root', await throwsAsync(() => guard.addRoot(SYSTEM_PROTECTED), /protegida/));
  t('un ancestro de una ruta protegida tampoco (TMP contiene "protected")', await (async () => {
    fs.mkdirSync(path.join(TMP, 'protected'), { recursive: true });
    return throwsAsync(() => guard.addRoot(TMP), /contiene una ruta protegida/);
  })());
  t('la carpeta de usuario completa no puede ser root', await throwsAsync(() => guard.addRoot(os.homedir()), /carpeta de usuario/));
  t('un root debe existir', await throwsAsync(() => guard.addRoot(path.join(TMP, 'noexiste')), /existente/));
  t('un root relativo se rechaza', await throwsAsync(() => guard.addRoot('Projects'), /absoluta/));
}

/* ================================================================== */
section('Canonicalización, traversal y enlaces simbólicos (disco real)');
{
  const { guard } = makeService();
  await guard.addRoot(ROOT);
  const ok = await guard.check('src/app.ts', { write: true, base: PROJ });
  t('ruta relativa al proyecto se resuelve dentro del root', ok.path === fs.realpathSync(path.join(PROJ, 'src', 'app.ts')) && ok.relative === 'vigilia/src/app.ts');
  t('"../../outside" se rechaza', await throwsAsync(() => guard.check('../../outside/secret.txt', { write: false, base: PROJ }), /fuera de los Project Roots/));
  t('ruta absoluta fuera se rechaza al leer', await throwsAsync(() => guard.check(path.join(OUTSIDE, 'secret.txt'), { write: false }), /fuera/));
  t('ruta relativa sin proyecto se rechaza', await throwsAsync(() => guard.check('src/app.ts', { write: false }), /sin proyecto/));
  t('un carácter nulo se rechaza', await throwsAsync(() => guard.check(`${PROJ}/a\0b`, { write: true }), /nulo/));

  directoryLink(OUTSIDE, path.join(PROJ, 'escape-dir'));
  t('un symlink de carpeta que sale del root se rechaza al leer por él',
    await throwsAsync(() => guard.check('escape-dir/secret.txt', { write: false, base: PROJ }), PathDeniedError));
  t('y al escribir un archivo nuevo a través de él', await throwsAsync(() => guard.check('escape-dir/nuevo.txt', { write: true, base: PROJ }), /fuera/));
  let fileLinkAvailable = true;
  try { fs.symlinkSync(path.join(OUTSIDE, 'secret.txt'), path.join(PROJ, 'escape-file'), 'file'); links.push(path.join(PROJ, 'escape-file')); }
  catch (error) { if (IS_WINDOWS && (error as NodeJS.ErrnoException).code === 'EPERM') fileLinkAvailable = false; else throw error; }
  if (fileLinkAvailable) t('un symlink de archivo como hoja se rechaza', await throwsAsync(() => guard.check('escape-file', { write: false, base: PROJ }), /enlaces simbólicos/));
  else console.log('  SKIP symlink de archivo: Windows denegó la creación sin Developer Mode');
  directoryLink(SYSTEM_PROTECTED, path.join(PROJ, 'etc-link'));
  t('un enlace hacia una ruta protegida se rechaza por la protección', await throwsAsync(() => guard.check(`etc-link/${IS_WINDOWS ? 'System32' : 'passwd'}`, { write: false, base: PROJ }), /protegida/));
  const inner = path.join(PROJ, 'src-link');
  directoryLink(path.join(PROJ, 'src'), inner);
  const viaInner = await guard.check('src-link/app.ts', { write: true, base: PROJ });
  t('un symlink interno que sigue dentro del root resuelve a su destino real', viaInner.relative === 'vigilia/src/app.ts');
  if (IS_WINDOWS) {
    const casePath = await guard.check('SRC/APP.TS', { write: false, base: PROJ });
    t('NTFS resuelve rutas con mayúsculas distintas dentro del root', casePath.path.toLowerCase() === fs.realpathSync(path.join(PROJ, 'src/app.ts')).toLowerCase());
  }
  fs.mkdirSync(path.join(PROJ, 'Espacios ñ'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'Espacios ñ', 'código útil.ts'), 'export const bien = true;\n');
  const unicodePath = await guard.check('Espacios ñ/código útil.ts', { write: false, base: PROJ });
  t('espacios y Unicode permanecen dentro del root', unicodePath.relative === 'vigilia/Espacios ñ/código útil.ts');
  t('escribir en .git se rechaza (hooks = código arbitrario)', await throwsAsync(() => guard.check('.git/hooks/pre-commit', { write: true, base: PROJ }), /\.git/));
  t('los secretos se marcan', (await guard.check('.env', { write: false, base: PROJ })).secret);
}

/* ================================================================== */
section('Lectura: binarios, secretos y archivos grandes');
{
  const { guard, svc } = makeService();
  await guard.addRoot(ROOT);
  const png = await svc.read('logo.png', { runId: 'r0', base: PROJ });
  t('un binario no se devuelve como texto', png.binary && png.content === null);
  const env = await svc.read('.env', { runId: 'r0', base: PROJ });
  t('.env se lee redactado: claves sí, valores no', env.secret && env.content!.includes('API_KEY=[redactado]') && !env.content!.includes('sk-live'));
  fs.writeFileSync(path.join(PROJ, 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n');
  t('una clave privada no se devuelve en absoluto', (await svc.read('id_rsa', { runId: 'r0', base: PROJ })).content === null);
  const big = Array.from({ length: 90_000 }, (_, i) => `línea ${i} ${'x'.repeat(20)}`).join('\n');
  fs.writeFileSync(path.join(PROJ, 'big.log'), big);
  const bigRead = await svc.read('big.log', { runId: 'r0', base: PROJ });
  t('un archivo grande se lee por rango, no entero', bigRead.truncated && bigRead.range?.end === 400 && bigRead.content!.split('\n').length === 400);
  const ranged = await svc.read('big.log', { runId: 'r0', base: PROJ, startLine: 30000, endLine: 30002 });
  t('se puede pedir un rango concreto', ranged.content === 'línea 29999 xxxxxxxxxxxxxxxxxxxx\nlínea 30000 xxxxxxxxxxxxxxxxxxxx\nlínea 30001 xxxxxxxxxxxxxxxxxxxx');
  t('patch de un archivo grande se rechaza', await throwsAsync(() => svc.patch('big.log', [{ kind: 'insert', atLine: 1, text: 'x' }], { runId: 'r0', base: PROJ }), /demasiado grande/));
  t('patch de un binario se rechaza', await throwsAsync(() => svc.patch('logo.png', [{ kind: 'insert', atLine: 1, text: 'x' }], { runId: 'r0', base: PROJ }), /binario/));
  fs.unlinkSync(path.join(PROJ, 'big.log'));
}

/* ================================================================== */
section('Escritura atómica, conflictos y ChangeSet');
{
  const { guard, svc, selfWrites } = makeService();
  await guard.addRoot(ROOT);
  const run = 'run-a';
  const app = path.join(PROJ, 'src', 'app.ts');

  t('modificar sin haber leído se rechaza', await throwsAsync(() => svc.patch('src/app.ts', [{ kind: 'edit', edit: { oldText: '3000', newText: '4000' } }], { runId: run, base: PROJ }), /Léelo antes/));
  const first = await svc.read('src/app.ts', { runId: run, base: PROJ });
  const p1 = await svc.patch('src/app.ts', [{ kind: 'edit', edit: { oldText: 'port = 3000', newText: 'port = 4000' } }], { runId: run, base: PROJ });
  t('patch aplica el cambio en disco', read(app).includes('port = 4000'));
  t('devuelve before, after y diff', p1.result.before.includes('3000') && p1.result.after.includes('4000') && p1.result.diff.includes('-export const port = 3000;') && p1.result.diff.includes('+export const port = 4000;'));
  t('no queda ningún temporal en la carpeta', !fs.readdirSync(path.join(PROJ, 'src')).some((f) => f.includes('.jarvis-tmp-')));
  t('el watcher recibe el aviso de escritura propia', selfWrites.includes(fs.realpathSync(app)));
  t('el hash cambia y se recuerda para la siguiente edición', p1.hash !== first.hash && p1.hash === sha256(read(app)));

  // A human edits the file between JARVIS's read and its write.
  fs.writeFileSync(app, read(app) + '// nota del usuario\n');
  const conflict = await svc.patch('src/app.ts', [{ kind: 'edit', edit: { oldText: 'return port;', newText: 'return port + 1;' } }], { runId: run, base: PROJ }).then(() => null, (e) => e);
  t('si el usuario editó entre lectura y escritura → ConflictError', conflict instanceof ConflictError);
  t('y su edición sigue intacta', read(app).endsWith('// nota del usuario\n') && !read(app).includes('port + 1'));
  t('el error trae el hash actual para recalcular', conflict instanceof ConflictError && conflict.currentHash === sha256(read(app)));
  await svc.read('src/app.ts', { runId: run, base: PROJ });
  await svc.patch('src/app.ts', [{ kind: 'edit', edit: { oldText: 'return port;', newText: 'return port + 1;' } }], { runId: run, base: PROJ });
  t('tras releer, el parche se aplica conservando la edición humana', read(app).includes('port + 1') && read(app).includes('// nota del usuario'));

  t('expectedHash explícito y obsoleto también es conflicto', await throwsAsync(() => svc.write('src/app.ts', 'x', { runId: run, base: PROJ, expectedHash: first.hash }), ConflictError));
  t('patch con texto inexistente falla sin tocar el archivo', await (async () => {
    const before = read(app);
    const failed = await throwsAsync(() => svc.patch('src/app.ts', [{ kind: 'edit', edit: { oldText: 'no existe', newText: 'x' } }], { runId: run, base: PROJ }), /No se encontró/);
    return failed && read(app) === before;
  })());

  const created = await svc.create('src/util/helpers.ts', 'export const two = 2;\n', { runId: run, base: PROJ });
  t('create crea el archivo y las carpetas intermedias', read(created.path) === 'export const two = 2;\n');
  t('create sobre un archivo existente es conflicto', await throwsAsync(() => svc.create('src/app.ts', 'x', { runId: run, base: PROJ }), /ya existe/));
  await svc.move('src/util/helpers.ts', 'src/util/math.ts', { runId: run, base: PROJ }, 'rename');
  t('rename mueve el archivo', fs.existsSync(path.join(PROJ, 'src/util/math.ts')) && !fs.existsSync(path.join(PROJ, 'src/util/helpers.ts')));
  t('rename nunca sobrescribe', await throwsAsync(() => svc.move('src/util/math.ts', 'src/app.ts', { runId: run, base: PROJ }), /ya existe/));
  await svc.copy('package.json', 'package.backup.json', { runId: run, base: PROJ });
  t('copy duplica el archivo', read(path.join(PROJ, 'package.backup.json')) === read(path.join(PROJ, 'package.json')));
  fs.writeFileSync(path.join(PROJ, 'old-notes.md'), 'viejo\n');
  const trashed = await svc.trash('old-notes.md', { runId: run, base: PROJ });
  t('trash mueve a la papelera, no borra', !fs.existsSync(path.join(PROJ, 'old-notes.md')) && fs.readdirSync(BIN).some((f) => f.endsWith('old-notes.md')) && trashed.restorable);
  t('mover o escribir fuera del root se rechaza', await throwsAsync(() => svc.move('package.backup.json', path.join(OUTSIDE, 'x.json'), { runId: run, base: PROJ }), /fuera/));

  const summary = svc.changes.summary(run)!;
  const status = Object.fromEntries(summary.files.map((f) => [path.basename(f.toPath ?? f.path), f.status]));
  t('ChangeSet: app.ts M, math.ts R, backup C, notas T', status['app.ts'] === 'M' && status['math.ts'] === 'R' && status['package.backup.json'] === 'C' && status['old-notes.md'] === 'T', JSON.stringify(status));
  t('ChangeSet registra hashes antes/después y bytes', svc.changes.get(run)!.changes.filter((c) => c.operation === 'patch').every((c) => c.hashBefore && c.hashAfter && c.bytesAfter > 0));
  t('las instantáneas sólo guardan lo tocado', fs.readdirSync(SNAPS).length <= 4, String(fs.readdirSync(SNAPS).length));

  // Revert, with a human edit made after JARVIS finished.
  fs.writeFileSync(app, read(app).replace('export function start', '// cambio posterior del usuario\nexport function start'));
  const report = await svc.revertRun(run);
  t('Revert Run: deshace el cambio de JARVIS en app.ts', read(app).includes('port = 3000') && !read(app).includes('port + 1'));
  t('…sin perder el cambio posterior del usuario', read(app).includes('// cambio posterior del usuario') && read(app).includes('// nota del usuario'));
  t('el archivo creado vuelve a no existir (a la papelera)', !fs.existsSync(path.join(PROJ, 'src/util/math.ts')) && !fs.existsSync(path.join(PROJ, 'src/util/helpers.ts')));
  t('la carpeta creada vacía se retira', !fs.existsSync(path.join(PROJ, 'src/util')));
  t('la copia se retira', !fs.existsSync(path.join(PROJ, 'package.backup.json')));
  t('el archivo enviado a la papelera se restaura', read(path.join(PROJ, 'old-notes.md')) === 'viejo\n');
  t('el informe no tiene conflictos', report.conflicts.length === 0, JSON.stringify(report));
}

/* ================================================================== */
section('Undo Last y conflictos de reversión');
{
  const { guard, svc } = makeService();
  await guard.addRoot(ROOT);
  const pkg = path.join(PROJ, 'package.json');
  const original = read(pkg);
  await svc.read('package.json', { runId: 'run-b', base: PROJ });
  await svc.patch('package.json', [{ kind: 'edit', edit: { oldText: '"node test.js"', newText: '"node test.js --verbose"' } }], { runId: 'run-b', base: PROJ });
  await svc.patch('package.json', [{ kind: 'edit', edit: { oldText: '"vigilia"', newText: '"vigilia-app"' } }], { runId: 'run-b', base: PROJ });
  const undo = await svc.undoLast();
  t('Undo Last deshace sólo el último cambio', read(pkg).includes('"vigilia"') && read(pkg).includes('--verbose') && undo.runId === 'run-b');
  await svc.undoLast();
  t('un segundo Undo deshace el anterior', read(pkg) === original);

  await svc.read('package.json', { runId: 'run-c', base: PROJ });
  await svc.patch('package.json', [{ kind: 'edit', edit: { oldText: '"node test.js"', newText: '"node test.js --ci"' } }], { runId: 'run-c', base: PROJ });
  fs.writeFileSync(pkg, read(pkg).replace('--ci', '--ci --watch'));
  const clash = await svc.revertRun('run-c');
  t('si el usuario reescribió la misma línea → conflicto, no se toca', clash.conflicts.length === 1 && read(pkg).includes('--ci --watch'));
  fs.writeFileSync(pkg, original);
}

/* ================================================================== */
section('Cambios masivos');
{
  const set = { runId: 'm', projectRoot: null, created: 0, updated: 0, preExisting: [], reverted: false,
    changes: Array.from({ length: 50 }, (_, i) => ({ operation: 'write' as const, path: `/p/f${i}.ts`, hashBefore: 'a', hashAfter: 'b', bytesBefore: 10, bytesAfter: 12, at: 0, snapshotId: null })) };
  t('el archivo 51 de una tarea eleva el riesgo', /51 archivos/.test(massChangeReason(set, { path: '/p/f51.ts', bytes: 10, trash: false }) ?? ''));
  t('reescribir uno ya tocado no cuenta doble', massChangeReason(set, { path: '/p/f3.ts', bytes: 10, trash: false }) === null);
  t('más de 100 MB en total eleva el riesgo', /MB/.test(massChangeReason(undefined, { path: '/p/x', bytes: 101 * 1048576, trash: false }) ?? ''));
  t('enviar 11 elementos a la papelera eleva el riesgo', /papelera/.test(massChangeReason(undefined, { path: '/p/d', bytes: 0, trash: true, files: 11 }) ?? ''));
}

for (const link of links.reverse()) {
  if (fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false })) fs.unlinkSync(link);
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} ok · ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
