import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), base = path.dirname(root), evidence = path.join(root, 'docs/evidence/recovery-20261007');
const read = file => JSON.parse(fs.readFileSync(path.join(evidence, file), 'utf8').replace(/^\uFEFF/, ''));
const smoke = read('smoke-final/recovery-runtime.json'), native = read('adv-runtime/advancement-runtime.json'), installed = read('installed-profile/installed-profile.json'), migration = read('legacy-database-migration.json'), electron = read('electron-distribution-verified.json');
for (const result of [smoke, native, installed, migration]) assert.equal(result.status, 'PASS');
assert.equal(native.checks.length, 9); assert.equal(native.graph.state, 'VERIFIED'); assert.equal(native.stoppedGraph.state, 'STOPPED');
assert.equal(installed.fixtureMode, false); assert.equal(installed.schema, 4); assert.equal(installed.integrity, 'ok');
assert.ok(electron.every(row => row.Matched));
assert.match(fs.readFileSync(path.join(evidence, 'test-process-env-serial.log'), 'utf8'), /106 ok · 0 fallos/);
const hash = async file => { const h = createHash('sha256'); for await (const b of fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })) h.update(b); return h.digest('hex'); };
const files = [];
for (const file of ['JARVIS.exe', 'resources/app.asar', 'resources/native/jarvis-process-host.exe', 'resources/native/jarvis-automation-helper.exe', 'resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node']) {
  const absolute = path.join(base, 'App instalada', file); files.push({ file: absolute, bytes: fs.statSync(absolute).size, sha256: await hash(absolute) });
}
const git = path.join(base, 'Dependencias/Herramientas/Git/cmd/git.exe');
const gitRead = (...args) => execFileSync(git, args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const changed = gitRead('diff', '--name-only').split(/\r?\n/).filter(Boolean);
const added = ['docs/RECOVERY_20261007.md', 'tests/windows/recovery-database.test.ts', 'tests/windows/recovery-runtime.test.mjs', 'tests/windows/recovery-user-profile.test.mjs', 'tests/windows/recovery-dotnet.test.ts', 'tools/recovery-delivery-manifest.mjs', 'tools/recovery-startup-probe.mjs'];
const sourceFiles = [];
for (const file of [...new Set([...changed, ...added])]) sourceFiles.push({ file, sha256: await hash(path.join(root, file)) });
const manifest = { status: 'VERIFIED', createdAt: new Date().toISOString(), version: installed.version,
  installedDirectory: path.join(base, 'App instalada'), launcher: path.join(base, 'Abrir-JARVIS.cmd'),
  source: { directory: root, branch: gitRead('branch', '--show-current'), head: gitRead('rev-parse', 'HEAD'), localChangesRetained: true, files: sourceFiles },
  tools: { node: '24.21.0', npm: '11.19.0', git: '2.53.0.windows.3', dotnet: '8.0.425', electron: '33.4.11', typescript: smoke.compiler.version, playwright: '1.63.0', ollama: '0.30.8', llamaCpp: 'b6500' },
  profile: installed, migrationCopy: migration, evidence: { root: evidence, smoke: 'smoke-final/recovery-runtime.json', native: 'adv-runtime/advancement-runtime.json', installed: 'installed-profile/installed-profile.json' },
  checks: { coreAdvGroups: 67, s2: 19, s3: 13, s4: 13, s41: 7, renderer: 367, processesGitTools: 106, packagedSmoke: smoke.checks.length, nativeLocalFlow: native.checks.length, installedProfile: 'PASS' },
  paidApiCalls: native.paidApiCalls, generalAutonomyClaimed: false, files,
  preservation: { originalProfile: path.join(base, 'Perfil'), history: 'E:/CODEX/Historial/Reparacion-JARVIS-20261007', recoveredConversations: 'E:/CODEX/Notas/Recuperacion-JARVIS-20261007', gitHistoryRewritten: false, pushed: false } };
fs.writeFileSync(path.join(evidence, 'delivery-manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(base, 'Verificacion-paquete.json'), JSON.stringify(manifest, null, 2));
console.log('DELIVERY_MANIFEST_VERIFIED ' + files.length);
