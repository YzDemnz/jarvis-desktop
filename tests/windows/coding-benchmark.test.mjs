import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {_electron as electron} from 'playwright';
import {catalog, benchmarkRoot, externalPath, sha, materializeCases, executeChecks, fileHashes, protectedHashes, snapshotHash, changedFiles} from '../../tools/coding-benchmark-fixtures.mjs';

const repo = process.cwd(), packaged = !!process.env.JARVIS_EXE;
const productSourceCommit = process.env.JARVIS_PRODUCT_COMMIT ?? null;
if (productSourceCommit !== null) assert.match(productSourceCommit, /^[0-9a-f]{40}$/);
const label = (process.env.JARVIS_BENCHMARK_LABEL ?? (packaged ? 'packaged' : 'native')).replace(/[^a-zA-Z0-9_-]/g, '_');
const baseEvidence = externalPath(process.env.JARVIS_BENCHMARK_EVIDENCE ?? path.resolve('docs/evidence/electron44-20261011/coding-benchmark'));
fs.mkdirSync(baseEvidence, {recursive: true});
// Every run preserves a distinct evidence directory, SQLite profile and projects.
const evidence = fs.mkdtempSync(path.join(baseEvidence, label + '-'));
const profile = fs.mkdtempSync(path.join(externalPath(os.tmpdir()), 'jarvis-fabric-native-benchmark-'));
const roots = fs.mkdtempSync(path.join(externalPath(os.tmpdir()), 'jarvis-coding-benchmark-projects-'));
const provision = externalPath(process.env.JARVIS_BENCHMARK_PROVISION ?? path.resolve('../Dependencias/Caches/temp/jarvis-fabric-native-bootstrap-BRtiPm'));
const selectedIds = process.env.JARVIS_BENCHMARK_CASES?.split(',').filter(Boolean);
const selected = selectedIds ? catalog.cases.filter(c => selectedIds.includes(c.id)) : catalog.cases;
assert.ok(selected.length && (!selectedIds || selected.length === selectedIds.length), 'Unknown/empty benchmark case selection');
const cases = materializeCases(roots, selected);
const baseline = cases.map(c => ({id: c.id, name: c.name, root: c.root, criteriaHash: c.criteriaHash,
  initialSnapshotHash: c.initialSnapshotHash, protectedFiles: c.protectedFiles, initialFiles: c.initialFiles,
  sourceMetrics: c.initialFiles.filter(f => c.sourcePaths.includes(f.path)), check: executeChecks(c.root)}));
fs.writeFileSync(path.join(evidence, 'frozen-baselines.json'), JSON.stringify({at: new Date().toISOString(), modelHasRun: false,
  catalogHash: sha(fs.readFileSync(path.join(benchmarkRoot, 'cases.json'))), cases: baseline}, null, 2));
try {
  for (const c of baseline) assert.notEqual(c.check.exitCode, 0, 'Before inference, each fresh frozen baseline must really fail: ' + c.id);
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'infrastructure-failure.json'), JSON.stringify({status: 'FAIL', state: 'BLOCKED', phase: 'baseline-negativity',
    error: String(error), profile, roots, evidence, modelHasRun: false, baseline}, null, 2));
  throw error;
}

