import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ef1-web-'));
const hostCanary = path.join(root, 'host-outside-canary.txt'); fs.writeFileSync(hostCanary, 'HOST_CANARY_NOT_FOR_WEB_RUNTIME');
const client = path.join(root, 'webcontainer-client.mjs');
fs.copyFileSync(path.join(import.meta.dirname, 'webcontainer-client.mjs'), client);
const report = { apiVersion: '1.6.4', license: 'MIT client; commercial API terms apply',
  hostCanaryRead: null, status: 'NOT_RUN', detail: null, runtime: null };
let browser; let server;
try {
  const installed = spawnSync('npm.cmd', ['install', '--no-save', '--no-audit', '--no-fund', '@webcontainer/api@1.6.4'],
    { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 120_000, shell: true });
  if (installed.status !== 0) throw new Error(`temporary API install failed: ${String(installed.stderr || installed.stdout || installed.error).slice(-500)}`);
  await build({ entryPoints: [client], outfile: path.join(root, 'bundle.js'), bundle: true, format: 'esm', platform: 'browser',
    target: 'es2022', absWorkingDir: root, logLevel: 'silent' });
  server = http.createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(root, 'bundle.js'))); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(`<script>window.hostCanaryPath=${JSON.stringify(hostCanary)}</script><script type="module" src="/bundle.js"></script>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(); page.setDefaultTimeout(240_000);
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.ef1, null, { timeout: 30_000 });
  let timer;
  const runtime = await Promise.race([page.evaluate(() => window.ef1), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('POC timeout')), 240_000); })]);
  clearTimeout(timer);
  report.runtime = runtime; report.hostCanaryRead = runtime.hostCanaryRead;
  report.status = !runtime.error && runtime.virtualWriteRead && !runtime.hostCanaryRead && runtime.installExit === 0
    && runtime.testExit === 0 && runtime.buildExit === 0 && runtime.devReady ? 'PASS' : 'PARTIAL';
} catch (error) { report.status = 'BLOCKED'; report.detail = String(error).slice(0, 800); }
finally {
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
  const evidence = path.resolve(process.env.JARVIS_EF_EVIDENCE_DIR ?? 'docs/evidence/ef1'); fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'webcontainer-poc.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
if (report.status !== 'PASS') process.exitCode = 1;
