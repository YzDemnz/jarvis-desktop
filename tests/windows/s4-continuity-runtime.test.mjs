import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-fabric-native-s4-')), profile = path.join(root, 'jarvis-fabric-native-profile');
const evidence = path.resolve(process.env.JARVIS_S4_EVIDENCE_DIR ?? process.env.JARVIS_S2_EVIDENCE_DIR ?? 'docs/evidence/s4/native');
fs.mkdirSync(evidence, { recursive: true });
const hash = b => createHash('sha256').update(b).digest('hex');
const checks = [], pass = name => { checks.push({ name, status: 'PASS' }); console.log('PASS ' + name); };
const models = ['qwen2.5:3b-instruct', 'smollm2:1.7b-instruct-q4_K_M'];
const code = 'ORION_' + randomBytes(3).toString('hex').toUpperCase();
const executablePath = process.env.JARVIS_EXE ?? path.resolve('release/win-unpacked/JARVIS.exe');
let app, page, mode = 'normal', aborted = false, eventsBeforeRestart = 0, heldResponse, watcher;
const artifactEvents = [];
const requests = [], signals = [], failures = [];
const wait = async (fn, timeout = 20000) => { const until = Date.now() + timeout; while (!await fn()) { if (Date.now() > until) throw Error('S4 fixture wait timeout'); await new Promise(r => setTimeout(r, 100)); } };
const reserve = net.createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const directEndpoint = 'http://127.0.0.1:' + reserve.address().port; await new Promise(r => reserve.close(r));
await build({ entryPoints: ['electron/process/WindowsJobProcess.ts'], outfile: path.join(root, 'owned-job.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { spawnWindowsJob } = await import(pathToFileURL(path.join(root, 'owned-job.mjs')).href);
const exe = path.join(process.env.LOCALAPPDATA, 'Programs/Ollama/ollama.exe');
const child = spawnWindowsJob({ file: exe, args: ['serve'], cwd: path.dirname(exe), env: { ...process.env, OLLAMA_HOST: directEndpoint, OLLAMA_NO_CLOUD: '1', OLLAMA_NOPRUNE: '1' } });
let runtimeLog = ''; child.onStdout(s => runtimeLog = (runtimeLog + s).slice(-150000)); child.onStderr(s => runtimeLog = (runtimeLog + s).slice(-150000));
// Fault-injection proxy forwards real model requests unchanged. Only the 429/hold
// are synthetic; it never supplies a successful assistant answer.
const proxy = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  if (req.url === '/api/generate') {
    const input = JSON.parse(body); requests.push({ model: input.model, prompt: input.prompt, system: input.system, mode, at: Date.now() });
    if (mode === 'quota') { res.writeHead(429); res.end(JSON.stringify({ error: 'SIMULATED_QUOTA_EXHAUSTED' })); signals.push('HTTP_429_SIMULATED'); return; }
    if (mode === 'hold') { heldResponse = res; res.on('close', () => { aborted = true; }); return; }
  }
  try {
    const response = await fetch(directEndpoint + req.url, { method: req.method, ...(body ? { body, headers: { 'Content-Type': 'application/json' } } : {}), signal: AbortSignal.timeout(95000), redirect: 'error' });
    const bytes = await response.arrayBuffer(); res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(Buffer.from(bytes));
  } catch { if (!res.destroyed) { res.writeHead(503); res.end('{}'); } }
});
await new Promise(r => proxy.listen(0, '127.0.0.1', r));
const endpoint = 'http://127.0.0.1:' + proxy.address().port;
const env = { ...process.env, JARVIS_ALLOW_FIXTURES: '1', JARVIS_TEST_USER_DATA: profile, OLLAMA_HOST: endpoint };
async function launch() {
  app = await electron.launch({ executablePath, env, timeout: 60000 }); page = await app.firstWindow();
  await page.getByRole('button', { name: 'Home', exact: true }).waitFor({ timeout: 30000 });
  await page.evaluate(() => localStorage.setItem('jarvis.firstRun', JSON.stringify({ completed: true, version: 1, permissionPreset: 'ADMIN', sessionPolicy: 'keep', localAIChoice: 'skipped', fingerprint: null })));
  await page.reload(); await page.getByRole('button', { name: 'Home', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Proveedores de IA', exact: true }).click();
  await page.getByTestId('connected-ai').waitFor();
  await app.evaluate(({ Menu }) => { Menu.prototype.popup = function() { globalThis.s4Menu = this; }; });
  // Independent OS file notifications plus bytes/timestamps, not a mocked writer.
  watcher ??= fs.watch(path.join(profile, 'connected-ai/task-artifacts'), (event, file) => artifactEvents.push({ event, file, at: Date.now() }));
}
async function policy(id) { await page.evaluate(() => window.jarvis.connected.choose()); await app.evaluate((_e, id) => globalThis.s4Menu.getMenuItemById(id).click(), id); }
async function execute(prompt, model, settle = true) {
  await page.getByLabel('Modelo conectado').fill(model); await page.getByLabel('Petición conectada', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Ejecutar inteligencia', exact: true }).click();
  if (!settle) return;
  await wait(() => page.getByTestId('connected-output').innerText().then(s => !!s.trim()), 105000);
  return JSON.parse(await page.getByTestId('connected-output').innerText());
}
async function load(taskId) {
  const cp = await page.evaluate(id => window.jarvis.connected.checkpoint(id), taskId);
  await page.getByLabel('Continuar tarea', { exact: true }).fill(taskId); await page.getByRole('button', { name: 'Cargar checkpoint', exact: true }).click();
  await wait(() => page.getByTestId('connected-checkpoint').innerText().then(s => s.includes(taskId) && s.includes('checkpoint ' + cp.revision)));
}
async function artifact() { await page.getByRole('button', { name: 'Guardar resultado como artefacto', exact: true }).click(); await wait(() => page.getByTestId('connected-output').innerText().then(s => s.includes('"effect"'))); return JSON.parse(await page.getByTestId('connected-output').innerText()); }
async function privateGesture() {
  await page.evaluate(() => { const b = document.createElement('button'); b.id = 's4-probe-gesture'; b.setAttribute('data-connected-execute', ''); b.textContent = 'Owned fixture gesture'; document.body.append(b); });
  await page.locator('#s4-probe-gesture').click(); await page.evaluate(() => document.getElementById('s4-probe-gesture').remove());
}
try {
  await child.ready;
  await wait(async () => { try { const r = await fetch(directEndpoint + '/api/tags', { signal: AbortSignal.timeout(5000) }); return r.ok && (await r.json()).models?.length >= 2; } catch { return false; } }, 250000);
  const tags = await (await fetch(directEndpoint + '/api/tags')).json();
  const identities = models.map(name => tags.models.find(m => m.name === name));
  assert.ok(identities.every(Boolean)); assert.notEqual(identities[0].digest, identities[1].digest); assert.notEqual(identities[0].details.family, identities[1].details.family);
  pass('Two real distinct local intelligence families and model digests; no second alias of Qwen');
  await launch(); await policy('connected-data-LOCAL_ONLY');
  const first = await execute(`Our project code is ${code}. Reply with just that project code.`, models[0]);
  assert.equal(first.ok, true); assert.match(first.text, new RegExp(code)); assert.equal(first.model, models[0]);
  const taskId = first.taskId; assert.equal(first.operationId, taskId);
  pass('Packaged Qwen executes first operation and establishes stable task goal');
  const committed = await artifact(); assert.equal(committed.ok, true); assert.equal(committed.reused, false); assert.equal(committed.effect.writes, 1);
  const before = fs.statSync(committed.effect.file), bytes = fs.readFileSync(committed.effect.file), artifactHash = hash(bytes);
  await wait(() => artifactEvents.length > 0);
  assert.match(bytes.toString(), new RegExp(code)); assert.equal(committed.effect.sha256, artifactHash);
  pass('Main commits one real local artifact with content hash, durable receipt and separate OperationId');
  await load(taskId); mode = 'quota'; const attemptsBefore = requests.length;
  const failed = await execute('Continue this task with the next step.', models[0]); assert.equal(failed.ok, false); assert.notEqual(failed.operationId, first.operationId);
  const failedCheckpoint = await page.evaluate(id => window.jarvis.connected.checkpoint(id), taskId);
  assert.equal(failedCheckpoint.operations.find(o => o.operationId === failed.operationId).failure, 'RATE_LIMITED'); assert.ok(failedCheckpoint.state.pendingSteps.length); assert.equal(requests.length, attemptsBefore + 1);
  pass('Injected real HTTP 429 pauses task with pending work; no automatic second attempt');
  await page.evaluate(async id => { const s = await window.jarvis.fabric.task(id); s.goal = 'FORGED_NEW_GOAL'; s.completedWork = ['FORGED_DONE']; await window.jarvis.fabric.saveTask(s); await window.jarvis.fabric.appendMessage({ conversationId: s.conversationId, messageId: 'forged-message', parentId: null, role: 'assistant', content: 'FORGED_HANDOFF', timestamp: Date.now(), providerId: 'ollama-local', modelId: 'fake', taskId: id, channel: 'connected-ai', tools: [], artifacts: [], usageIds: [], contextRefs: [], routingDecisionId: null }); }, taskId);
  assert.equal((await page.evaluate(id => window.jarvis.fabric.task(id), taskId)).goal, failedCheckpoint.state.goal);
  pass('Public renderer cannot overwrite main-owned goal/completed checkpoint');
  eventsBeforeRestart = artifactEvents.length;
  await app.close(); app = null; const restartAttempts = requests.length; mode = 'normal'; await launch();
  assert.equal(requests.length, restartAttempts); await load(taskId);
  const restored = await page.evaluate(id => window.jarvis.connected.checkpoint(id), taskId); assert.equal(restored.revision, failedCheckpoint.revision); assert.equal(restored.effects[0].sha256, artifactHash);
  pass('Restart restores same task/checkpoint/pending/effect and performs no inference replay');
  await policy('connected-data-GENERIC');
  // The code exists only in prior task context, not in this continuation prompt.
  const next = await execute('What is our project code? Reply with only the code from the previous completed work.', models[1]);
  assert.equal(next.ok, true); assert.equal(next.taskId, taskId); assert.notEqual(next.operationId, first.operationId); assert.equal(next.model, models[1]); assert.match(next.text, new RegExp(code));
  const forwarded = requests.at(-1); assert.equal(forwarded.model, models[1]); assert.ok(!forwarded.prompt.includes(code)); assert.ok(forwarded.system.includes(code)); assert.ok(forwarded.system.includes('RATE_LIMITED')); assert.ok(forwarded.system.includes(committed.effect.effectId)); assert.ok(!forwarded.system.includes('FORGED_HANDOFF'));
  const current = await page.evaluate(id => window.jarvis.connected.checkpoint(id), taskId); const nextOp = current.operations.find(o => o.operationId === next.operationId);
  assert.equal(nextOp.handoffHash, hash(forwarded.system)); assert.equal(current.dataClass, 'LOCAL_ONLY'); assert.equal(current.state.goal, restored.state.goal);
  pass('Real SmolLM2 resumes same task using transmitted hashed handoff, previous result, pending failure and no-replay receipt');
  const after = fs.statSync(committed.effect.file); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.ctimeMs, before.ctimeMs); assert.equal(hash(fs.readFileSync(committed.effect.file)), artifactHash);
  assert.equal(artifactEvents.length, eventsBeforeRestart); pass('Handoff/inference did not repeat prior artifact effect: unchanged bytes/timestamps and no new OS file events');
  // Verify explicit repeated artifact request for the original source, not the newer result.
  const latest = await page.evaluate(id => window.jarvis.connected.checkpoint(id), taskId);
  await page.evaluate(({ taskId, revision, sourceOperationId }) => { const b = document.createElement('button'); b.id = 's4-repeat-artifact'; b.setAttribute('data-connected-artifact', ''); b.setAttribute('data-task-id', taskId); b.setAttribute('data-revision', String(revision)); b.setAttribute('data-source-operation', sourceOperationId); b.textContent = 'Owned repeat artifact fixture'; document.body.append(b); }, { taskId, revision: latest.revision, sourceOperationId: first.operationId });
  await page.locator('#s4-repeat-artifact').click();
  const reused = await page.evaluate(async ({ taskId, revision, sourceOperationId }) => { const id = 'repeat-artifact-' + crypto.randomUUID(), choice = { taskId, revision }; await window.jarvis.authority.begin(id, JSON.stringify({ ...choice, sourceOperationId })); return window.jarvis.connected.artifact(id, choice, sourceOperationId); }, { taskId, revision: latest.revision, sourceOperationId: first.operationId });
  await page.evaluate(() => document.getElementById('s4-repeat-artifact').remove()); assert.equal(reused.reused, true); assert.equal(artifactEvents.length, eventsBeforeRestart); assert.equal(fs.statSync(committed.effect.file).mtimeMs, before.mtimeMs);
  pass('Even explicit replay with new operation verifies existing artifact without executing write again');
  await load(taskId); await page.getByLabel('Petición conectada', { exact: true }).fill('Replay probe'); await page.getByLabel('Modelo conectado').fill(models[1]); await privateGesture();
  const preReplay = requests.length;
  const replay = await page.evaluate(async ({ id, taskId, revision, model }) => { await window.jarvis.authority.begin(id, 'Replay probe'); try { await window.jarvis.connected.execute(id, 'Replay probe', { providerId: 'ollama-local', model, continuation: { taskId, revision } }); return 'ALLOWED'; } catch (e) { return String(e); } }, { id: first.operationId, taskId, revision: reused.effect ? (await page.evaluate(id => window.jarvis.connected.checkpoint(id), taskId)).revision : 0, model: models[1] });
  assert.match(replay, /ALREADY_USED/); assert.equal(requests.length, preReplay); pass('Persisted OperationId cannot replay inference after process restart');
  // Capture exact revision, then submit a stale one; either gesture seal or
  // durable revision guard must reject before any provider traffic.
  await privateGesture(); const stale = await page.evaluate(async ({ taskId, model }) => { const id = 'stale-' + crypto.randomUUID(); await window.jarvis.authority.begin(id, 'Replay probe'); try { await window.jarvis.connected.execute(id, 'Replay probe', { providerId: 'ollama-local', model, continuation: { taskId, revision: 0 } }); return 'ALLOWED'; } catch (e) { return String(e); } }, { taskId, model: models[1] });
  assert.match(stale, /GESTURE_REQUIRED|STALE_CHECKPOINT/); assert.equal(requests.length, preReplay); pass('Stale/forged handoff revision denied before request');
  mode = 'hold'; await load(taskId); const preHold = requests.length; await execute('Continue with a cancellable operation.', models[1], false); await wait(() => requests.length > preHold && !!heldResponse);
  await page.getByRole('button', { name: 'STOP inteligencias', exact: true }).click(); await wait(() => aborted); await wait(() => page.getByTestId('connected-output').innerText().then(s => s.includes('STOPPED')));
  const stopped = await page.evaluate(id => window.jarvis.connected.checkpoint(id), taskId); assert.equal(stopped.operations.at(-1).status, 'STOPPED'); assert.equal(fs.statSync(committed.effect.file).mtimeMs, before.mtimeMs);
  pass('STOP aborts continuation in flight and leaves existing side effect unchanged');
  await page.screenshot({ path: path.join(evidence, 'continuity-s4.png') });
  const usage = await page.evaluate(() => window.jarvis.fabric.usagePage('ollama-local')); assert.ok(models.every(model => usage.some(u => u.modelId === model && u.taskId === taskId && u.output > 0)));
  pass('Observed usage and history identify both models under the same task, not two disconnected tasks');
  assert.equal(artifactEvents.length, eventsBeforeRestart);
  fs.writeFileSync(path.join(evidence, 's4-runtime.json'), JSON.stringify({ status: 'PASS', checks, executablePath, taskId, profile, models: identities.map(m => ({ name: m.name, digest: m.digest, family: m.details.family })), first, next, failure: { operationId: failed.operationId, source: 'HTTP_429_SIMULATED' }, checkpoint: stopped, requests, artifact: { ...committed.effect, before: { mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs }, after: { mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs }, verifiedSHA256: artifactHash, osEventsBeforeRestart: eventsBeforeRestart, osEventsAfterRestart: artifactEvents.length - eventsBeforeRestart, events: artifactEvents }, paidApiCalls: 0, proxySuccessResponses: 'REAL_OLLAMA_ONLY', policyInteraction: 'MAIN_NATIVE_MENU_CALLBACK_TEST_DRIVER' }, null, 2));
  console.log('S4_PACKAGED_PASS ' + checks.length);
} catch (e) { failures.push(String(e)); fs.writeFileSync(path.join(evidence, 's4-failure.json'), JSON.stringify({ status: 'FAIL', checks, failures, requests, signals }, null, 2)); throw e; }
finally { if (app) await app.close().catch(() => {}); watcher?.close(); heldResponse?.destroy(); proxy.closeAllConnections(); await new Promise(r => proxy.close(r)); await child.killTree(); fs.writeFileSync(path.join(evidence, 'ollama-runtime.log'), runtimeLog); }
