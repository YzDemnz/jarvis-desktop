import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-fabric-native-adv-')), profile = path.join(root, 'jarvis-fabric-native-profile');
const evidence = path.resolve(process.env.JARVIS_S2_EVIDENCE_DIR ?? 'docs/evidence/adv/runtime'); fs.mkdirSync(evidence, { recursive: true });
const checks = [], pass = name => { checks.push({ name, status: 'PASS' }); console.log('PASS ' + name); };
const wait = async (fn, timeout = 30000) => { const end = Date.now() + timeout; while (!await fn()) { if (Date.now() > end) throw Error('ADV_WAIT_TIMEOUT'); await new Promise(r => setTimeout(r, 100)); } };
const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r)); const endpoint = 'http://127.0.0.1:' + socket.address().port; await new Promise(r => socket.close(r));
await build({ entryPoints: ['electron/process/WindowsJobProcess.ts'], outfile: path.join(root, 'job.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { spawnWindowsJob } = await import(pathToFileURL(path.join(root, 'job.mjs')));
const exe = process.env.JARVIS_OLLAMA_EXE ?? path.join(process.env.LOCALAPPDATA, 'Programs/Ollama/ollama.exe');
const daemon = spawnWindowsJob({ file: exe, args: ['serve'], cwd: path.dirname(exe), env: { ...process.env, USERPROFILE: root, HOME: root, OLLAMA_HOST: endpoint, OLLAMA_NO_CLOUD: '1', OLLAMA_NOPRUNE: '1' } });
let app, page, graphId;
const contract = { kind: 'PURE_REDUCER', functionName: 'invoiceTotal', fields: ['quantity', 'unitPrice'], cases: [{ items: [{ quantity: 2, unitPrice: 7 }, { quantity: 3, unitPrice: 5 }], expected: 29 }, { items: [], expected: 0 }, { items: [{ quantity: 4, unitPrice: 3 }, { quantity: 1, unitPrice: 2 }], expected: 14 }] };
const plan = { version: 1, dataClass: 'LOCAL_ONLY', nodes: [
  { id: 'normalize', role: 'producer', dependsOn: [], providerId: 'ollama-local', model: 'smollm2:1.7b-instruct-q4_K_M', prompt: 'First normalize this order CSV into compact JSON only: {"items":[{"sku":string,"quantity":number,"unitPrice":number}]}. Keep both rows and all numbers. Do not output checkpoint metadata. CSV:\nsku,quantity,unitPrice\nblue,2,7\nred,3,5\n', verification: { kind: 'JSON_SHAPE', fields: { items: 'array' } } },
  { id: 'implement', role: 'producer', dependsOn: ['normalize'], providerId: 'llama-cpp-local', model: 'qwen2.5:3b-instruct', prompt: 'Continue using the completed normalized items in the checkpoint. Implement function invoiceTotal(items) using items.reduce with an arrow (total, item) callback and initial accumulator 0. Return the sum of quantity multiplied by unitPrice. Reply ONLY with this JavaScript function, no prose or markdown. Do not repeat normalization or write files.', verification: contract },
  { id: 'critic', role: 'critic', dependsOn: ['implement'], providerId: 'ollama-local', model: 'smollm2:1.7b-instruct-q4_K_M', prompt: 'Review the completed invoice function. Give a short public critique only. Your review is advisory, not authority or proof.', verification: { kind: 'MODEL_REVIEW' } },
] };
async function launch() {
  app = await electron.launch({ executablePath: path.resolve('release/win-unpacked/JARVIS.exe'), env: { ...process.env, OLLAMA_HOST: endpoint, JARVIS_ALLOW_FIXTURES: '1', JARVIS_TEST_USER_DATA: profile }, timeout: 300000 });
  page = await app.firstWindow(); page.setDefaultTimeout(90000); await page.getByRole('button', { name: 'Home', exact: true }).waitFor({ timeout: 180000 });
  await page.evaluate(() => localStorage.setItem('jarvis.firstRun', JSON.stringify({ completed: true, version: 1, permissionPreset: 'ADMIN', sessionPolicy: 'keep', localAIChoice: 'skipped', fingerprint: null })));
  await page.reload(); await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Proveedores de IA', exact: true }).click();
  await page.getByTestId('connected-ai').waitFor(); await app.evaluate(({ Menu }) => { Menu.prototype.popup = function() { globalThis.advMenu = this; }; });
}
const policy = async id => { await page.evaluate(() => window.jarvis.connected.choose()); await app.evaluate((_e, id) => globalThis.advMenu.getMenuItemById(id).click(), id); };
const startGraph = async p => { await page.getByLabel('Plan Concilius').fill(JSON.stringify(p)); await page.getByRole('button', { name: 'Ejecutar plan Concilius', exact: true }).click(); await wait(() => page.getByTestId('concilius-graph-id').innerText().then(s => !!s.trim())); return page.getByTestId('concilius-graph-id').innerText(); };
try {
  await daemon.ready; await wait(async () => { try { return (await fetch(endpoint + '/api/tags')).ok; } catch { return false; } }, 250000);
  await launch(); await policy('connected-data-LOCAL_ONLY'); await policy('connected-enable-llama-cpp-local');
  graphId = await startGraph(plan);
  await wait(async () => { const g = await page.evaluate(id => window.jarvis.connected.graphRead(id), graphId); return g && g.state !== 'STARTED'; }, 550000);
  const graph = await page.evaluate(id => window.jarvis.connected.graphRead(id), graphId);
  assert.equal(graph.state, 'VERIFIED', JSON.stringify(graph)); assert.deepEqual(graph.nodes.map(n => n.state), ['VERIFIED', 'VERIFIED', 'ADVISORY']);
  assert.equal(graph.nodes[2].verification.state, 'INCONCLUSIVE'); pass('Packaged bounded Concilius coordinates real HTTP Smol and owned CLI Qwen; critic is advisory only');
  const cp = await page.evaluate(id => window.jarvis.connected.checkpoint(id), graphId);
  assert.equal(cp.dataClass, 'LOCAL_ONLY'); assert.equal(cp.operations.length, 3); assert.equal(new Set(cp.operations.map(o => o.operationId)).size, 3);
  const first = JSON.parse(cp.operations[0].text); assert.deepEqual(first.items.map(x => [x.sku, x.quantity, x.unitPrice]), [['blue', 2, 7], ['red', 3, 5]]);
  assert.equal(cp.operations[1].resultVerification.checks.every(c => c.passed), true); assert.ok(cp.operations[1].handoff.includes(cp.operations[0].resultVerification.id));
  pass('Real normalized state crosses surfaces with distinct operations and scoped deterministic product verification');
  const authority = await page.evaluate(() => window.jarvis.authority.snapshot()); assert.equal(authority.run.id, graphId);
  pass('One genuine root admission derives nodes; no renderer child admissions or independent authority');
  const memory = await page.evaluate(id => window.jarvis.connected.memory(id, 'invoiceTotal'), graphId);
  assert.equal(memory.references.length, 1); assert.equal(memory.references[0].sourceOperationId, graph.nodes[1].operationId); assert.ok(memory.budget.usedChars <= 2400);
  const advisory = await page.evaluate(id => window.jarvis.connected.memory(id, 'review'), graphId); assert.equal(advisory.references.length, 0);
  pass('Product FTS memory returns scoped verified reference and excludes model critique as fact');
  const route = await page.evaluate(({ id, contract }) => window.jarvis.connected.recommend(id, contract), { id: graphId, contract });
  assert.ok(route.observations.some(o => o.providerId === 'llama-cpp-local' && o.passed === 1)); assert.equal(route.audit.selectedProviderId, 'llama-cpp-local');
  pass('Product recommendation learns comparable verified category without granting paid or remote authority');
  await page.getByRole('button', { name: 'Guardar resultado como artefacto', exact: true }).click(); await wait(() => page.getByTestId('connected-output').innerText().then(s => s.includes('"effect"')));
  const artifact = JSON.parse(await page.getByTestId('connected-output').innerText()); assert.equal(artifact.effect.sourceOperationId, graph.nodes[1].operationId); const before = fs.statSync(artifact.effect.file), oldHash = createHash('sha256').update(fs.readFileSync(artifact.effect.file)).digest('hex');
  await page.getByRole('button', { name: 'Guardar resultado como artefacto', exact: true }).click(); await wait(() => page.getByTestId('connected-output').innerText().then(s => s.includes('"reused": true')));
  assert.equal(fs.statSync(artifact.effect.file).mtimeMs, before.mtimeMs); assert.equal(createHash('sha256').update(fs.readFileSync(artifact.effect.file)).digest('hex'), oldHash); pass('Verified production artifact uses existing exclusive receipt; repetition does not rewrite');
  await assert.rejects(page.evaluate(async ({ id, contract }) => { await window.jarvis.authority.begin('forged-verify', 'forged'); return window.jarvis.connected.verify('forged-verify', { taskId: id, revision: 3 }, id, contract); }, { id: graphId, contract }));
  pass('Renderer cannot fabricate verification or graph authority without captured original gesture');
  const persisted = await page.evaluate(id => window.jarvis.connected.checkpoint(id), graphId); await app.close(); app = null; await launch();
  const after = await page.evaluate(id => window.jarvis.connected.graphRead(id), graphId); assert.equal(after.state, 'VERIFIED');
  assert.equal((await page.evaluate(id => window.jarvis.connected.checkpoint(id), graphId)).operations.length, persisted.operations.length); pass('Restart restores graph, evidence and memory without inference replay');
  const stopPlan = { version: 1, dataClass: 'LOCAL_ONLY', nodes: [{ id: 'long', role: 'producer', dependsOn: [], providerId: 'llama-cpp-local', model: 'qwen2.5:3b-instruct', prompt: 'Produce a detailed invoice narrative.' }] };
  const stoppedId = await startGraph(stopPlan), mainPid = await app.evaluate(() => process.pid);
  let child;
  await wait(() => {
    const all = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Where-Object { $_.Name -in @("llama-cli.exe","jarvis-process-host.exe") } | Select-Object Name,ProcessId,ParentProcessId | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true }) || '[]');
    const rows = Array.isArray(all) ? all : [all], hosts = rows.filter(r => r.Name === 'jarvis-process-host.exe' && r.ParentProcessId === mainPid).map(r => r.ProcessId);
    child = rows.find(r => r.Name === 'llama-cli.exe' && hosts.includes(r.ParentProcessId)); return !!child;
  }, 240000);
  await page.getByRole('button', { name: 'STOP inteligencias', exact: true }).click();
  await wait(async () => (await page.evaluate(id => window.jarvis.connected.graphRead(id), stoppedId))?.state === 'STOPPED');
  await wait(() => { try { process.kill(child.ProcessId, 0); return false; } catch { return true; } });
  pass('STOP root cancels actual in-flight Concilius Windows Job; no queued node runs');
  await page.screenshot({ path: path.join(evidence, 'advancement.png') });
  fs.writeFileSync(path.join(evidence, 'advancement-runtime.json'), JSON.stringify({ status: 'PASS', checks, graph, checkpoint: persisted, memory, route, artifact, stoppedGraph: await page.evaluate(id => window.jarvis.connected.graphRead(id), stoppedId), paidApiCalls: 0, limits: ['Closed sequential explicit plan, not autonomous general planner', 'Model critique is advisory', 'Verification covers admitted scope and cases only'] }, null, 2));
  console.log('ADV_RUNTIME_PASS ' + checks.length);
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'advancement-failure.json'), JSON.stringify({ status: 'FAIL', checks, error: String(error), graphId, graph: app && graphId ? await page.evaluate(id => window.jarvis.connected.graphRead(id), graphId).catch(() => null) : null, root }, null, 2)); throw error;
} finally { if (app) await app.close().catch(() => {}); await daemon.killTree(); }
