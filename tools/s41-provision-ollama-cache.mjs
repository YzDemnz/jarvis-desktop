import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
// Explicit local-only provision for owned fixtures. Never changes user/global
// environment, downloads/pulls, source models, or the existing Ollama service.
const source = 'E:\\Judicial Managment Suite\\ollama-models';
const base = path.join(process.env.LOCALAPPDATA, 'JARVIS/runtimes/ollama-fixture-cache');
const evidence = path.resolve('docs/evidence/s41/provision'); fs.mkdirSync(evidence, { recursive: true });
const hash = b => createHash('sha256').update(b).digest('hex');
const hashFile = async file => { const h = createHash('sha256'); for await (const b of fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })) h.update(b); return h.digest('hex'); };
const specs = [
  ['qwen2.5/3b-instruct', '357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b'],
  ['smollm2/1.7b-instruct-q4_K_M', '8ea75f835db9a9b29bb19d2740ea8217e3027e687e5f66b42fd44ff9cbaa4cb9'],
];
const report = { at: new Date().toISOString(), status: 'STARTED', source, base, networkCalls: 0, assets: [], manifests: [], userConfigurationChanged: false };
try {
  for (const [relative, pin] of specs) {
    const rel = 'manifests/registry.ollama.ai/library/' + relative, original = path.join(source, rel), bytes = fs.readFileSync(original);
    if (hash(bytes) !== pin) throw Error('ORIGINAL_MANIFEST_CHANGED');
    const manifest = JSON.parse(bytes);
    for (const asset of [manifest.config, ...manifest.layers]) {
      if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw Error('INVALID_DIGEST');
      const sha256 = asset.digest.slice(7), from = path.join(source, 'blobs', asset.digest.replace(':', '-')), file = path.join(base, 'blobs', asset.digest.replace(':', '-'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!fs.existsSync(file)) {
        const shared = path.join(process.env.LOCALAPPDATA, 'JARVIS/runtimes/model-cache', sha256 + '.gguf');
        if (fs.existsSync(shared) && await hashFile(shared) === sha256) fs.linkSync(shared, file);
        else {
          const staging = file + '.staging-' + Date.now();
          fs.copyFileSync(from, staging, fs.constants.COPYFILE_EXCL);
          if (await hashFile(staging) !== sha256) throw Error('COPIED_ASSET_CHANGED');
          fs.renameSync(staging, file);
        }
      }
      if (await hashFile(file) !== sha256) throw Error('CACHE_ASSET_CHANGED');
      report.assets.push({ file, source: from, sha256, bytes: fs.statSync(file).size });
    }
    const destination = path.join(base, rel); fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes, { flag: 'wx' });
    if (hash(fs.readFileSync(destination)) !== pin) throw Error('CACHE_MANIFEST_CHANGED');
    report.manifests.push({ file: destination, source: original, sha256: pin });
  }
  report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.error = String(error); process.exitCode = 1; }
fs.writeFileSync(path.join(evidence, 'ollama-cache-' + Date.now() + '.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
