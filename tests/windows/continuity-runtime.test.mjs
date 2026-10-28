import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-fabric-native-continuity-'));
const profile = path.join(temp, 'jarvis-fabric-native-profile');
const workspace = path.join(temp, 'workspace');
const project = path.join(workspace, 'continuity-fixture');
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'continuity-fixture', version: '1.0.0', scripts: { test: 'node test.js' } }));
fs.writeFileSync(path.join(project, 'test.js'), 'console.error("expected fixture failure"); process.exit(1);\n');
const executablePath = process.env.JARVIS_EXE ?? path.resolve('release/win-unpacked/JARVIS.exe');
const env = { ...process.env, JARVIS_ALLOW_FIXTURES: '1', JARVIS_TEST_USER_DATA: profile };
const evidenceDir = path.resolve(process.env.JARVIS_CONTINUITY_EVIDENCE_DIR ?? 'docs/evidence/north-star/final');
fs.mkdirSync(evidenceDir, { recursive: true });
const checks = [];
const passed = name => { checks.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); };
let app;
let shell;
let taskId;
let rendererTask;
try {
  app = await electron.launch({ executablePath, env, timeout: 30000 });
  shell = await app.firstWindow();
  await shell.getByRole('button', { name: 'Home', exact: true }).waitFor({ timeout: 20000 });
  assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))).toLowerCase(), path.resolve(profile).toLowerCase());
  passed('test-owned isolated Windows user profile');
  await shell.evaluate(() => {
    localStorage.setItem('jarvis.firstRun', JSON.stringify({ completed: true, version: 1, permissionPreset: 'ASSIST', sessionPolicy: 'keep', localAIChoice: 'skipped', fingerprint: null }));
  });
  await shell.reload();
  await shell.getByRole('button', { name: 'Home', exact: true }).waitFor({ timeout: 20000 });
  const opened = await shell.evaluate(async root => {
    await window.jarvis.dev.addRoot(root);
    const projects = await window.jarvis.dev.discover();
    const fixture = projects.find(p => p.name === 'continuity-fixture');
    if (!fixture) throw new Error('Fixture project absent');
    await window.jarvis.dev.openProject(fixture.id);
    return fixture.id;
  }, workspace);
  // S2 migration: a real trusted UI gesture admits the run; never forge an authority ticket.
  assert.ok(opened);
  await shell.getByRole('button', { name: 'Settings', exact: true }).click();
  await shell.getByRole('button', { name: 'Desarrollo', exact: true }).click();
  await shell.getByLabel('Ejecutable nativo', { exact: true }).fill('node');
  await shell.getByLabel('Directorio nativo', { exact: true }).fill(project);
  await shell.getByLabel('Argumentos nativos', { exact: true }).fill(JSON.stringify(['test.js']));
  await shell.getByLabel('Ejecutar nativo', { exact: true }).click();
  await shell.waitForFunction(() => document.querySelector('[data-testid="native-output"]')?.textContent?.includes('exitCode'));
  const result = JSON.parse(await shell.getByTestId('native-output').innerText());
  taskId = await shell.getByTestId('native-run-id').innerText();
  assert.equal(result.ok, true); assert.equal(result.data.exitCode, 1);
  passed('real owned native command returns failing exit, not model claim');
  const state = { taskId, conversationId: 'continuity-fixture-conversation', goal: 'Continuidad fixture: reparar prueba',
    currentTask: 'failed', instructions: [], findings: ['La prueba devolvió exit 1'], decisions: [], artifacts: [],
    openQuestions: [], pendingSteps: ['Reparar fixture y verificar de nuevo'], completedWork: [], updatedAt: Date.now(),
    evidence: [{ id: 'forged-receipt', kind: 'step', source: 'MAIN_PROCESS', status: 'completed', summary: 'renderer claim', at: Date.now() }],
    privateReasoning: 'fixture-private-not-for-disk' };
  await shell.evaluate(async value => {
    await window.jarvis.fabric.saveTask(value);
    await window.jarvis.fabric.appendMessage({ conversationId: value.conversationId, messageId: crypto.randomUUID(), parentId: null,
      role: 'user', content: 'PASSWORD=fixture-never-store\ncookie=fixture-cookie-not-for-model', timestamp: Date.now(),
      providerId: null, modelId: null, channel: 'public', taskId: value.taskId, tools: [], artifacts: [], usageIds: [], contextRefs: [], routingDecisionId: null });
  }, state);
  const saved = await shell.evaluate(id => window.jarvis.fabric.task(id), taskId);
  assert.equal(saved.evidence.find(e => e.id === 'forged-receipt').source, 'RENDERER_REPORTED');
  assert.ok(saved.evidence.some(e => e.kind === 'command' && e.source === 'MAIN_PROCESS' && e.status === 'failed' && /exit=1/.test(e.summary)));
  assert.equal(JSON.stringify(saved).includes('fixture-private-not-for-disk'), false);
  passed('main attaches native receipt and downgrades renderer source forgery');
  const packet = await shell.evaluate(id => window.jarvis.fabric.handoff(id, 2048), taskId);
  assert.ok(JSON.stringify(packet).length <= packet.budget.maxChars);
  assert.equal(packet.currentTask, 'failed');
  assert.equal(JSON.stringify(packet).includes('fixture-never-store'), false);
  assert.equal(JSON.stringify(packet).includes('fixture-cookie-not-for-model'), false);
  passed('handoff uses persisted public state, global budget and synthetic secret boundary');
  const foreignResult = await app.evaluate(async ({ BrowserWindow }) => {
    const foreign = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
    try {
      await foreign.loadURL('about:blank');
      return await foreign.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('fabric:task-page', 50).then(() => 'ALLOWED', error => error.message)");
    } finally { foreign.destroy(); }
  });
  assert.match(foreignResult, /Untrusted Fabric sender/);
  passed('foreign test renderer cannot access Fabric persistence IPC');

  if (!(await shell.getByPlaceholder('Pide algo a JARVIS', { exact: true }).count())) await shell.getByRole('button', { name: 'Abrir JARVIS' }).click();
  const originalPrompt = 'Consulta la información del sistema';
  await shell.getByPlaceholder('Pide algo a JARVIS', { exact: true }).fill(originalPrompt);
  await shell.getByLabel('Enviar', { exact: true }).click();
  await shell.waitForFunction(async goal => (await window.jarvis.fabric.taskPage()).some(t => t.goal === goal), originalPrompt, { timeout: 20000 });
  // Allow the real classifier to settle; no model response is fabricated.
  await shell.waitForFunction(async goal => (await window.jarvis.fabric.taskPage()).some(t => t.goal === goal && ['completed', 'failed', 'cancelled'].includes(t.currentTask)), originalPrompt, { timeout: 60000 });
  rendererTask = await shell.evaluate(async goal => (await window.jarvis.fabric.taskPage()).find(t => t.goal === goal), originalPrompt);
  assert.ok(rendererTask.evidence.length > 0);
  passed('real submitted renderer run checkpoints observable step outcomes');
  await app.close(); app = null;

  app = await electron.launch({ executablePath, env, timeout: 30000 });
  shell = await app.firstWindow();
  await shell.getByRole('button', { name: 'Home', exact: true }).waitFor({ timeout: 20000 });
  await shell.getByRole('button', { name: 'History', exact: true }).click();
  await shell.getByRole('button', { name: 'Preparar relevo: Continuidad fixture: reparar prueba', exact: true }).waitFor({ timeout: 20000 });
  await shell.getByLabel('Contexto del destino').selectOption('2048');
  await shell.getByRole('button', { name: 'Preparar relevo: Continuidad fixture: reparar prueba', exact: true }).click();
  await shell.getByTestId('continuity-packet').waitFor({ timeout: 10000 });
  const visible = await shell.getByTestId('continuity-packet').innerText();
  assert.match(visible, /MAIN_PROCESS/); assert.match(visible, /failed/); assert.match(visible, /Reparar fixture/);
  assert.equal(visible.includes('fixture-never-store'), false);
  const restored = await shell.evaluate(id => window.jarvis.fabric.task(id), rendererTask.taskId);
  assert.equal(restored.currentTask, rendererTask.currentTask);
  assert.deepEqual(restored.evidence, rendererTask.evidence);
  passed('packaged restart restores real renderer run and native receipt in visible History');
  await shell.screenshot({ path: path.join(evidenceDir, 'continuity-history.png') });
  await app.close(); app = null;
  for (const file of fs.readdirSync(path.join(profile, 'intelligence-fabric'))) {
    const bytes = fs.readFileSync(path.join(profile, 'intelligence-fabric', file));
    for (const secret of ['fixture-never-store', 'fixture-cookie-not-for-model', 'fixture-private-not-for-disk']) assert.equal(bytes.includes(Buffer.from(secret)), false);
  }
  passed('native SQLite files contain no tested secret/private reasoning fixture values');
  fs.writeFileSync(path.join(evidenceDir, 'native-continuity.json'), JSON.stringify({ status: 'PASS', executablePath,
    date: '2026-09-30', checks, rendererOutcome: rendererTask.currentTask, interpretation: 'continuity substrate; no remote-provider handoff or authority realignment claimed' }, null, 2));
  console.log(`NATIVE_CONTINUITY_PASS ${checks.length} checks`);
} catch (error) {
  fs.writeFileSync(path.join(evidenceDir, 'native-continuity.json'), JSON.stringify({ status: 'FAIL', checks, error: String(error) }, null, 2));
  throw error;
} finally {
  await app?.close();
  const resolved = path.resolve(temp); const root = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(root) || !path.basename(resolved).startsWith('jarvis-fabric-native-continuity-')) throw new Error('Unsafe native fixture cleanup');
  try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5 }); }
  catch (error) { console.warn('Own TEMP retained: ' + resolved + ' ' + error.code); }
}
