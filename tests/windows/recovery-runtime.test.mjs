import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const evidence = path.resolve(process.env.JARVIS_RECOVERY_EVIDENCE_DIR ?? 'docs/evidence/recovery-20261007/smoke');
fs.mkdirSync(evidence, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-fabric-native-recovery-'));
const checks = [];
const rendererErrors = [];
let app;
try {
  app = await electron.launch({ executablePath: path.resolve(process.env.JARVIS_EXE ?? 'release/win-unpacked/JARVIS.exe'),
    env: { ...process.env, JARVIS_ALLOW_FIXTURES: '1', JARVIS_TEST_USER_DATA: profile }, timeout: 300000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(90000);
  page.on('pageerror', e => rendererErrors.push(String(e)));
  await page.getByRole('button', { name: 'Home', exact: true }).waitFor({ timeout: 180000 });
  const bridge = await page.evaluate(async () => ({ version: await window.jarvis.app.version(), platform: await window.jarvis.app.platform() }));
  assert.deepEqual(bridge, { version: '0.3.0-dev', platform: 'win32' });
  checks.push('Packaged 0.3.0 starts and connects its sandboxed renderer through preload');
  const compiler = await app.evaluate(async ({ app }) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const require = createRequire(path.join(app.getAppPath(), 'dist-electron/main.js'));
    const ts = require('typescript');
    const source = ts.createSourceFile('sample.ts', 'export const total: number = 29;', ts.ScriptTarget.Latest, true);
    return { version: ts.version, statements: source.statements.length, diagnostics: source.parseDiagnostics.length,
      compilerPath: require.resolve('typescript'), profile: app.getPath('userData') };
  });
  assert.equal(compiler.version, '5.9.3');
  assert.equal(compiler.statements, 1); assert.equal(compiler.diagnostics, 0);
  assert.ok(compiler.compilerPath.includes('app.asar') && compiler.compilerPath.includes('typescript'));
  assert.equal(path.resolve(compiler.profile), path.resolve(profile));
  checks.push('Original CommonJS TypeScript compiler loads from ASAR and parses code without an ESM __filename error');
  checks.push('Fixture isolation takes precedence over the configured persistent external profile');
  await page.evaluate(() => localStorage.setItem('jarvis.firstRun', JSON.stringify({ completed: true, version: 1, permissionPreset: 'ADMIN', sessionPolicy: 'keep', localAIChoice: 'skipped', fingerprint: null })));
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Proveedores de IA', exact: true }).click();
  await page.getByTestId('connected-ai').waitFor();
  await page.getByLabel('Plan Concilius').waitFor();
  checks.push('Latest Connected AI and Concilius controls render in the packaged app');
  const providers = await page.evaluate(() => window.jarvis.connected.snapshot());
  assert.ok(providers.providers.some(p => p.id === 'llama-cpp-local'));
  assert.equal(providers.policy.allowPaidApi, false);
  await page.screenshot({ path: path.join(evidence, 'recovery.png') });
  fs.writeFileSync(path.join(evidence, 'recovery-runtime.json'), JSON.stringify({ status: 'PASS', checks, compiler, providers, userProfileReused: false }, null, 2));
  console.log('RECOVERY_RUNTIME_PASS ' + checks.length);
} catch (error) {
  const page = app?.windows()[0];
  const diagnostics = page ? await page.evaluate(() => ({ url: location.href, state: document.readyState, body: document.body?.innerText.slice(0, 2000), bridge: !!window.jarvis })).catch(e => ({ error: String(e) })) : null;
  fs.writeFileSync(path.join(evidence, 'recovery-failure.json'), JSON.stringify({ status: 'FAIL', checks, error: String(error), rendererErrors, diagnostics }, null, 2));
  throw error;
} finally {
  if (app) await app.close();
}
