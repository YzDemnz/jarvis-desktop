import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { verifyInvoiceCode } from './s41-invoice-verifier.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-fabric-native-s41-')), profile = path.join(root, 'jarvis-fabric-native-profile');
const evidence = path.resolve(process.env.JARVIS_S2_EVIDENCE_DIR ?? 'docs/evidence/s41/native'); fs.mkdirSync(evidence, { recursive: true });
const hash = b => createHash('sha256').update(b).digest('hex');
const checks = [], pass = name => { checks.push({ name, status: 'PASS' }); console.log('PASS ' + name); };
const firstModel = 'smollm2:1.7b-instruct-q4_K_M', secondModel = 'qwen2.5:3b-instruct';
const fixture = { blue: { quantity: 2, unitPrice: 7 }, red: { quantity: 3, unitPrice: 5 } };
// This fixture is exclusively test-owned; no actual user project is edited.
fs.writeFileSync(path.join(root, 'order-source.csv'), 'sku,quantity,unitPrice\nblue,2,7\nred,3,5\n');
let app, page, mainPid, mode = 'normal', watcher; const requests = [], events = [];
const nativeObservations = [];
const nativeChild = () => {
  // Observe only live CLI descendants of this application's actual main PID.
  const rows = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "jarvis-process-host.exe" -or $_.Name -like "llama-cli*.exe" } | Select-Object Name,ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true }) || '[]');
  const list = Array.isArray(rows) ? rows : [rows];
  const hosts = list.filter(p => p.Name === 'jarvis-process-host.exe' && p.ParentProcessId === mainPid).map(p => p.ProcessId);
  const owned = new Set(hosts);
  for (let i = 0; i < list.length; i++) for (const p of list) if (owned.has(p.ParentProcessId)) owned.add(p.ProcessId);
  return list.find(p => /^llama-cli.*\.exe$/i.test(p.Name) && owned.has(p.ProcessId));
};
const live = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = async (fn, timeout = 30000) => { const end = Date.now() + timeout; while (!await fn()) { if (Date.now() > end) throw Error('S41_WAIT_TIMEOUT'); await new Promise(r => setTimeout(r, 100)); } };
const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r)); const direct = 'http://127.0.0.1:' + socket.address().port; await new Promise(r => socket.close(r));
await build({ entryPoints: ['electron/process/WindowsJobProcess.ts'], outfile: path.join(root, 'job.mjs'), bundle: true, platform: 'node', format: 'esm' });
const jobs = await import(pathToFileURL(path.join(root, 'job.mjs')));
const exe = process.env.JARVIS_OLLAMA_EXE ?? path.join(process.env.LOCALAPPDATA, 'Programs/Ollama/ollama.exe');
const child = jobs.spawnWindowsJob({ file: exe, cwd: path.dirname(exe), args: ['serve'], env: { ...process.env, OLLAMA_HOST: direct, OLLAMA_NO_CLOUD: '1', OLLAMA_NOPRUNE: '1' } });
// Only quota/availability failures are simulated. All successful responses are real.
const proxy = http.createServer(async (req, res) => {
  let body = ''; for await (const b of req) body += b;
  if (req.url === '/api/generate') { requests.push({ body: JSON.parse(body), mode }); if (mode === 'quota') { res.writeHead(429); res.end('{}'); return; } }
  try { const r = await fetch(direct + req.url, { method: req.method, ...(body ? { body, headers: { 'Content-Type': 'application/json' } } : {}), signal: AbortSignal.timeout(95000), redirect: 'error' }); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(Buffer.from(await r.arrayBuffer())); }
  catch { if (!res.destroyed) { res.writeHead(503); res.end('{}'); } }
}); await new Promise(r => proxy.listen(0, '127.0.0.1', r));
const env = { ...process.env, JARVIS_ALLOW_FIXTURES: '1', JARVIS_TEST_USER_DATA: profile, OLLAMA_HOST: 'http://127.0.0.1:' + proxy.address().port };
async function launch() {
  app = await electron.launch({ executablePath: path.resolve('release/win-unpacked/JARVIS.exe'), env, timeout: 60000 }); page = await app.firstWindow();
  mainPid = await app.evaluate(() => process.pid);
  await page.getByRole('button', { name: 'Home', exact: true }).waitFor({ timeout: 30000 });
  await page.evaluate(() => localStorage.setItem('jarvis.firstRun', JSON.stringify({ completed: true, version: 1, permissionPreset: 'ADMIN', sessionPolicy: 'keep', localAIChoice: 'skipped', fingerprint: null })));
  await page.reload(); await page.getByRole('button', { name: 'Home', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Proveedores de IA', exact: true }).click();
  await page.getByTestId('connected-ai').waitFor(); await app.evaluate(({ Menu }) => { Menu.prototype.popup = function() { globalThis.s41Menu = this; }; });
  watcher ??= fs.watch(path.join(profile, 'connected-ai/task-artifacts'), (event, file) => events.push({ event, file, at: Date.now() }));
  await page.evaluate(() => window.jarvis.connected.refresh());
}
async function policy(id) { await page.evaluate(() => window.jarvis.connected.choose()); await app.evaluate((_e, id) => globalThis.s41Menu.getMenuItemById(id).click(), id); }
async function load(taskId) { await page.getByLabel('Continuar tarea', { exact: true }).fill(taskId); await page.getByRole('button', { name: 'Cargar checkpoint', exact: true }).click(); await wait(() => page.getByTestId('connected-checkpoint').innerText().then(s => s.includes(taskId))); }
async function execute(surface, model, prompt, settle = true) {
  await page.getByLabel('Superficie conectada').selectOption(surface); await page.getByLabel('Modelo conectado').fill(model); await page.getByLabel('Petición conectada', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Ejecutar inteligencia', exact: true }).click();
  if (!settle) return; await wait(() => page.getByTestId('connected-output').innerText().then(s => !!s.trim()), surface === 'llama-cpp-local' ? 435000 : 105000); return JSON.parse(await page.getByTestId('connected-output').innerText());
}
async function artifact() { await page.getByRole('button', { name: 'Guardar resultado como artefacto', exact: true }).click(); await wait(() => page.getByTestId('connected-output').innerText().then(s => s.includes('"effect"'))); return JSON.parse(await page.getByTestId('connected-output').innerText()); }
const publicJSON = text => JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
try {
  await child.ready; await wait(async () => { try { const r = await fetch(direct + '/api/tags'); return r.ok && (await r.json()).models.some(m => m.name === firstModel); } catch { return false; } }, 250000);
  await launch(); await policy('connected-data-LOCAL_ONLY'); await policy('connected-enable-llama-cpp-local');
  const surfaces = await page.evaluate(() => window.jarvis.connected.snapshot());
  assert.equal(surfaces.providers.find(p => p.id === 'llama-cpp-local').surface.transport, 'LLAMA_CPP_CLI'); assert.equal(surfaces.policy.allowPaidApi, false);
  pass('Independent provisioned CLI runtime registered inside S3, explicit opt-in, no API payment');
  const first = await execute('ollama-local', firstModel, 'Build a small invoice calculation module. First normalize this test-owned order CSV into compact JSON only: {"items":[{"sku":string,"quantity":number,"unitPrice":number}]}. Keep both rows and all numbers. Do not output checkpoint metadata. CSV:\n' + fs.readFileSync(path.join(root, 'order-source.csv'), 'utf8'));
  assert.equal(first.ok, true); const normalized = publicJSON(first.text); assert.equal(normalized.items.length, 2);
  for (const item of normalized.items) assert.deepEqual({ quantity: item.quantity, unitPrice: item.unitPrice }, fixture[item.sku]);
  const taskId = first.taskId; pass('Real SmolLM2 normalizes order fixture into verified structured work');
  const original = await artifact(); assert.equal(original.effect.writes, 1); const old = fs.statSync(original.effect.file), oldHash = hash(fs.readFileSync(original.effect.file));
  await wait(() => events.length > 0); const beforeEvents = events.length;
  await load(taskId); mode = 'quota'; const failed = await execute('ollama-local', firstModel, 'Finish the invoice.'); assert.equal(failed.ok, false);
  const cp = await page.evaluate(id => window.jarvis.connected.checkpoint(id), taskId); assert.equal(cp.operations.at(-1).failure, 'RATE_LIMITED'); pass('429 simulation persisted as a failed operation; no silent intelligence fallback');
  await child.killTree(); assert.equal(live(child.pid), false);
  pass('Source Ollama daemon is stopped before handoff; destination cannot use its inference session');
  await app.close(); app = null; const count = requests.length; mode = 'normal'; await launch(); await load(taskId); assert.equal(requests.length, count);
  pass('Restart restores JARVIS task and receipts without provider replay');
  await execute('llama-cpp-local', secondModel, 'Continue the invoice project using the completed normalized items in the checkpoint. Implement function invoiceTotal(items) using items.reduce with an arrow (total, item) callback and initial accumulator 0. Return the sum of quantity multiplied by unit price; use the exact property names observed in the normalized items. Reply ONLY with this JavaScript function, no prose or markdown. Do not repeat normalization or write an artifact.', false);
  let native; await wait(() => !!(native = nativeChild()), 240000); nativeObservations.push(native);
  assert.ok(native.CommandLine.includes('jarvis.handoff.v2')); assert.ok(native.CommandLine.includes(original.effect.effectId));
  await wait(() => page.getByTestId('connected-output').innerText().then(s => !!s.trim()), 435000);
  const next = JSON.parse(await page.getByTestId('connected-output').innerText());
  assert.equal(next.ok, true); assert.equal(next.taskId, taskId); assert.notEqual(next.operationId, first.operationId); assert.equal(next.providerId, 'llama-cpp-local');
  const workVerification = verifyInvoiceCode(next.text, normalized); assert.equal(requests.length, count);
  const after = await page.evaluate(id => window.jarvis.connected.checkpoint(id), taskId), operation = after.operations.find(o => o.operationId === next.operationId);
  const structured = JSON.parse(operation.handoff.slice(operation.handoff.indexOf('\n') + 1));
  assert.equal(structured.schema, 'jarvis.handoff.v2'); assert.equal(structured.completed[0].operationId, first.operationId); assert.deepEqual(publicJSON(structured.completed[0].result), normalized);
  assert.equal(structured.receipts[0].verification, 'READ_ONLY_HASH_VERIFIED'); assert.equal(operation.handoffHash, hash(operation.handoff)); assert.equal(operation.provenance.transport, 'LLAMA_CPP_CLI'); assert.equal(operation.provenance.ownership, 'WINDOWS_JOB');
  pass('Real independent llama.cpp continues useful invoice work from structured checkpoint, with main-owned provenance');
  assert.equal(hash(fs.readFileSync(original.effect.file)), oldHash); assert.equal(fs.statSync(original.effect.file).mtimeMs, old.mtimeMs); assert.equal(fs.statSync(original.effect.file).ctimeMs, old.ctimeMs); assert.equal(events.length, beforeEvents);
  pass('No prior effect repeated across surfaces: hash, timestamps and OS events unchanged');
  await load(taskId); const finalArtifact = await artifact(); assert.equal(finalArtifact.effect.writes, 1); assert.deepEqual(verifyInvoiceCode(fs.readFileSync(finalArtifact.effect.file, 'utf8'), normalized).results, [29, 0, 14]);
  pass('Useful continuation saved as a new distinct verified artifact with its own receipt');
  await load(taskId); await execute('llama-cpp-local', secondModel, 'Produce a detailed invoice narrative.', false);
  let stopChild; await wait(() => !!(stopChild = nativeChild()), 240000); nativeObservations.push(stopChild);
  await page.getByRole('button', { name: 'STOP inteligencias', exact: true }).click(); await wait(() => page.getByTestId('connected-output').innerText().then(s => s.includes('STOPPED')));
  const stopped = JSON.parse(await page.getByTestId('connected-output').innerText()); assert.equal(stopped.ok, false);
  await wait(() => !live(stopChild.ProcessId));
  pass('STOP revokes in-flight independent runtime operation without applying effects');
  await load(taskId); await execute('llama-cpp-local', secondModel, 'Produce a detailed invoice narrative.', false);
  let policyChild; await wait(() => !!(policyChild = nativeChild()), 240000); nativeObservations.push(policyChild);
  await policy('connected-enable-llama-cpp-local'); await wait(() => page.getByTestId('connected-output').innerText().then(s => s.includes('STOPPED')));
  await wait(() => !live(policyChild.ProcessId));
  pass('Policy disable while operation is in flight cancels continuation; no resurrection');
  await policy('connected-enable-llama-cpp-local');
  await load(taskId); await execute('llama-cpp-local', secondModel, 'Produce a detailed invoice narrative.', false);
  let authorityChild; await wait(() => !!(authorityChild = nativeChild()), 240000); nativeObservations.push(authorityChild);
  await page.evaluate(() => window.jarvis.authority.choose());
  await app.evaluate(() => globalThis.s41Menu.getMenuItemById('access-RESTRICTED').click());
  await wait(() => page.getByTestId('connected-output').innerText().then(s => s.includes('STOPPED')));
  await wait(() => !live(authorityChild.ProcessId));
  await page.evaluate(() => window.jarvis.authority.choose());
  await app.evaluate(() => globalThis.s41Menu.getMenuItemById('access-FULL').click());
  assert.equal((await page.evaluate(() => window.jarvis.authority.snapshot())).accessMode, 'FULL');
  assert.equal(live(authorityChild.ProcessId), false);
  pass('FULL to RESTRICTED cancels a live CLI child; returning to FULL does not resurrect it');
  const final = await page.evaluate(id => window.jarvis.connected.checkpoint(id), taskId); assert.equal(final.dataClass, 'LOCAL_ONLY'); assert.equal(hash(fs.readFileSync(original.effect.file)), oldHash);
  const ledger = await page.evaluate(async () => ({ ollama: await window.jarvis.fabric.usagePage('ollama-local'), llama: await window.jarvis.fabric.usagePage('llama-cpp-local') }));
  await page.screenshot({ path: path.join(evidence, 'cross-surface.png') });
  fs.writeFileSync(path.join(evidence, 's41-runtime.json'), JSON.stringify({ status: 'PASS', checks, taskId, first, next, original, finalArtifact, checkpoint: final, ledger, requests, nativeObservations, workVerification, artifact: { oldHash, before: { mtimeMs: old.mtimeMs, ctimeMs: old.ctimeMs }, noReplayOSEvents: 0 }, paidApiCalls: 0, fixture, limits: ['Different runtimes, not a native tool harness', 'Only typed artifact effects', 'quota simulated', 'Semantic verifier is the owned test fixture, not a general product verifier'] }, null, 2));
  console.log('S41_RUNTIME_PASS ' + checks.length);
} catch (e) { fs.writeFileSync(path.join(evidence, 's41-failure.json'), JSON.stringify({ status: 'FAIL', checks, error: String(e), requests, mainPid, launchPid: app?.process().pid, root, output: page ? await page.getByTestId('connected-output').innerText().catch(() => '') : '' }, null, 2)); throw e; }
finally { if (app) await app.close().catch(() => {}); watcher?.close(); proxy.closeAllConnections(); await new Promise(r => proxy.close(r)); await child.killTree(); }
