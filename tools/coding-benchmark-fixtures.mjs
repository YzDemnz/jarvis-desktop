import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const benchmarkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tests/benchmarks/coding');
export const catalog = JSON.parse(fs.readFileSync(path.join(benchmarkRoot, 'cases.json'), 'utf8'));
export const sha = data => createHash('sha256').update(data).digest('hex');
export const externalPath = value => {
  const resolved = path.resolve(value);
  if (!resolved.toLowerCase().startsWith('e:\\codex\\')) throw new Error('BENCHMARK_EXTERNAL_PATH_REQUIRED: ' + resolved);
  return resolved;
};
export function fileHashes(root) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('BENCHMARK_SYMLINK_REFUSED');
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push({path: path.relative(root, absolute).replaceAll('\\', '/'), sha256: sha(fs.readFileSync(absolute)), bytes: fs.statSync(absolute).size});
    }
  }
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export const protectedHashes = root => fileHashes(root).filter(f => f.path === 'package.json' || f.path.startsWith('tests/'));
export const snapshotHash = files => sha(JSON.stringify(files.map(({path, sha256}) => ({path, sha256}))));
export function materializeCases(base, selected = catalog.cases) {
  externalPath(base);
  fs.mkdirSync(base, {recursive: true});
  return selected.map(spec => {
    const root = path.join(base, spec.name);
    // Never reset, delete or overwrite a previous attempt.
    fs.mkdirSync(root);
    const seed = path.join(benchmarkRoot, spec.id, 'project');
    for (const entry of fileHashes(seed)) {
      const dest = path.join(root, entry.path);
      fs.mkdirSync(path.dirname(dest), {recursive: true});
      fs.copyFileSync(path.join(seed, entry.path), dest, fs.constants.COPYFILE_EXCL);
    }
    const criteria = {benchmarkVersion: catalog.version, id: spec.id, name: spec.name, problem: spec.problem,
      goal: spec.goal, dimensions: spec.dimensions, sourcePaths: spec.sourcePaths,
      expectedMinimumAssertions: spec.expectedMinimumAssertions, author: catalog.criteriaAuthor, scope: catalog.scope};
    fs.writeFileSync(path.join(root, 'tests/criteria.json'), JSON.stringify(criteria, null, 2) + '\n', {flag: 'wx'});
    const initialFiles = fileHashes(root), fixed = protectedHashes(root);
    return {...spec, root, initialFiles, protectedFiles: fixed, criteriaHash: snapshotHash(fixed), initialSnapshotHash: snapshotHash(initialFiles)};
  });
}
export function executeChecks(root) {
  const tests = fileHashes(root).filter(f => /\.test\.cjs$/.test(f.path)).map(f => f.path);
  const start = performance.now();
  const env = {...process.env};
  // A parent `node --test` sets this private runner channel marker. Inheriting
  // it makes an independent child emit runner IPC instead of running a CLI test
  // report; Node can then exit 0 with no executed baseline. Never inherit it.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', ...tests], {cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024});
  return {runner: 'INDEPENDENT_NODE_REFERENCE_TESTS', executable: process.execPath, args: ['--test', ...tests],
    exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
    stdout: result.stdout ?? '', stderr: result.stderr ?? '', durationMs: Math.round(performance.now() - start)};
}
export function changedFiles(root, initialFiles) {
  const before = new Map(initialFiles.map(f => [f.path, f.sha256]));
  const after = new Map(fileHashes(root).map(f => [f.path, f.sha256]));
  return [...new Set([...before.keys(), ...after.keys()])].filter(p => before.get(p) !== after.get(p)).sort();
}
function referenceFixes(spec) {
  const fixes = JSON.parse(fs.readFileSync(path.join(benchmarkRoot, spec.id, 'reference-fixes.json'), 'utf8'));
  for (const [relative, edits] of Object.entries(fixes)) {
    assert.ok(spec.sourcePaths.includes(relative), 'Reference may edit source only');
    const filename = path.join(spec.root, relative);
    let content = fs.readFileSync(filename, 'utf8');
    for (const {oldText, newText, all} of edits) {
      assert.ok(content.includes(oldText), 'Reference edit must match frozen source');
      content = all ? content.replaceAll(oldText, newText) : content.replace(oldText, newText);
    }
    fs.writeFileSync(filename, content);
  }
}
export function validateFixtures(outputDirectory) {
  const evidence = externalPath(outputDirectory);
  fs.mkdirSync(evidence, {recursive: true});
  const roots = fs.mkdtempSync(path.join(externalPath(os.tmpdir()), 'jarvis-coding-benchmark-validation-'));
  const results = [];
  for (const spec of materializeCases(roots)) {
    const baseline = executeChecks(spec.root);
    assert.notEqual(baseline.exitCode, 0, 'Frozen negative baseline must actually fail: ' + spec.id);
    referenceFixes(spec);
    const reference = executeChecks(spec.root);
    assert.equal(reference.exitCode, 0, 'Independent reference must pass the same frozen tests: ' + spec.id + '\n' + reference.stdout + reference.stderr);
    const referenceChanges = changedFiles(spec.root, spec.initialFiles);
    assert.deepEqual(protectedHashes(spec.root), spec.protectedFiles, 'Criteria must not change for reference fixes');
    const mutation = spec.regressionMutation, target = path.join(spec.root, mutation.path);
    const content = fs.readFileSync(target, 'utf8');
    assert.ok(content.includes(mutation.oldText));
    fs.writeFileSync(target, content.replace(mutation.oldText, mutation.newText));
    const regression = executeChecks(spec.root);
    assert.notEqual(regression.exitCode, 0, 'Frozen tests must detect a separate regression: ' + spec.id);
    const result = {id: spec.id, name: spec.name, root: spec.root, state: 'TESTED', baseline, reference, referenceChanges,
      regression, criteriaHash: spec.criteriaHash, protectedFiles: spec.protectedFiles,
      inference: 'NONE — fixture author/reference validation, not a model result', sourceFileCount: spec.sourcePaths.length};
    results.push(result);
    fs.writeFileSync(path.join(evidence, spec.id + '-validation.json'), JSON.stringify(result, null, 2));
  }
  const report = {status: 'PASS', at: new Date().toISOString(), roots, criteriaCatalogHash: sha(fs.readFileSync(path.join(benchmarkRoot, 'cases.json'))),
    scope: catalog.scope, modelUsed: false, paidCalls: 0, resultCount: results.length, results};
  fs.writeFileSync(path.join(evidence, 'fixture-validation.json'), JSON.stringify(report, null, 2));
  return report;
}
if (process.argv.includes('--validate')) {
  const directory = process.env.JARVIS_BENCHMARK_EVIDENCE ?? path.resolve('docs/evidence/electron44-20261011/coding-fixtures');
  const report = validateFixtures(directory);
  console.log('CODING_BENCHMARK_FIXTURES_PASS ' + report.resultCount + ' | Baseline failures + same-criteria reference passes + regression failures; no model inference');
}
