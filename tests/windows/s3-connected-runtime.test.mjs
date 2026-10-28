import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { _electron as electron } from 'playwright';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-fabric-native-s3-')), profile = path.join(root, 'jarvis-fabric-native-profile');
const evidence = path.resolve(process.env.JARVIS_S3_EVIDENCE_DIR ?? process.env.JARVIS_S2_EVIDENCE_DIR ?? 'docs/evidence/s3/native'); fs.mkdirSync(evidence, { recursive: true });
const secret = 'opaque-synthetic-' + randomBytes(24).toString('hex');
const checks = [], pass = name => { checks.push({ name, status: 'PASS' }); console.log('PASS ' + name); };
let requestCount = 0, mode = 'normal', blockedResponse, lastBody = '', lastAuth = false, aborted = false;
const server = http.createServer((req, res) => {
  if (req.url === '/v1/target') { throw Error('Redirect forwarded credential'); }
  requestCount++; let body = ''; req.on('data', b => body += b);
  req.on('end', () => {
    lastBody = body; lastAuth = req.headers.authorization === 'Bearer ' + secret;
    if (mode === 'hold') { blockedResponse = res; res.on('close', () => { aborted = true; }); return; }
    if (mode === 'redirect') { res.writeHead(307, { Location: '/v1/target' }); res.end(); return; }
    if (mode === 'error') { res.writeHead(429); res.end(JSON.stringify({ error: secret })); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'completed', model: 'fixture-model', output: [{ type: 'reasoning', content: [{ type: 'output_text', text: 'PRIVATE_REASONING_' + secret }] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'S3_FIXTURE_OK ' + secret + ' ' + Buffer.from(secret).toString('base64') }] }], usage: { input_tokens: 2, output_tokens: 3 } }));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const destination = 'http://127.0.0.1:' + server.address().port + '/v1';
