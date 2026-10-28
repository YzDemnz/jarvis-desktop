import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawnWindowsJob } from '../electron/process/WindowsJobProcess';
import { NodeProcessPort } from '../electron/dev/nodePorts';

// Explicit implementation-time provisioning, never an automatic product fallback.
const model = process.argv[2] ?? 'smollm2:360m-instruct-q8_0';
if (!['smollm2:360m-instruct-q8_0', 'smollm2:1.7b-instruct-q4_K_M'].includes(model)) throw Error('Explicit supported official local model required');
const root = path.resolve(model.includes('1.7b') ? 'docs/evidence/s4/provision-1-7b' : 'docs/evidence/s4/provision');
fs.mkdirSync(root, { recursive: true });
if (fs.existsSync(path.join(root, 'result.json'))) throw Error('Provision evidence already exists');
const models = process.env.OLLAMA_MODELS;
if (!models || !fs.existsSync(models)) throw Error('Existing model directory required');
const original = path.join(models, 'manifests/registry.ollama.ai/library/qwen2.5/3b-instruct');
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const originalHash = hash(fs.readFileSync(original));
const reserve = net.createServer(); await new Promise<void>(r => reserve.listen(0, '127.0.0.1', r));
const port = (reserve.address() as net.AddressInfo).port; await new Promise<void>(r => reserve.close(() => r()));
const endpoint = 'http://127.0.0.1:' + port, executable = path.join(process.env.LOCALAPPDATA!, 'Programs/Ollama/ollama.exe');
const child = spawnWindowsJob({ file: executable, args: ['serve'], cwd: path.dirname(executable), env: { ...new NodeProcessPort().baseEnv(), OLLAMA_HOST: endpoint, OLLAMA_MODELS: models, OLLAMA_NO_CLOUD: '1', OLLAMA_NOPRUNE: '1' } });
let output = ''; child.onStdout(s => { output = (output + s).slice(-120000); }); child.onStderr(s => { output = (output + s).slice(-120000); });
const result: Record<string, unknown> = { model, endpoint, models, originalQwenManifestSHA256: originalHash, startedAt: new Date().toISOString(), status: 'FAIL' };
try {
  await child.ready;
  const until = Date.now() + 240000;
  while (true) {
    try { const r = await fetch(endpoint + '/api/tags', { signal: AbortSignal.timeout(5000) }); if (r.ok && (await r.json()).models?.length) break; } catch {}
    if (Date.now() > until) throw Error('Ollama startup timeout');
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('Owned Ollama ready; downloading only ' + model);
  const response = await fetch(endpoint + '/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: false }), signal: AbortSignal.timeout(600000) });
  const pulled = await response.json(); if (!response.ok || pulled.status !== 'success') throw Error('Official model pull failed');
  const manifest = path.join(models, 'manifests/registry.ollama.ai/library/smollm2', model.split(':')[1]);
  const bytes = fs.readFileSync(manifest), data = JSON.parse(bytes.toString());
  result.manifestSHA256 = hash(bytes); result.assets = [data.config, ...data.layers].map((a: any) => {
    const file = path.join(models, 'blobs', a.digest.replace(':', '-')), sha256 = hash(fs.readFileSync(file));
    if (a.digest !== 'sha256:' + sha256) throw Error('Model digest mismatch');
    return { digest: a.digest, bytes: fs.statSync(file).size, verified: true };
  });
  if (hash(fs.readFileSync(original)) !== originalHash) throw Error('Qwen manifest changed');
  result.status = 'PASS'; console.log('S4_PROVISION_PASS official model assets verified; Qwen untouched');
} catch (e) { result.error = String(e); throw e; }
finally { await child.killTree(); result.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(root, 'ollama.log'), output); fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2)); }