fs.mkdirSync(path.join(profile, 'intelligence-fabric'), {recursive: true});
fs.copyFileSync(path.join(provision, 'intelligence-fabric/fabric.sqlite'), path.join(profile, 'intelligence-fabric/fabric.sqlite'));
const connectedPolicy = path.join(provision, 'connected-ai/connected-policy.json');
if (fs.existsSync(connectedPolicy)) {
  fs.mkdirSync(path.join(profile, 'connected-ai'));
  fs.copyFileSync(connectedPolicy, path.join(profile, 'connected-ai/connected-policy.json'));
}
const executablePath = process.env.JARVIS_EXE ?? path.resolve('node_modules/electron/dist/electron.exe');
const diagnosticsExecutable = process.env.JARVIS_BENCHMARK_DIAGNOSTICS_EXE ?? path.resolve('node_modules/electron/dist/electron.exe');
const env = {...process.env, JARVIS_ALLOW_FIXTURES: '1', JARVIS_TEST_USER_DATA: profile,
  JARVIS_BOOTSTRAP_ROOT: path.join(provision, 'local-ai'), JARVIS_RUNTIME_ROOT: path.join(profile, 'uninstalled-runtimes'),
  OLLAMA_HOST: 'http://127.0.0.1:19877'};
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_TEST_CONTEXT;
const timeoutMs = Number(process.env.JARVIS_BENCHMARK_CASE_TIMEOUT_MS ?? 600000);
const results = [], pageErrors = [], launchAt = performance.now();
let app, page, host, phase = 'launch', activeCase = null;
const save = (filename, value) => fs.writeFileSync(path.join(evidence, filename), JSON.stringify(value, null, 2));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const progress = setInterval(() => save('progress.json', {phase, activeCase, at: new Date().toISOString(), profile, evidence,
  results: results.map(r => ({id: r.id, state: r.state, classification: r.classification, durationMs: r.durationMs}))}), 10000);