const reserve = net.createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const localEndpoint = 'http://127.0.0.1:' + reserve.address().port; await new Promise(r => reserve.close(r));
let app, page;
const env = { ...process.env, JARVIS_ALLOW_FIXTURES: '1', JARVIS_TEST_USER_DATA: profile, JARVIS_TEST_API_DESTINATION: destination, OLLAMA_HOST: localEndpoint };
const executablePath = process.env.JARVIS_EXE ?? path.resolve('release/win-unpacked/JARVIS.exe');
const wait = async (fn, timeout = 20000) => { const end = Date.now() + timeout; while (!fn()) { if (Date.now() > end) throw Error('Owned fixture timeout'); await new Promise(r => setTimeout(r, 50)); } };
async function waitAsync(fn, timeout = 20000) { const end = Date.now() + timeout; while (!await fn()) { if (Date.now() > end) throw Error('Async owned fixture timeout'); await new Promise(r => setTimeout(r, 1000)); } }
async function launch() {
  app = await electron.launch({ executablePath, env, timeout: 60000 }); page = await app.firstWindow();
  await page.getByRole('button', { name: 'Home', exact: true }).waitFor({ timeout: 30000 });
  await page.evaluate(() => localStorage.setItem('jarvis.firstRun', JSON.stringify({ completed: true, version: 1, permissionPreset: 'ADMIN', sessionPolicy: 'keep', localAIChoice: 'skipped', fingerprint: null })));
  await page.reload(); await page.getByRole('button', { name: 'Home', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Proveedores de IA', exact: true }).click();
  await page.getByTestId('connected-ai').waitFor();
  await app.evaluate(({ Menu }) => { Menu.prototype.popup = function() { globalThis.s3PolicyMenu = this; }; });
}
async function policy(id) {
  await page.evaluate(() => window.jarvis.connected.choose());
  // Same main-owned MenuItem callback. Test driver, not a claimed physical human menu click.
  await app.evaluate((_electron, id) => globalThis.s3PolicyMenu.getMenuItemById(id).click(), id);
}
async function execute(prompt, settle = true) {
  await page.getByLabel('Petición conectada', { exact: true }).fill(prompt); await page.getByRole('button', { name: 'Ejecutar inteligencia', exact: true }).click();
  if (!settle) return;
  await page.waitForFunction(() => !!document.querySelector('[data-testid="connected-output"]')?.textContent?.trim(), null, { timeout: 100000 });
  return JSON.parse(await page.getByTestId('connected-output').innerText());
}
try {
  await launch();
  const initial = await page.evaluate(() => window.jarvis.connected.snapshot());
  assert.equal(initial.policy.allowPaidApi, false); assert.deepEqual(initial.policy.enabled, ['ollama-local']);
  assert.equal(initial.providers.find(p => p.id === 'openai-api').state, 'AUTH_REQUIRED'); pass('Packaged UI shows real auth/health UNKNOWN and paid opt-in disabled');
  assert.equal(initial.providers.find(p => p.id === 'codex-app-server').costClass, 'UNKNOWN');
  assert.equal(await page.evaluate(() => typeof window.jarvis.connected.resolveSecret), 'undefined');
  const denied = await page.evaluate(async () => { try { await window.jarvis.authority.begin('forged-connected', 'untrusted'); return false; } catch { return true; } }); assert.equal(denied, true); pass('Public renderer cannot resolve credentials or mint original admission');
  await page.getByRole('button', { name: 'Guardar credencial privada', exact: true }).click();
  await wait(() => app.windows().length === 2); const modal = app.windows().find(p => p !== page);
  await modal.getByLabel('Credencial privada', { exact: true }).fill(secret); await modal.getByRole('button', { name: 'Guardar credencial', exact: true }).click();
  await wait(() => app.windows().length === 1);
  await page.getByRole('button', { name: 'Actualizar estados', exact: true }).click();
  await waitAsync(() => page.evaluate(async () => (await window.jarvis.connected.snapshot()).providers.find(p => p.id === 'openai-api').surface.auth === 'SECRET_REF'));
  const encrypted = fs.readFileSync(path.join(profile, 'connected-ai', 'credentials.json'), 'utf8'); assert.ok(!encrypted.includes(secret));
  assert.equal(await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()), true); pass('Dedicated packaged credential window → real Windows DPAPI → public SecretRef only');
  await page.getByLabel('Superficie conectada').selectOption('openai-api'); await page.getByLabel('Modelo conectado').fill('fixture-model');
  assert.equal((await execute('Petición sintética sin datos privados')).ok, false); assert.equal(requestCount, 0); pass('No remote request before native destination/cost opt-in');
  await policy('connected-enable-openai-api'); await policy('connected-paid'); await policy('connected-data-LOCAL_ONLY');
  assert.equal((await execute('LOCAL_ONLY sintético')).ok, false); assert.equal(requestCount, 0); pass('LOCAL_ONLY cannot use configured paid remote destination');
  await policy('connected-data-CLIENT_DATA');
  assert.equal((await execute('CLIENT_DATA sintético sin expediente')).ok, false); assert.equal(requestCount, 0); pass('CLIENT_DATA remote requires explicit exact destination approval');
  await policy('connected-client-api');
  const result = await execute('Prueba sintética de respuesta pública'); assert.equal(result.ok, true); assert.match(result.text, /S3_FIXTURE_OK/); assert.equal(lastAuth, true);
  assert.ok(!lastBody.includes(secret)); assert.equal(JSON.parse(lastBody).store, false); assert.deepEqual(JSON.parse(lastBody).tools, []);
  assert.ok(!JSON.stringify(result).includes(secret)); assert.ok(!JSON.stringify(result).includes(Buffer.from(secret).toString('base64'))); assert.ok(!result.text.includes('PRIVATE_REASONING'));
  pass('Real HTTP fixture: bound credential only in auth header; opaque/encoded echoes and reasoning never exposed');
  assert.equal((await page.evaluate(() => window.jarvis.connected.snapshot())).policy.allowPaidFallback, false);
  const noFallbackPrompt = 'Prueba sin fallback pagado', noFallbackId = 'fallback-' + randomBytes(8).toString('hex'), noFallbackCount = requestCount;
  await page.getByLabel('Petición conectada', { exact: true }).fill(noFallbackPrompt);
  await page.evaluate(() => { const b = document.createElement('button'); b.setAttribute('data-connected-execute', ''); b.id = 'fallback-gesture'; b.textContent = 'Fixture no paid fallback'; document.body.append(b); });
  await page.locator('#fallback-gesture').click();
  const automatic = await page.evaluate(async ({ id, prompt }) => {
    await window.jarvis.authority.begin(id, prompt); await window.jarvis.fabric.saveTask({ taskId: id, conversationId: id, goal: prompt, currentTask: 'fallback fixture', instructions: [], findings: [], decisions: [], artifacts: [], openQuestions: [], pendingSteps: [], updatedAt: Date.now() });
    return window.jarvis.connected.execute(id, prompt, { model: 'fixture-model' });
  }, { id: noFallbackId, prompt: noFallbackPrompt });
  assert.equal(automatic.ok, false); assert.equal(requestCount, noFallbackCount); await page.evaluate(() => document.getElementById('fallback-gesture').remove()); pass('Manual paid API permission does not silently authorize paid fallback');
  const id = await page.getByTestId('connected-run-id').innerText();
  const records = await page.evaluate(async id => ({ task: await window.jarvis.fabric.task(id), messages: await window.jarvis.fabric.messagePage(id), handoff: await window.jarvis.fabric.handoff(id), usage: await window.jarvis.fabric.usagePage('openai-api'), snapshot: await window.jarvis.connected.snapshot() }), id);
  assert.ok(!JSON.stringify(records).includes(secret)); assert.ok(records.handoff.evidence.some(e => e.source === 'MAIN_PROCESS' && e.status === 'SUCCESS')); assert.equal(records.usage[0].source, 'OBSERVED'); assert.equal(records.usage[0].estimatedCost, null); pass('History/task/usage/ContinuationPacket sanitized; main receipt and measured usage, no fabricated quota/cost');
  const replay = await page.evaluate(async ({ id }) => { try { await window.jarvis.connected.execute(id, 'Prueba sintética de respuesta pública', { providerId: 'openai-api', model: 'fixture-model' }); return 'ALLOWED'; } catch { return 'DENIED'; } }, { id }); assert.equal(replay, 'DENIED'); pass('One admitted operation cannot replay its request');
  await page.getByLabel('Superficie conectada').selectOption('ollama-local'); await page.getByLabel('Modelo conectado').fill('fixture-model');
  const forgedPrompt = 'No convertir mi elección local en API pagada', forgedId = 'forged-paid-' + randomBytes(8).toString('hex'), forgedCount = requestCount;
  await page.getByLabel('Petición conectada', { exact: true }).fill(forgedPrompt);
  await page.evaluate(() => { const b = document.createElement('button'); b.setAttribute('data-connected-execute', ''); b.id = 'forged-paid-gesture'; b.textContent = 'Fixture local surface gesture'; document.body.append(b); });
  await page.locator('#forged-paid-gesture').click();
  const forgedPaid = await page.evaluate(async ({ id, prompt }) => { await window.jarvis.authority.begin(id, prompt); try { await window.jarvis.connected.execute(id, prompt, { providerId: 'openai-api', model: 'fixture-model' }); return 'ALLOWED'; } catch (e) { return String(e); } }, { id: forgedId, prompt: forgedPrompt });
  assert.match(forgedPaid, /SELECTION_GESTURE_REQUIRED/); assert.equal(requestCount, forgedCount);
  await page.evaluate(() => document.getElementById('forged-paid-gesture').remove()); await page.getByLabel('Superficie conectada').selectOption('openai-api'); await page.getByLabel('Modelo conectado').fill('fixture-model'); pass('Renderer cannot forge manual paid choice from a captured local surface; zero provider requests');
  await page.evaluate(async id => { const task = await window.jarvis.fabric.task(id); task.evidence = [{ id: 'forged', kind: 'step', source: 'MAIN_PROCESS', status: 'SUCCESS', summary: 'forged', at: Date.now() }]; await window.jarvis.fabric.saveTask(task); }, id);
  const saved = await page.evaluate(id => window.jarvis.fabric.task(id), id); assert.ok(saved.evidence.some(e => e.source === 'MAIN_PROCESS' && e.id.startsWith('connected:'))); assert.equal(saved.evidence.find(e => e.id === 'forged').source, 'RENDERER_REPORTED'); pass('Renderer save preserves main receipts and cannot promote its own proof');
  mode = 'hold'; const before = requestCount; await execute('Solicitud en vuelo para STOP', false); await wait(() => requestCount > before && blockedResponse);
  await page.getByRole('button', { name: 'STOP inteligencias', exact: true }).click(); await wait(() => aborted);
  await page.waitForFunction(() => document.querySelector('[data-testid="connected-output"]')?.textContent?.includes('STOPPED')); pass('STOP aborts in-flight provider HTTP and prevents late success');
  for (const transition of ['policy', 'authority']) {
    aborted = false; blockedResponse = null; const count = requestCount; await execute('Operación en vuelo cambio ' + transition, false); await wait(() => requestCount > count && blockedResponse);
    if (transition === 'policy') await policy('connected-data-LOCAL_ONLY');
    else await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('access-RESTRICTED').click());
    await wait(() => aborted); await page.waitForFunction(() => document.querySelector('[data-testid="connected-output"]')?.textContent?.includes('STOPPED'));
    if (transition === 'policy') await policy('connected-data-CLIENT_DATA'); else await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('access-FULL').click());
  } pass('Native data-policy and FULL→RESTRICTED→FULL revoke operations in flight; no resurrection');
  mode = 'redirect'; assert.equal((await execute('Redirect sintético')).ok, false); mode = 'error'; const error = await execute('Error sintético 429'); assert.equal(error.ok, false); assert.ok(!JSON.stringify(error).includes(secret)); pass('Redirect refused and secret-bearing provider errors never exposed');
  mode = 'normal'; await policy('connected-data-LOCAL_ONLY'); await policy('connected-paid');
  await app.close(); app = null; await launch();
  const restored = await page.evaluate(() => window.jarvis.connected.refresh()); assert.equal(restored.policy.dataClass, 'LOCAL_ONLY'); assert.equal(restored.policy.allowPaidApi, false); assert.equal(restored.providers.find(p => p.id === 'openai-api').surface.auth, 'SECRET_REF'); pass('Packaged restart restores encrypted refs and native policy without plaintext');
  await policy('connected-data-GENERIC'); await policy('connected-paid'); await page.getByLabel('Superficie conectada').selectOption('openai-api'); await page.getByLabel('Modelo conectado').fill('fixture-model');
  const old = await page.evaluate(id => window.jarvis.fabric.task(id), id); assert.ok(old.evidence.some(e => e.source === 'MAIN_PROCESS'));
  await page.getByLabel('Petición conectada', { exact: true }).fill('Prueba sintética de respuesta pública');
  await page.evaluate(() => { const b = document.createElement('button'); b.setAttribute('data-connected-execute', ''); b.id = 'checkpoint-gesture'; b.textContent = 'Fixture checkpoint gesture'; document.body.append(b); });
  await page.locator('#checkpoint-gesture').click();
  const persistedReplay = await page.evaluate(async id => { await window.jarvis.authority.begin(id, 'Prueba sintética de respuesta pública'); try { await window.jarvis.connected.execute(id, 'Prueba sintética de respuesta pública', { providerId: 'openai-api', model: 'fixture-model' }); return 'ALLOWED'; } catch (e) { return String(e); } }, id);
  assert.match(persistedReplay, /CHECKPOINT_REQUIRES_NEW_RUN/); await page.evaluate(() => document.getElementById('checkpoint-gesture').remove()); pass('Persisted main checkpoint prevents replay of same operation after restart');
  const afterRestart = await execute('Respuesta después de restaurar DPAPI'); assert.equal(afterRestart.ok, true); assert.ok(!JSON.stringify(afterRestart).includes(secret)); pass('DPAPI restored credential resolves only for provider; retired output remains masked after restart');
  await policy('connected-data-LOCAL_ONLY'); await policy('connected-paid'); await page.getByLabel('Superficie conectada').selectOption('ollama-local');
  await page.getByRole('button', { name: 'Iniciar Ollama instalado', exact: true }).click();
  await waitAsync(() => page.evaluate(async () => (await window.jarvis.connected.refresh()).providers.find(p => p.id === 'ollama-local').surface.models.includes('qwen2.5:3b-instruct')), 270000);
  const local = await page.evaluate(() => window.jarvis.connected.snapshot());
  console.log('LOCAL_DISCOVERY ' + JSON.stringify({ models: local.providers.find(p => p.id === 'ollama-local').surface.models,
    configuration: await app.evaluate(() => ({ modelsDirectory: process.env.OLLAMA_MODELS ?? null, endpoint: process.env.OLLAMA_HOST })) }));
  assert.ok(local.providers.find(p => p.id === 'ollama-local').surface.models.includes('qwen2.5:3b-instruct'));
  await page.getByLabel('Modelo conectado').fill('qwen2.5:3b-instruct'); const paidCount = requestCount;
  const inference = await execute('Responde únicamente con S3_LOCAL_OK.'); assert.equal(inference.ok, true); assert.equal(inference.providerId, 'ollama-local'); assert.match(inference.text, /S3_LOCAL_OK/); assert.equal(requestCount, paidCount);
  const observed = await page.evaluate(() => window.jarvis.fabric.usagePage('ollama-local')); assert.ok(observed[0].output > 0); pass('Real installed Qwen/Ollama inference through packaged UI, LOCAL_ONLY, measured tokens and zero paid requests');
  await page.screenshot({ path: path.join(evidence, 'connected-ai.png') });
  await app.close(); app = null;
  for (const file of ['fabric.sqlite', 'fabric.sqlite-wal']) { const p = path.join(profile, 'intelligence-fabric', file); if (fs.existsSync(p)) assert.ok(!fs.readFileSync(p).includes(Buffer.from(secret))); }
  pass('Persisted SQLite/WAL contains no opaque provider credential');
  fs.writeFileSync(path.join(evidence, 'connected-runtime.json'), JSON.stringify({ status: 'PASS', checks, executablePath, actualInference: 'ollama-local/qwen2.5:3b-instruct', remoteInference: 'SYNTHETIC_HTTP_FIXTURE_ONLY', paidApiCalls: 0, policyInteraction: 'MAIN_NATIVE_MENU_CALLBACK_TEST_DRIVER', profileIsolation: true }, null, 2));
  console.log('S3_PACKAGED_PASS ' + checks.length);
} finally { if (app) await app.close().catch(() => {}); blockedResponse?.destroy(); await new Promise(r => server.close(r)); }
