import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { verifyInvoiceCode } from '../tests/windows/s41-invoice-verifier.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-s41-probe-'));
await build({ entryPoints: ['electron/connected/LlamaCppProvider.ts'], outfile: path.join(root, 'llama.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { executeLlama, LLAMA_MODEL } = await import(pathToFileURL(path.join(root, 'llama.mjs')));
const report = { at: new Date().toISOString(), status: 'STARTED' };
try {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 420000);
  try { report.result = await executeLlama({ taskId: 's41-probe', prompt: 'Implement function invoiceTotal(items) using items.reduce with an arrow (total, item) callback, initial accumulator 0, and return sum of quantity multiplied by unitPrice. Use the field names observed in the prior normalized items. Reply ONLY with this JavaScript function, no prose or markdown.', context: 'JARVIS structured checkpoint: completed=[{"items":[{"sku":"blue","quantity":2,"unitPrice":7},{"sku":"red","quantity":3,"unitPrice":5}]}]. No tools. Public result only.', signal: controller.signal }, 's41-probe-op', LLAMA_MODEL, () => { if (controller.signal.aborted) throw Error('STOPPED'); }); report.verification = verifyInvoiceCode(report.result.text, { items: [{ quantity: 2, unitPrice: 7 }, { quantity: 3, unitPrice: 5 }] }); report.status = 'PASS'; }
  finally { clearTimeout(timer); }
} catch (e) { report.status = 'FAIL'; report.error = e.message; process.exitCode = 1; }
const evidence = path.resolve('docs/evidence/s41/runtime-probe'); fs.mkdirSync(evidence, { recursive: true });
fs.writeFileSync(path.join(evidence, Date.now() + '.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
