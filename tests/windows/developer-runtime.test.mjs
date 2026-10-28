import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-native-dev-'));
const project = path.join(dir, 'proyecto ágil');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'jarvis-temporal', version: '1.0.0', scripts: { test: 'node test.js' } }));
fs.writeFileSync(path.join(project, 'math.js'), 'module.exports.sum = (a, b) => a - b;\n');
fs.writeFileSync(path.join(project, 'test.js'), 'const {sum}=require("./math"); if(sum(2,3)!==5) { console.error("sum dio -1"); process.exit(1) } console.log("ok");\n');
fs.writeFileSync(path.join(project, 'conflict.txt'), 'original\n');
fs.writeFileSync(path.join(project, 'trash-me.txt'), 'a la papelera\n');

const executablePath = process.env.JARVIS_EXE ?? path.resolve('release/win-unpacked/JARVIS.exe');
let app;
let shell;
try {
  app = await electron.launch({ executablePath });
  shell = await app.firstWindow();
  await shell.getByRole('button', { name: 'Projects', exact: true }).click();
  await shell.getByTestId('root-input').fill(dir);
  await shell.getByRole('button', { name: 'Añadir root', exact: true }).click();
  const row = shell.getByTestId('project-row').filter({ hasText: 'jarvis-temporal' });
  await row.waitFor({ timeout: 15_000 });
  assert.match(await row.innerText(), /Node|JavaScript|sin indexar/i);
  await row.getByRole('button', { name: 'Coding Workspace' }).click();
  const coding = shell.getByTestId('coding-workspace');
  await coding.waitFor({ timeout: 15_000 });
  await shell.getByTestId('explorer-file').filter({ hasText: 'math.js' }).click();
  const editor = shell.getByTestId('code-editor');
  await editor.waitFor({ timeout: 15_000 });
  assert.equal(await editor.getAttribute('data-editor'), 'monaco');
  assert.match(await shell.getByTestId('editor-status').innerText(), /Monaco/);
  const opened = await shell.evaluate(async () => {
    const projects = await window.jarvis.dev.discover();
    const item = projects.find((p) => p.name === 'jarvis-temporal');
    const file = await window.jarvis.dev.readFile(item.id, 'math.js');
    return { item, file };
  });
  assert.equal(opened.item.status, 'indexed');
  assert.ok(opened.item.lastOpened);
  assert.match(JSON.stringify(opened.file), /a - b/);

  const proposal = await shell.evaluate(async (input) => window.jarvis.dev.propose(input), {
    goal: 'Corrige el bug en math.js para que sum(2,3) sea 5.',
    context: { files: [{ path: 'math.js', reason: 'la prueba falla', content: 'module.exports.sum = (a, b) => a - b;\n' }] },
    failures: [{ check: 'npm test', excerpt: 'sum dio -1' }], attempt: 1,
  });
  console.log('MODELO', JSON.stringify(proposal));
  assert.notEqual(proposal.status, 'unavailable', 'Ollama instalado debe estar conectado');

  await shell.getByRole('button', { name: 'Assist', exact: true }).first().click();
  await shell.getByRole('button', { name: /Admin.*Operaciones sensibles/ }).last().click();
  if (!(await shell.getByPlaceholder('Pide algo a JARVIS', { exact: true }).count())) {
    await shell.getByRole('button', { name: 'Abrir JARVIS' }).click();
  }
  await shell.getByPlaceholder('Pide algo a JARVIS', { exact: true }).fill('Encuentra por qué fallan las pruebas del proyecto jarvis-temporal, corrígelo y vuelve a probar.');
  await shell.getByRole('button', { name: 'Enviar' }).click();
  await shell.getByTestId('stop-agent').waitFor({ state: 'visible', timeout: 15_000 });
  await shell.getByTestId('stop-agent').waitFor({ state: 'hidden', timeout: 240_000 });
  const finalCode = fs.readFileSync(path.join(project, 'math.js'), 'utf8');
  const response = await shell.locator('body').innerText();
  const verified = /a \+ b/.test(finalCode) && /Trabajando en el proyecto · Verificado:/.test(response);
  console.log('AGENTE', JSON.stringify({ finalCode, verified, summary: response.match(/Trabajando en el proyecto · [^\n]+/)?.[0] ?? null }));
  assert.match(response, /ENTENDER|Abriendo e indexando el proyecto/);
  assert.match(response, /VERIFICAR|Verificando: Pruebas/);
  if (!verified) {
    assert.match(response, /Me detuve tras 3 intentos|No encontré un cambio/, 'El fallo del modelo debe informarse sin fingir éxito');
    console.log('MODEL QUALITY INSUFFICIENT: qwen2.5:3b-instruct no produjo una reparación verificable en este intento');
  }
  assert.doesNotMatch(response, /Anthropic · Reasoning|Queda a la espera de tu aprobación/, 'La respuesta no debe atribuir el trabajo a un proveedor simulado');

  const conflictFile = await shell.evaluate((id) => window.jarvis.dev.readFile(id, 'conflict.txt'), opened.item.id);
  fs.writeFileSync(path.join(project, 'conflict.txt'), 'edición externa\n');
  const conflict = await shell.evaluate(async ({ id, hash }) => window.jarvis.dev.saveFile(id, 'conflict.txt', 'sobrescritura\n', hash).then(() => 'wrote', (e) => e.message), { id: opened.item.id, hash: conflictFile.hash });
  assert.match(conflict, /cambi[oó]|conflicto/i);
  assert.equal(fs.readFileSync(path.join(project, 'conflict.txt'), 'utf8'), 'edición externa\n');

  const trashed = await shell.evaluate((id) => window.jarvis.devTools['file.trash']('ADMIN', 'native-trash-test', { project: id, path: 'trash-me.txt' }), opened.item.id);
  assert.equal(trashed.ok, true, JSON.stringify(trashed));
  assert.equal(fs.existsSync(path.join(project, 'trash-me.txt')), false);

  const commands = await shell.evaluate(async (id) => {
    const call = (executable, args) => window.jarvis.devTools['terminal.execute']('ADMIN', 'native-commands-test', { project: id, executable, args });
    return Promise.all([call('node', ['--version']), call('npm', ['--version']), call('npx', ['--no-install', 'tsc', '--version']), call('git', ['--version'])]);
  }, opened.item.id);
  assert.ok(commands.every((result) => result.ok && typeof result.data?.exitCode === 'number'), JSON.stringify(commands));

  fs.writeFileSync(path.join(project, 'test.js'), `const fs=require('fs'); const {spawn}=require('child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); fs.writeFileSync('child.pid',String(child.pid)); setInterval(()=>{},1000);\n`);
  await shell.getByPlaceholder('Pide algo a JARVIS', { exact: true }).fill('Ejecuta las pruebas del proyecto jarvis-temporal y avísame del resultado.');
  await shell.getByRole('button', { name: 'Enviar' }).click();
  await shell.getByTestId('stop-agent').waitFor({ state: 'visible', timeout: 15_000 });
  const marker = path.join(project, 'child.pid');
  for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(fs.existsSync(marker), 'La prueba larga debe iniciar un descendiente real');
  const childPid = Number(fs.readFileSync(marker, 'utf8'));
  await shell.getByTestId('stop-agent').click({ force: true });
  await shell.getByTestId('stop-agent').waitFor({ state: 'hidden', timeout: 15_000 });
  await new Promise((r) => setTimeout(r, 500));
  let childAlive = true;
  try { process.kill(childPid, 0); } catch { childAlive = false; }
  assert.equal(childAlive, false, 'STOP del renderer debe matar el árbol npm → node → hijo');
  assert.match(await shell.locator('body').innerText(), /cancelad|detenid/i);
  console.log('PASS Developer Agent nativo: Projects, Coding, Monaco, preload/IPC, Ollama, políticas y UNDERSTAND→CHANGE→VERIFY (calidad del modelo indicada aparte)');
} finally {
  await shell?.evaluate((p) => window.jarvis.dev.removeRoot(p), dir).catch(() => {});
  await app?.close();
  // Remove only the test fixture after removing its persisted Project Root.
  fs.rmSync(dir, { recursive: true, force: true });
}
