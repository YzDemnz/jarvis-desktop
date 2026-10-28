import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-s41-initial-'));
for (const [entry, name] of [['electron/process/WindowsJobProcess.ts', 'job'], ['electron/connected/TaskContinuity.ts', 'context']])
  await build({ entryPoints: [entry], outfile: path.join(root, name + '.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { spawnWindowsJob } = await import(pathToFileURL(path.join(root, 'job.mjs')));
const { NEW_TASK_CONTEXT } = await import(pathToFileURL(path.join(root, 'context.mjs')));
const reserve = net.createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const endpoint = 'http://127.0.0.1:' + reserve.address().port; await new Promise(r => reserve.close(r));
const file = path.join(process.env.LOCALAPPDATA, 'Programs/Ollama/ollama.exe');
const child = spawnWindowsJob({ file, args: ['serve'], cwd: path.dirname(file), env: { ...process.env, OLLAMA_HOST: endpoint, OLLAMA_MODELS: path.join(process.env.LOCALAPPDATA, 'JARVIS/runtimes/ollama-fixture-cache'), OLLAMA_NO_CLOUD: '1', OLLAMA_NOPRUNE: '1' } });
const report = { at: new Date().toISOString(), status: 'STARTED', system: NEW_TASK_CONTEXT, paidApiCalls: 0 };
try {
  await child.ready;
  const until = Date.now() + 120000;
  while (true) { try { if ((await fetch(endpoint + '/api/tags', { signal: AbortSignal.timeout(3000) })).ok) break; } catch {} if (Date.now() > until) throw Error('START_TIMEOUT'); await new Promise(r => setTimeout(r, 200)); }
  const response = await fetch(endpoint + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(85000), body: JSON.stringify({ model: 'smollm2:1.7b-instruct-q4_K_M', prompt: 'Build a small invoice calculation module. First normalize this test-owned order CSV into compact JSON only: {"items":[{"sku":string,"quantity":number,"unitPrice":number}]}. Keep both rows and all numbers. Do not output checkpoint metadata. CSV:\nsku,quantity,unitPrice\nblue,2,7\nred,3,5\n', system: NEW_TASK_CONTEXT, stream: false, options: { temperature: 0, num_predict: 128 } }) });
  if (!response.ok) throw Error('HTTP_' + response.status); const result = await response.json(); report.result = { model: result.model, response: result.response, done: result.done, done_reason: result.done_reason, prompt_eval_count: result.prompt_eval_count, eval_count: result.eval_count, total_duration: result.total_duration, load_duration: result.load_duration };
  const normalized = JSON.parse(result.response.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  assert.deepEqual([...normalized.items].sort((a,b) => a.sku.localeCompare(b.sku)), [{ sku: 'blue', quantity: 2, unitPrice: 7 }, { sku: 'red', quantity: 3, unitPrice: 5 }]);
  report.status = 'PASS'; report.verification = normalized;
} catch (error) { report.status = 'FAIL'; report.error = String(error); process.exitCode = 1; }
finally { await child.killTree(); }
const evidence = path.resolve('docs/evidence/s41/runtime-probe'); fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, 'initial-' + Date.now() + '.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