function operationRecords(ids) {
  const result = spawnSync(diagnosticsExecutable, ['tools/coding-benchmark-diagnostics.mjs', profile, ...ids],
    {env: {...env, ELECTRON_RUN_AS_NODE: '1'}, cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024});
  if (result.status !== 0) return {state: 'UNKNOWN', error: result.error?.message ?? result.stderr, records: []};
  try { return {state: 'DETECTED', ...JSON.parse(result.stdout)}; }
  catch (error) { return {state: 'UNKNOWN', error: String(error), stdout: result.stdout, records: []}; }
}
function classify(result) {
  // Home can show transcripts from earlier cases. Never classify a later case
  // from an earlier task's visible failure; own main records take precedence.
  const text = [result.error, ...result.proposals.map(p => [p.errorCode, p.error, p.metrics?.inference?.reason].filter(Boolean).join(' '))].join('\n');
  if (!result.criteriaUnchanged) return 'CRITERIA_CHANGED';
  if (result.proof?.state === 'VERIFIED' && result.independent.exitCode === 0 && result.realModelObserved && result.mainCriteriaBound) return 'VERIFIED_REPAIR';
  if (/timeout|timed out/i.test(text)) return 'TIMEOUT';
  if (/PATCH_CONTEXT_LIMIT|PROMPT_TOKEN_BUDGET|CONTEXT_(?:EMPTY|LIMIT|TRUNCATED|CAPACITY_UNVERIFIED)|NO_CONTEXT/.test(text)) return 'NO_CONTEXT';
  if (/OUTPUT_TOKEN_LIMIT/.test(text)) return 'OUTPUT_LIMIT';
  if (/PROPOSAL_OUTSIDE_PRESENTED_CONTEXT|old.?text.*(?:not found|no coincide)|PATCH_(?:REJECTED|INVALID)|parche.*(?:rechaz|no coincide)/i.test(text)) return 'PATCH_REJECTED';
  if (result.proposals.some(p => p.status === 'PRODUCED') && result.changed.length === 0) return 'NO_SOURCE_PATCH';
  if (result.proposals.length && result.proposals.every(p => p.status !== 'PRODUCED')) return 'NO_PROPOSAL';
  if (result.independent.exitCode === 0) return 'INDEPENDENT_PASS_WITHOUT_MAIN_PROOF';
  if (!result.proposals.length && /No encontré un cambio|No hay un modelo|LOCAL_PROPOSER_UNAVAILABLE/.test(text)) return 'NO_PROPOSAL';
  if (!result.proof) return 'NO_MAIN_CHECK_RECEIPT';
  return 'CHECK_FAILED';
}
async function launch() {
  app = await electron.launch({executablePath, args: packaged ? [] : [repo], env, timeout: 300000});
  page = await app.firstWindow();
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.getByRole('button', {name: 'Home', exact: true}).waitFor();
  await page.evaluate(() => localStorage.setItem('jarvis.firstRun', JSON.stringify({completed: true, version: 1,
    permissionPreset: 'FULL', sessionPolicy: 'keep', localAIChoice: 'skipped', fingerprint: null})));
  await page.reload();
  await page.getByRole('button', {name: 'Home', exact: true}).waitFor();
  host = await app.evaluate(({app}) => ({version: app.getVersion(), profile: app.getPath('userData'), packaged: app.isPackaged,
    electron: process.versions.electron, node: process.versions.node, abi: process.versions.modules,
    compiledMainSha256: process.getBuiltinModule('crypto').createHash('sha256').update(process.getBuiltinModule('fs').readFileSync(app.getAppPath()+'/dist-electron/main.js')).digest('hex')}));
  assert.equal(path.resolve(host.profile), path.resolve(profile), 'Native runs must use only the benchmark profile');
}
async function admit(goal) {
  await page.getByRole('button', {name: 'Home', exact: true}).click();
  const previous = await page.evaluate(() => window.jarvis.authority.snapshot());
  await page.locator('[data-authority-home-input]').fill(goal);
  await page.locator('[data-authority-home-send]').click();
  for (let i = 0; i < 150; i++) {
    const state = await page.evaluate(() => window.jarvis.authority.snapshot());
    if (state.activeRun && state.activeRun !== previous.activeRun) {
      assert.equal(state.run?.source, 'USER_INPUT_GESTURE');
      return state.activeRun;
    }
    await pause(100);
  }
  throw Error('BENCHMARK_REAL_HOME_GESTURE_NOT_ADMITTED');
}
async function settled(id) {
  // Allow renderer state to reach the real task; activeRun is retained after completion.
  await pause(400);
  await page.getByTestId('stop-agent').waitFor({state: 'hidden', timeout: timeoutMs});
  assert.equal((await page.evaluate(() => window.jarvis.authority.snapshot())).activeRun, id);
}
try {
  await launch();
  phase = 'local-health';
  const boot = await page.evaluate(() => window.jarvis.bootstrap.inspect());
  assert.equal(boot.state.localHealth, 'OPERATIVE');
  assert.equal(boot.state.candidateId, 'qwen3-4b-gguf');
  const connected = await page.evaluate(() => window.jarvis.connected.refresh());
  assert.equal(connected.policy.allowPaidApi, false);
  save('host.json', {host, bootState: boot.state, paidApiPolicy: false, setupDurationMs: Math.round(performance.now() - launchAt),
    profile, provision, roots, externalOnly: true, ownerProfileTouched: false, modelUsedForSetup: false});
  await page.getByRole('button', {name: 'Projects', exact: true}).click();
  await page.getByTestId('root-input').fill(roots);
  await page.getByRole('button', {name: 'Añadir root', exact: true}).click();
  for (const c of cases) await page.getByTestId('project-row').filter({hasText: c.name}).waitFor();
  for (const c of cases) {
    phase = 'infer-' + c.id; activeCase = c.id;
    const started = performance.now();
    let id = null, error = null;
    try { id = await admit(c.goal); await settled(id); }
    catch (failure) {
      error = String(failure);
      // Stop only the benchmark-owned admitted run if a bounded wait failed.
      if (id && await page.getByTestId('stop-agent').isVisible().catch(() => false)) {
        await page.getByTestId('stop-agent').click({force: true}).catch(() => {});
        await pause(1000);
      }
    }
    phase = 'observe-' + c.id;
    const durationMs = Math.round(performance.now() - started);
    const body = await page.locator('body').innerText().catch(() => null);
    const proof = id ? await page.evaluate(id => window.jarvis.dev.checkEvidence(id), id).catch(e => ({state: 'UNKNOWN', error: String(e)})) : null;
    const ops = id ? operationRecords([id]) : {state: 'UNKNOWN', records: [], error: 'No admitted run'};
    const proposals = ops.records.filter(p => p.kind === 'LOCAL_PATCH_PROPOSAL');
    const independent = executeChecks(c.root);
    const afterProtected = protectedHashes(c.root);
    const criteriaUnchanged = snapshotHash(afterProtected) === c.criteriaHash;
    const mainCriteriaBound = !!proof?.protectedFiles && c.protectedFiles.every(f => proof.protectedFiles.some(p => p.path === f.path && p.hash === f.sha256));
    const changed = changedFiles(c.root, c.initialFiles);
    const realModelObserved = proposals.some(p => p.status === 'PRODUCED' && p.identity?.providerId === 'bootstrap-local' && p.identity?.model === 'qwen3-4b-gguf');
    const partialInferenceObserved = proposals.some(p => p.identity?.providerId === 'bootstrap-local' && p.identity?.model === 'qwen3-4b-gguf'
      && typeof p.metrics?.inference?.firstTokenMs === 'number');
    const result = {id: c.id, name: c.name, taskId: id, state: 'TESTED', root: c.root, goal: c.goal, durationMs,
      error, proof, proposals, operationDiagnostics: ops.state, operationDiagnosticsError: ops.error ?? null,
      independent, criteriaHash: c.criteriaHash, criteriaUnchanged, mainCriteriaBound, realModelObserved, partialInferenceObserved,
      changed, beforeFiles: c.initialFiles, afterFiles: fileHashes(c.root), body,
      contextObservation: proposals.some(p => p.metrics || p.contextMetrics) ? 'DETECTED — see main proposal metrics' : 'UNKNOWN — no main context metrics were recorded',
      limits: 'At most the product coding delegate repair budget; fixed owned tests and manifests. No baseline/reference answer injected into model prompts.'};
    result.classification = classify(result);
    if (result.classification === 'VERIFIED_REPAIR') result.state = 'VERIFIED';
    else if (error && !id) result.state = 'BLOCKED';
    results.push(result);
    save(c.id + '-result.json', result);
    if (result.state !== 'VERIFIED') save(c.id + '-failure.json', result);
    await page.screenshot({path: path.join(evidence, c.id + '.png')}).catch(() => {});
    console.log('CODING_BENCHMARK_CASE ' + c.id + ' ' + result.classification + ' ' + durationMs + 'ms');
    if (error && /Target.*closed|Page.*closed|Browser.*closed/i.test(error)) break;
  }
  phase = 'report';
  const verified = results.filter(r => r.state === 'VERIFIED').length;
  const complete = results.length === cases.length;
  const report = {status: complete ? 'COMPLETED' : 'INCOMPLETE', state: 'TESTED', at: new Date().toISOString(), label,
    host, productSourceCommit, caseTimeoutMs: timeoutMs, profile, roots, provision, evidence, cases: cases.length, completedCases: results.length, verified,
    failedOrUnverified: results.length - verified, paidCalls: 0, ownerProfileTouched: false,
    totalDurationMs: Math.round(performance.now() - launchAt), realInference: 'Only confirmed per-case by main proposal identity, not inferred from local health',
    criteriaAuthor: catalog.criteriaAuthor, scope: catalog.scope, pageErrors,
    results: results.map(({body, ...r}) => r),
    conclusion: verified === cases.length ? 'All three bounded curated cases passed with unchanged criteria and native main receipts; not general programming autonomy.'
      : 'The benchmark finished with retained failures. Compare main proposal context/timing and actual command receipts before choosing a model, context or architecture investment.'};
  save('result.json', report);
  console.log('CODING_BENCHMARK_COMPLETED ' + verified + '/' + cases.length + ' VERIFIED | ' + evidence);
  if (!complete || (process.env.JARVIS_BENCHMARK_EXPECT_PASS === '1' && verified !== cases.length)) process.exitCode = 1;
} catch (error) {
  save('infrastructure-failure.json', {status: 'FAIL', state: 'BLOCKED', phase, activeCase, error: String(error), profile, roots, evidence,
    host, pageErrors, results, body: page ? await page.locator('body').innerText().catch(() => null) : null});
  throw error;
} finally { clearInterval(progress); if (app) await app.close(); }
