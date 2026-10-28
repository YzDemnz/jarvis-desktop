import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const normalize = value => String(value).replaceAll('\\', '/').replace(/^\.\//, '');
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const sorted = values => [...new Set(values.filter(Boolean))].sort();
const median = values => { const numbers = values.filter(n => n !== null).sort((a, b) => a - b); if (!numbers.length) return null; const i = Math.floor(numbers.length / 2); return numbers.length % 2 ? numbers[i] : (numbers[i - 1] + numbers[i]) / 2; };
const count = (values, key) => values.reduce((out, value) => ({...out, [key(value)]: (out[key(value)] ?? 0) + 1}), {});
const toPaths = value => Array.isArray(value) ? sorted(value.map(file => typeof file === 'string' ? normalize(file) : typeof file?.path === 'string' ? normalize(file.path) : null)) : null;
const metadataOf = proposal => proposal.metrics ?? proposal.contextMetrics ?? null;
const identities = result => sorted((result.proposals ?? []).map(p => p.identity ? `${p.identity.providerId}/${p.identity.model ?? 'UNKNOWN'}` : null));
function fileSet(metrics, direction) {
  if (!metrics) return null;
  const possible = direction === 'received'
    ? [metrics.receivedFiles, metrics.inputFiles, metrics.context?.receivedFiles, metrics.received?.files]
    : [metrics.selectedFiles, metrics.sentFiles, metrics.presentedFiles, metrics.context?.selectedFiles, metrics.selected?.files];
  for (const value of possible) { const paths = toPaths(value); if (paths !== null) return paths; }
  return null;
}
function sourceMatch(source, presented) {
  return presented.some(candidate => candidate === source || candidate.endsWith('/' + source));
}
function selectedDescriptors(metrics) {
  const values = [metrics.selectedFiles, metrics.sentFiles, metrics.presentedFiles, metrics.context?.selectedFiles, metrics.selected?.files];
  return values.find(Array.isArray) ?? [];
}
export function inspectCase(result) {
  const proposals = result.proposals ?? [];
  const metrics = proposals.map(metadataOf).filter(Boolean);
  const sources = sorted((result.beforeFiles ?? []).map(f => normalize(f.path)).filter(p => p.startsWith('src/')));
  const receivedSets = metrics.map(m => fileSet(m, 'received')).filter(files => files !== null);
  const sentSets = metrics.map(m => fileSet(m, 'selected')).filter(files => files !== null);
  const received = receivedSets.length ? sorted(receivedSets.flat()) : null;
  const presented = sentSets.length ? sorted(sentSets.flat()) : null;
  const unavailableForRetrieval = received && sources.length ? sources.filter(s => !sourceMatch(s, received)) : null;
  const excludedAfterRetrieval = received && presented ? received.filter(s => !sourceMatch(s, presented)) : null;
  const sourceNotPresented = presented && sources.length ? sources.filter(s => !sourceMatch(s, presented)) : null;
  const descriptors = metrics.flatMap(selectedDescriptors).filter(file => file && typeof file === 'object' && typeof file.path === 'string');
  const completeSourceFilesObserved = !!sources.length && sources.every(source => descriptors.some(file => file.complete === true && sourceMatch(source, [normalize(file.path)])));
  const metadataResponse = proposals.some(p => { const m = metadataOf(p); return p.identity && m && finite(m.outputChars ?? m.responseChars ?? m.outputBytes) > 0; });
  const realModel = result.realModelObserved === true || metadataResponse;
  const productionFixture = /owned|curated|fixture/i.test(result.limits ?? '');
  const proofComplete = result.proof?.state === 'VERIFIED' && result.criteriaUnchanged === true && result.mainCriteriaBound === true
    && result.independent?.exitCode === 0 && realModel;
  const claimedVerified = result.state === 'VERIFIED' || result.classification === 'VERIFIED_REPAIR';
  const evidenceErrorCodes = proposals.flatMap(p => [p.errorCode, p.error, metadataOf(p)?.inference?.reason]).filter(v => typeof v === 'string');
  // Older drivers classified a timed-out model as NO_PROPOSAL. Preserve that
  // label alongside a classification derived from this task's recorded cause.
  const classification = !proofComplete && evidenceErrorCodes.some(code => /TIMEOUT|timed out/i.test(code)) ? 'TIMEOUT'
    : !proofComplete && evidenceErrorCodes.some(code => /PATCH_CONTEXT_LIMIT|CONTEXT_(?:EMPTY|LIMIT)|NO_CONTEXT/.test(code)) ? 'NO_CONTEXT'
      : result.classification ?? 'UNKNOWN';
  const bucket = proofComplete ? 'VERIFIED' : classification === 'TIMEOUT' ? 'TIMEOUT'
    : result.state === 'BLOCKED' || (!result.proof && result.error) ? 'BLOCKED'
    : ['CHECK_FAILED', 'CRITERIA_CHANGED', 'PATCH_REJECTED', 'NO_SOURCE_PATCH', 'NO_PROPOSAL', 'NO_CONTEXT', 'OUTPUT_LIMIT'].includes(classification) ? 'FAILED' : 'NOT_VERIFIED';
  return {id: result.id, bucket, classification, originalClassification: result.classification ?? 'UNKNOWN', evidenceErrorCodes, claimedVerified, evidenceComplete: proofComplete,
    correctnessClaim: proofComplete ? 'VERIFIED only against the frozen owned case and main snapshot' : 'No complete verification claim',
    subject: productionFixture ? 'CURATED_FIXTURE' : 'UNKNOWN', intelligence: realModel ? 'REAL_MODEL_OBSERVED_IN_MAIN_METADATA' : 'UNKNOWN',
    identities: identities(result), criteriaHash: result.criteriaHash ?? null, criteriaUnchanged: result.criteriaUnchanged ?? null,
    mainCriteriaBound: result.mainCriteriaBound ?? null, independentExitCode: result.independent?.exitCode ?? null,
    caseDurationMs: finite(result.durationMs), proposalDurationMs: metrics.map(m => finite(m.durationMs ?? m.totalDurationMs)).filter(n => n !== null),
    metricsState: metrics.length ? 'DETECTED' : 'UNKNOWN',
    sourceFiles: sources, receivedFiles: received, presentedFiles: presented,
    unavailableForRetrieval, excludedAfterRetrieval, sourceNotPresented, completeSourceFilesObserved,
    proposalCount: proposals.length, producedProposals: proposals.filter(p => p.status === 'PRODUCED').length,
    changed: result.changed ?? [],
    parameters: metrics.map(m => m.policy ?? m.contextPolicy ?? m.parameters ?? null).filter(Boolean),
    // Raw metadata is already recorded by main; it contains measurements, not source text.
    recordedMetadata: metrics};
}
function snapshot(report) {
  const results = (report.results ?? []).map(inspectCase);
  return {label: report.label ?? null, state: report.state ?? 'UNKNOWN', completion: report.status ?? 'UNKNOWN',
    scope: report.scope ?? 'UNKNOWN', host: report.host ?? null, paidCalls: report.paidCalls ?? 'UNKNOWN',
    ownerProfileTouched: report.ownerProfileTouched ?? 'UNKNOWN', totalDurationMs: finite(report.totalDurationMs),
    count: results.length, buckets: count(results, r => r.bucket), classifications: count(results, r => r.classification),
    claimedVerified: results.filter(r => r.claimedVerified).length, evidencedVerified: results.filter(r => r.evidenceComplete).length,
    metadataCases: results.filter(r => r.metricsState === 'DETECTED').length,
    medianCaseDurationMs: median(results.map(r => r.caseDurationMs)),
    medianProposalDurationMs: median(results.flatMap(r => r.proposalDurationMs)), results};
}
function hostDifferences(before, after) {
  return ['version', 'electron', 'node', 'abi', 'packaged'].flatMap(field => {
    const left = before?.[field], right = after?.[field];
    return left !== undefined && right !== undefined && left !== right ? [{field, before: left, after: right}] : [];
  });
}
export function compareReports(before, after) {
  const left = snapshot(before), right = snapshot(after), beforeById = new Map(left.results.map(r => [r.id, r]));
  const comparisons = right.results.map(r => {
    const l = beforeById.get(r.id);
    const criteria = !l || !l.criteriaHash || !r.criteriaHash ? 'UNKNOWN' : l.criteriaHash === r.criteriaHash ? 'MATCH' : 'CHANGED';
    return {id: r.id, criteria, beforeHash: l?.criteriaHash ?? null, afterHash: r.criteriaHash,
      before: l?.bucket ?? 'MISSING', after: r.bucket, beforeClassification: l?.classification ?? 'UNKNOWN', afterClassification: r.classification,
      qualityDeltaAdmissible: criteria === 'MATCH', improvement: criteria === 'MATCH' && l?.bucket !== 'VERIFIED' && r.bucket === 'VERIFIED',
      regression: criteria === 'MATCH' && l?.bucket === 'VERIFIED' && r.bucket !== 'VERIFIED',
      identityComparison: !l?.identities.length || !r.identities.length ? 'UNKNOWN' : JSON.stringify(l.identities) === JSON.stringify(r.identities) ? 'SAME_RECORDED_IDENTITIES' : 'CHANGED',
      parameterComparison: !l?.parameters.length || !r.parameters.length ? 'UNKNOWN' : JSON.stringify(l.parameters) === JSON.stringify(r.parameters) ? 'SAME_RECORDED_PARAMETERS' : 'CHANGED',
      caseDurationDeltaMs: l?.caseDurationMs !== null && l?.caseDurationMs !== undefined && r.caseDurationMs !== null ? r.caseDurationMs - l.caseDurationMs : null,
      sourceNotPresentedBefore: l?.sourceNotPresented ?? null, sourceNotPresentedAfter: r.sourceNotPresented};
  });
  const matching = comparisons.filter(c => c.criteria === 'MATCH');
  const changedCriteria = comparisons.filter(c => c.criteria === 'CHANGED').map(c => c.id);
  const removed = left.results.filter(l => !right.results.some(r => r.id === l.id)).map(l => l.id);
  const measured = [...left.results, ...right.results];
  const gaps = measured.filter(r => r.sourceNotPresented?.length).map(r => ({id: r.id, sourceNotPresented: r.sourceNotPresented}));
  const retrievalGaps = measured.filter(r => r.unavailableForRetrieval?.length).map(r => ({id: r.id, files: r.unavailableForRetrieval}));
  const boundedAway = measured.filter(r => r.excludedAfterRetrieval?.length).map(r => ({id: r.id, files: r.excludedAfterRetrieval}));
  const contextErrors = measured.filter(r => r.classification === 'NO_CONTEXT').map(r => r.id);
  const sameModelRecovered = comparisons.filter(c => c.improvement && c.identityComparison === 'SAME_RECORDED_IDENTITIES');
  const contextRecovered = sameModelRecovered.filter(c => c.sourceNotPresentedBefore?.length && c.sourceNotPresentedAfter?.length === 0);
  const qualityFailures = right.results.filter(r => r.bucket === 'FAILED' && r.intelligence !== 'UNKNOWN'
    && r.sourceNotPresented?.length === 0 && r.completeSourceFilesObserved && r.receivedFiles !== null && r.producedProposals > 0 && r.changed.length > 0);
  const timeouts = measured.filter(r => r.bucket === 'TIMEOUT').map(r => r.id);
  const timingCount = measured.filter(r => r.proposalDurationMs.length).length;
  const architecturalChanges = hostDifferences(before.host, after.host);
  const bothModels = sorted(measured.flatMap(r => r.identities));
  const hypotheses = {
    context: {state: contextRecovered.length ? 'SUPPORTED_BY_BOUNDED_COMPARISON' : contextErrors.length || boundedAway.length ? 'DETECTED_CONSTRAINT' : gaps.length ? 'DETECTED_COVERAGE_GAP' : measured.some(r => r.presentedFiles !== null) ? 'NO_RECORDED_GAP_IN_THIS_SAMPLE' : 'UNKNOWN',
      evidence: {contextErrors, excludedAfterRetrieval: boundedAway, sourceCoverageGaps: gaps, sameModelRecovered: contextRecovered.map(c => c.id)},
      limit: 'A source coverage gap is not proof that every omitted source was necessary. One run does not isolate stochastic model behavior or unrecorded environment changes.'},
    retrieval: {state: retrievalGaps.length ? 'DETECTED_GAP' : measured.some(r => r.receivedFiles !== null) ? 'NO_RECORDED_GAP_IN_THIS_SAMPLE' : 'UNKNOWN', evidence: retrievalGaps,
      limit: 'Known source files absent from main input may indicate renderer retrieval or a deliberate relevance choice; relevance quality needs a targeted counterfactual.'},
    model: {state: qualityFailures.length ? 'BOUNDED_PATCH_QUALITY_INSUFFICIENT' : right.results.every(r => r.bucket === 'VERIFIED') && right.results.length ? 'SUFFICIENT_FOR_THIS_SAMPLE' : 'UNKNOWN',
      evidence: {failedDespiteRecordedCompleteSourceFiles: qualityFailures.map(r => r.id), recordedIdentities: bothModels, sameModelRecovered: sameModelRecovered.map(c => c.id)},
      limit: 'Passing or failing three curated cases does not establish general model quality. Complete source coverage does not prove semantic context sufficiency or separate model quality from the agent loop.'},
    performance: {state: timeouts.length ? 'DETECTED_TIMEOUTS' : timingCount ? 'MEASURED_PROPOSAL_WALL_TIME' : 'UNKNOWN',
      evidence: {timeouts, beforeMedianProposalMs: left.medianProposalDurationMs, afterMedianProposalMs: right.medianProposalDurationMs, timingCases: timingCount},
      limit: 'Wall time may include model loading, hashing and inference. Without phase timings/tokens per second it cannot justify a GPU purchase or prove model inference is the bottleneck.'},
    externalSpecialist: {state: 'UNKNOWN',
      limit: bothModels.length <= 1 ? 'Only one recorded model; no supported external specialist comparison was measured.' : 'Different identities alone do not isolate local versus external quality. Check equal criteria, context, authority and cost policy before a comparative run.'}
  };
  const nextMeasurement = changedCriteria.length
    ? 'Repeat against identical frozen criteria before interpreting a quality delta.'
    : contextErrors.length || boundedAway.length || retrievalGaps.length
      ? 'Test a bounded context/retrieval improvement with the same model and fixed criteria before changing model or adding an external specialist.'
      : qualityFailures.length
        ? 'Test a replaceable model against the same frozen cases/context and existing sovereign verifier; avoid changing orchestration and model simultaneously.'
        : timeouts.length
          ? 'Measure load/hash/generation phases and bounded timeout behavior before selecting hardware.'
          : 'Expand the frozen benchmark beyond these curated domains; current evidence does not justify a general autonomy or provider investment claim.';
  return {kind: 'CODING_BENCHMARK_COMPARISON', version: 1, state: 'TESTED', before: left, after: right,
    criteriaComparability: changedCriteria.length ? 'INVALID_FOR_AGGREGATE_QUALITY_DELTA' : matching.length && matching.length === left.results.length && matching.length === right.results.length ? 'MATCHED_CASES' : 'PARTIAL_OR_UNKNOWN',
    changedCriteria, removedCases: removed, comparisons,
    admissibleQualityDelta: {matchingCases: matching.length, verifiedBefore: matching.filter(c => c.before === 'VERIFIED').length,
      verifiedAfter: matching.filter(c => c.after === 'VERIFIED').length, improvements: matching.filter(c => c.improvement).map(c => c.id), regressions: matching.filter(c => c.regression).map(c => c.id)},
    observedArchitecturalChanges: architecturalChanges, hypotheses, nextMeasurement,
    limitation: 'Pure comparison of saved evidence, no models or commands executed. Fixture correctness and real intelligence are separate claims. Correlation is not a causal diagnosis; missing measurements remain UNKNOWN.'};
}
function external(value) {
  const resolved = path.resolve(value);
  if (!resolved.toLowerCase().startsWith('e:\\codex\\')) throw Error('EXTERNAL_BENCHMARK_PATH_REQUIRED');
  return resolved;
}
function resolveReport(argument) {
  const direct = path.resolve(argument);
  if (fs.existsSync(direct)) return external(fs.statSync(direct).isDirectory() ? path.join(direct, 'result.json') : direct);
  if (!/^[\w-]+$/.test(argument)) throw Error('REPORT_PATH_OR_SAFE_LABEL_REQUIRED');
  const base = external(process.env.JARVIS_BENCHMARK_EVIDENCE ?? path.resolve('docs/evidence/electron44-20261011/coding-benchmark'));
  const matches = fs.readdirSync(base, {withFileTypes: true}).filter(entry => entry.isDirectory() && entry.name.startsWith(argument + '-'))
    .map(entry => path.join(base, entry.name, 'result.json')).filter(file => fs.existsSync(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs || a.localeCompare(b));
  if (!matches.length) throw Error('REPORT_LABEL_NOT_FOUND: ' + argument);
  return matches[0];
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), outputIndex = args.indexOf('--output');
  const output = outputIndex >= 0 ? args.splice(outputIndex, 2)[1] : null;
  if (args.length !== 2 || (outputIndex >= 0 && !output)) throw Error('Usage: node tools/coding-benchmark-compare.mjs before-result-or-label after-result-or-label [--output E:\\CODEX\\...\\comparison.json]');
  const beforePath = resolveReport(args[0]), afterPath = resolveReport(args[1]);
  const comparison = {...compareReports(JSON.parse(fs.readFileSync(beforePath, 'utf8')), JSON.parse(fs.readFileSync(afterPath, 'utf8'))),
    inputs: {beforePath, afterPath}, comparedAt: new Date().toISOString()};
  if (output) { const filename = external(output); fs.mkdirSync(path.dirname(filename), {recursive: true}); fs.writeFileSync(filename, JSON.stringify(comparison, null, 2)); }
  console.log(JSON.stringify(comparison, null, 2));
}
