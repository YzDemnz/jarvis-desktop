import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright';
import { externalPath, profileMetadata } from './electron44-profile-metadata.mjs';

const source = process.env.JARVIS_USER_DATA; assert.equal(source, 'E:\\CODEX\\DatosApps\\JARVIS', 'EXTERNAL_OWNER_PROFILE_REQUIRED');
const evidence = externalPath(process.env.JARVIS_MIGRATION_EVIDENCE_DIR ?? 'docs/evidence/electron44-20261011');
const before = JSON.parse(fs.readFileSync(path.join(evidence, 'owner-before.json'), 'utf8')); assert.equal(before.source, source);
const expectedVersion = process.env.JARVIS_EXPECTED_VERSION ?? JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const executablePath = externalPath(process.env.JARVIS_EXE ?? '../App instalada/JARVIS.exe');
const recordFile = path.join(evidence, 'owner-installed.json'); assert.equal(fs.existsSync(recordFile), false, 'PRESERVE_EXISTING_EVIDENCE');
const env = { ...process.env }; for (const key of ['ELECTRON_RUN_AS_NODE', 'JARVIS_ALLOW_FIXTURES', 'JARVIS_TEST_USER_DATA', 'JARVIS_BOOTSTRAP_PROVISION']) delete env[key];
const app = await _electron.launch({ executablePath, args: process.env.JARVIS_UI_SOFTWARE === '1' ? ['--disable-gpu'] : [], env, timeout: 300000 });
try {
  const page = await app.firstWindow(); await page.getByRole('button', { name: 'Home', exact: true }).waitFor({ timeout: 180000 });
  const host = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, profile: app.getPath('userData'),
    fixture: process.env.JARVIS_ALLOW_FIXTURES ?? null, temp: process.env.TEMP, electron: process.versions.electron, node: process.versions.node, abi: process.versions.modules, nodeApi: process.versions.napi,
    compiledMainSha256: process.getBuiltinModule('crypto').createHash('sha256').update(process.getBuiltinModule('fs').readFileSync(app.getAppPath()+'/dist-electron/main.js')).digest('hex') }));
  assert.equal(host.version, expectedVersion); assert.equal(host.packaged, true); assert.match(host.electron, /^44\./);
  assert.equal(host.profile, source); assert.equal(host.fixture, null); externalPath(host.temp);
  const boot = await page.evaluate(() => window.jarvis.bootstrap.inspect()), connected = await page.evaluate(() => window.jarvis.connected.refresh());
  assert.ok(['OPERATIVE', 'DEGRADED'].includes(boot.state.localHealth)); assert.ok(boot.state.receipts.length >= 4);
  assert.equal(connected.policy.allowPaidApi, false); assert.equal(connected.policy.allowPaidFallback, false);
  const metadata = profileMetadata(path.join(source, 'intelligence-fabric', 'fabric.sqlite'));
  assert.deepEqual(metadata.stats, before.stats); assert.deepEqual(metadata.tables, before.tables, 'ALL_OWNER_HISTORY_ROWS_MUST_REMAIN_IDENTICAL');
  const record = { status: 'VERIFIED_OWNER_STARTUP', test: false, host, ...metadata,
    bootstrap: { localHealth: boot.state.localHealth, candidateId: boot.state.candidateId, receipts: boot.state.receipts.length, routing: boot.state.routing },
    policy: { allowPaidApi: connected.policy.allowPaidApi, allowPaidFallback: connected.policy.allowPaidFallback },
    allTaskRowsUnchanged: true, noTestTaskSubmitted: true, modelCalls: 0, paidCalls: 0, printedNarrativeOrCredentials: false, at: new Date().toISOString() };
  fs.writeFileSync(recordFile, JSON.stringify(record, null, 2), { flag: 'wx' }); console.log('OWNER_ELECTRON44_STARTUP_PASS');
} finally { await app.close(); }
