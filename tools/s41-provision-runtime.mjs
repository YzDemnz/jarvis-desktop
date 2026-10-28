import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const version = process.argv[2] ?? 'b11429';
const digests = { b11429: '1283323272b04cd07905816a597a0da810918102de958f4ff6f7bbaa70ed2efe', b6500: '73e00267e852e666a6fce2c3fb7a2603dd1934a37259f3f45c2c1b6983fa605a' };
const digest = digests[version]; if (!digest) throw Error('UNAPPROVED_RELEASE');
const qwen = ['qwen', 'qwen-cache'].includes(process.argv[3]), cache = process.argv[3] === 'qwen-cache';
const runtimeRoot = process.env.JARVIS_RUNTIME_ROOT ?? path.join(process.env.LOCALAPPDATA, 'JARVIS', 'runtimes');
if (!path.isAbsolute(runtimeRoot)) throw Error('RUNTIME_ROOT_MUST_BE_ABSOLUTE');
const base = path.join(runtimeRoot, 'llama-cpp', version);
const evidence = path.resolve(process.env.JARVIS_PROVISION_EVIDENCE_DIR ?? 'docs/evidence/s41/provision');
fs.mkdirSync(evidence, { recursive: true }); fs.mkdirSync(base, { recursive: true });
const report = { version, url: `https://github.com/ggml-org/llama.cpp/releases/download/${version}/llama-${version}-bin-win-cpu-x64.zip`, digest, base, status: 'STARTED', at: new Date().toISOString() };
const hashFile = async file => { const h = createHash('sha256'); for await (const b of fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })) h.update(b); return h.digest('hex'); };
try {
  const archive = path.join(base, 'official.zip');
  if (!fs.existsSync(archive)) {
    const r = await fetch(report.url); if (!r.ok) throw Error('DOWNLOAD_' + r.status);
    fs.writeFileSync(archive, Buffer.from(await r.arrayBuffer()), { flag: 'wx' });
  }
  if (await hashFile(archive) !== digest) throw Error('OFFICIAL_DIGEST_MISMATCH');
  const bin = path.join(base, 'bin');
  if (!fs.existsSync(bin)) {
    const quote = s => "'" + s.replaceAll("'", "''") + "'";
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath ' + quote(archive) + ' -DestinationPath ' + quote(bin)], { windowsHide: true, encoding: 'utf8' });
    if (r.status !== 0) throw Error('EXTRACT_FAILED');
  }
  const assets = [];
  const walk = async dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) await walk(f); else assets.push({ file: path.relative(bin, f), sha256: await hashFile(f) }); } };
  await walk(bin);
  const expectedModelHash = qwen ? '5ee4f07cdb9beadbbb293e85803c569b01bd37ed059d2715faa7bb405f31caa6' : 'decd2598bc2c8ed08c19adc3c8fdd461ee19ed5708679d1c54ef54a5a30d4f33';
  const sourceModel = path.join(process.env.OLLAMA_MODELS ?? 'E:\\CODEX\\Aplicaciones\\Judicial Managment Suite\\ollama-models', 'blobs', 'sha256-' + expectedModelHash);
  let model = sourceModel;
  if (cache) {
    const cacheDir = path.join(runtimeRoot, 'model-cache'); fs.mkdirSync(cacheDir, { recursive: true });
    model = path.join(cacheDir, expectedModelHash + '.gguf');
    if (!fs.existsSync(model)) {
      const staging = model + '.staging-' + Date.now();
      fs.copyFileSync(sourceModel, staging, fs.constants.COPYFILE_EXCL);
      if (await hashFile(staging) !== expectedModelHash) throw Error('CACHE_HASH_MISMATCH');
      fs.renameSync(staging, model);
    }
    report.sourceModel = sourceModel; report.cacheCopied = true;
  }
  const modelHash = await hashFile(model); if (modelHash !== expectedModelHash) throw Error('MODEL_HASH_MISMATCH');
  const runtime = { version: 1, release: version, archiveSHA256: digest, assets, model: { id: qwen ? 'qwen2.5:3b-instruct' : 'smollm2:1.7b-instruct-q4_K_M', file: model, sha256: modelHash } };
  const destination = path.join(base, cache ? 'qwen-runtime-cache.json' : qwen ? 'qwen-runtime.json' : 'runtime.json');
  if (!fs.existsSync(destination)) fs.writeFileSync(destination, JSON.stringify(runtime, null, 2), { flag: 'wx' });
  Object.assign(report, { status: 'PASS', assets, model: runtime.model });
} catch (e) { Object.assign(report, { status: 'FAIL', error: e.message }); process.exitCode = 1; }
const file = path.join(evidence, 'result-' + Date.now() + '.json'); fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
