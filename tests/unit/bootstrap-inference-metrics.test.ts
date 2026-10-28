import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalRuntime, bootstrapChatPrompt, validateBootstrapInferencePolicy } from '../../electron/bootstrap/LocalRuntime';
import type { BootstrapInferenceMetrics } from '../../electron/bootstrap/LocalRuntime';
import { BootstrapController, TRUSTED_RUNTIME, TRUSTED_MODELS } from '../../electron/bootstrap/BootstrapController';
import { ArtifactInstaller } from '../../electron/bootstrap/ArtifactInstaller';
import type { BootstrapJournal, BootstrapSnapshot } from '../../electron/bootstrap/contracts';
import type { BootstrapRuntime } from '../../electron/bootstrap/LocalRuntime';
import { fixture } from '../../src/machine/fixtures/machines';

// Transport/process are deliberately simulated. This tests the production SSE,
// metadata projection, exact token preflight and error classification, not model quality.
const runtime = new LocalRuntime(TRUSTED_RUNTIME), schema = { type: 'object' };
const privateRuntime = runtime as unknown as { process: unknown; endpoint: string; startMs: number; contextCapacity: number | null };
privateRuntime.process = { pid: 999, ownership: 'SIMULATED_CONTRACT', killTree: async () => {} };
privateRuntime.endpoint = 'http://127.0.0.1:19797'; privateRuntime.startMs = 23; privateRuntime.contextCapacity = 2048;
const originalFetch = globalThis.fetch; const signal = () => new AbortController().signal;
let requests: Array<{ route: string; body: any }> = [], tokenCount = 50, capacity = 2048;
let terminal: Record<string, unknown> = {}, omitStop = false, oversized = false, fail = false;
const secret = 'synthetic-private-prompt-never-persist';
const projected = (): BootstrapInferenceMetrics => { const value = runtime.inferenceMetrics(); assert.ok(value); return value; };
let assertions = 0; const pass = (name: string) => { assertions++; console.log('PASS ' + name); };
globalThis.fetch = async (url, init) => {
    const route = new URL(String(url)).pathname, body = init?.body ? JSON.parse(String(init.body)) : null; requests.push({ route, body });
    if (fail) return new Response('unexported sensitive provider body', { status: 503 });
    if (route === '/props') return Response.json({ default_generation_settings: { n_ctx: capacity } });
    if (route === '/tokenize') return oversized ? new Response(' '.repeat(65537)) : Response.json({ tokens: Array.from({ length: tokenCount }, (_, index) => index) });
    assert.equal(route, '/completion');
    const events = [{ content: '{"ok":true}', stop: false }, ...(omitStop ? [] : [{ content: '', stop: true, stop_type: 'eos', truncated: false, tokens_evaluated: tokenCount,
        timings: { prompt_n: tokenCount, predicted_n: 8, predicted_per_second: 5 }, prompt: secret, tokens: [1, 2, 3], ...terminal }])];
    return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''));
};
try {
    assert.equal(await runtime.generateJson(secret, signal(), schema), '{"ok":true}');
    assert.deepEqual(requests.map(request => request.route), ['/props', '/tokenize', '/completion']);
    assert.equal(requests[1].body.content, bootstrapChatPrompt(secret)); assert.equal(requests[2].body.prompt, requests[1].body.content);
    assert.equal(requests[1].body.add_special, true); assert.equal(requests[1].body.parse_special, true); assert.equal(requests[1].body.with_pieces, false);
    assert.equal(requests[2].body.n_predict, 512);
    const successful = projected(); assert.equal(successful.state, 'COMPLETED'); assert.equal(successful.startMs, 23); assert.equal(successful.promptTokens, 50);
    assert.equal(successful.tokenizedPromptTokens, 50); assert.equal(successful.outputTokens, 8); assert.equal(successful.tps, 5); assert.equal(successful.contextCapacity, 2048);
    assert.equal(successful.stopType, 'eos'); assert.equal(successful.truncated, false); assert.ok(successful.firstTokenMs !== null); assert.ok(successful.generationMs !== null);
    assert.equal(JSON.stringify(successful).includes(secret), false); assert.equal('tokens' in successful, false);
    successful.outputTokens = 999; assert.equal(projected().outputTokens, 8);
    pass('Exact tokenized chatwrap, baseline512, numeric-only metrics and defensive getter copy');

    requests = []; tokenCount = 1600;
    await assert.rejects(() => runtime.generateJson('over budget', signal(), schema), /PROMPT_TOKEN_BUDGET/);
    assert.equal(requests.filter(request => request.route === '/completion').length, 0); assert.equal(projected().promptTokens, 1600);
    assert.equal(projected().outputTokens, null); assert.equal(projected().state, 'FAILED'); assert.equal(projected().reason, 'PROMPT_TOKEN_BUDGET');
    pass('Prompt plus output reserve exceeds real context and blocks generation before effects');

    tokenCount = 50; terminal = { stop_type: 'limit', timings: { prompt_n: 50, predicted_n: 512, predicted_per_second: 5 } };
    await assert.rejects(() => runtime.generateJson('valid JSON cut at token limit', signal(), schema), error => {
        assert.match(String(error), /OUTPUT_TOKEN_LIMIT/); assert.equal((error as { inferenceMetrics: BootstrapInferenceMetrics }).inferenceMetrics.stopType, 'limit'); return true;
    });
    assert.equal(projected().reason, 'OUTPUT_TOKEN_LIMIT'); assert.equal(projected().outputTokens, 512);
    pass('Valid JSON with stop_type limit fails explicitly and retains failure metrics');

    terminal = { truncated: true };
    await assert.rejects(() => runtime.generateJson('valid JSON but context shifted', signal(), schema), /CONTEXT_TRUNCATED/);
    assert.equal(projected().reason, 'CONTEXT_TRUNCATED'); assert.equal(projected().truncated, true);
    pass('Context truncation fails even when JSON parses');

    terminal = {}; omitStop = true;
    await assert.rejects(() => runtime.generateJson('incomplete stream', signal(), schema), /INFERENCE_INCOMPLETE/);
    assert.equal(projected().stopType, null); assert.equal(projected().outputTokens, null); omitStop = false;
    pass('Incomplete stream cannot reuse previous stop metadata');

    requests = []; const stopped = new AbortController(); stopped.abort();
    await assert.rejects(() => runtime.generateJson('cancelled', stopped.signal, schema), /STOPPED/);
    assert.equal(requests.length, 0); assert.equal(projected().state, 'CANCELLED'); assert.equal(projected().promptTokens, null);
    pass('Already-cancelled request emits no HTTP and clears stale successful metrics');

    oversized = true;
    await assert.rejects(() => runtime.generateJson('too-large tokenization reply', signal(), schema), /INFERENCE_METADATA_TOO_LARGE/);
    assert.equal(projected().outputTokens, null); oversized = false;
    pass('Metadata body bound is64KiB and generation is blocked on oversized tokenizer replies');

    fail = true;
    await assert.rejects(() => runtime.generateJson('server failed', signal(), schema), /INFERENCE_METADATA_HTTP_503/);
    assert.equal(projected().stopType, null); assert.equal(JSON.stringify(projected()).includes('sensitive'), false); fail = false;
    pass('HTTP failure records a closed reason without exporting provider response contents');

    await assert.rejects(() => runtime.generateJson('x'.repeat(5001), signal(), schema), /PATCH_CONTEXT_LIMIT/); assert.equal(runtime.inferenceMetrics(), null);
    assert.throws(() => validateBootstrapInferencePolicy({ contextTokens: 32768 }), /INFERENCE_POLICY_DENIED/);
    assert.throws(() => validateBootstrapInferencePolicy({ maxOutputTokens: 999999 }), /INFERENCE_POLICY_DENIED/);
    assert.throws(() => validateBootstrapInferencePolicy({ timeoutMs: 999999 }), /INFERENCE_POLICY_DENIED/);
    pass('Existing character bound and explicit main policy bounds stay unchanged');

    privateRuntime.contextCapacity = capacity = 4096; requests = [];
    await runtime.generateJson('bounded future policy', signal(), schema, { contextTokens: 4096, maxOutputTokens: 1024, timeoutMs: 300000 });
    assert.equal(requests.find(request => request.route === '/completion')?.body.n_predict, 1024); assert.equal(projected().contextCapacity, 4096);
    pass('Explicit main future bounds supported without changing baseline defaults');

    privateRuntime.process = null; await assert.rejects(() => runtime.generate('offline', signal()), /RUNTIME_OFFLINE/);
    assert.equal(projected().state, 'FAILED'); assert.equal(projected().promptTokens, null); assert.equal(projected().outputTokens, null);
    pass('Offline generation cannot present stale counts from previous completion');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-bootstrap-metrics-unit-'));
    await assert.rejects(() => runtime.start(root, path.join(root, 'no-model.gguf'), TRUSTED_MODELS[0], signal()));
    assert.equal(runtime.inferenceMetrics(), null);
    pass('New start resets metadata before an integrity/file failure, with no process spawned');

    let state: BootstrapSnapshot | null = null, startedContexts: number[] = [], generatedPolicy: unknown;
    const journal: BootstrapJournal = { read: () => state, write: value => { state = structuredClone(value); }, operation: () => {}, effect: () => {}, benchmark: () => {} };
    class FakeInstaller extends ArtifactInstaller { async obtain(): Promise<string> { return root; } async runtime(): Promise<string> { return root; } }
    const fakeRuntime: BootstrapRuntime = { start: async (_bin, _model, candidate) => { startedContexts.push(candidate.context); return 23; },
        probe: async () => ({ correct: true, stable: true, latencyMs: 1, startMs: 23, firstTokenMs: 1, tokensPerSecond: 5, outputTokens: 8, ramBytes: null, vramBytes: null, contextTested: 50, at: Date.now(), rating: 'USABLE', error: null }),
        generate: async () => 'ok', generateJson: async (_prompt, _signal, _schema, policy) => { generatedPolicy = policy; return '{"ok":true}'; },
        inferenceMetrics: () => successful, stop: async () => {}, alive: () => false };
    const hardware = { ...fixture('D'), source: 'windows' as const, os: { ...fixture('D').os, platform: 'win32', architecture: 'x64' },
        cpu: { ...fixture('D').cpu, physicalCores: 6 }, memory: { totalBytes: 32 * 1024 ** 3, availableBytes: 20 * 1024 ** 3, usedBytes: 12 * 1024 ** 3 } };
    const controller = new BootstrapController(journal, new FakeInstaller(root), fakeRuntime, async () => hardware);
    await controller.install(); assert.equal(controller.snapshot().localHealth, 'OPERATIVE');
    await controller.answer('baseline', signal(), undefined, schema); assert.equal(startedContexts.at(-1), 2048); assert.equal(generatedPolicy, undefined);
    const catalogBefore = TRUSTED_MODELS.find(candidate => candidate.id === controller.snapshot().candidateId)!.context;
    await controller.answer('explicit main policy', signal(), undefined, schema, { contextTokens: 4096, maxOutputTokens: 768, timeoutMs: 180000 });
    assert.equal(startedContexts.at(-1), 4096); assert.deepEqual(generatedPolicy, { contextTokens: 4096, maxOutputTokens: 768, timeoutMs: 180000 });
    assert.equal(TRUSTED_MODELS.find(candidate => candidate.id === controller.snapshot().candidateId)!.context, catalogBefore);
    await assert.rejects(() => controller.answer('text cannot select policy', signal(), undefined, undefined, { contextTokens: 4096 }), /STRUCTURED_INFERENCE_POLICY_ONLY/);
    assert.equal(controller.inferenceMetrics()?.stopType, 'eos');
    pass('Controller keeps baseline catalog intact, clones explicit main context and exposes neutral runtime metrics');
} finally { globalThis.fetch = originalFetch; }
console.log(`BOOTSTRAP_INFERENCE_METRICS_UNIT_PASS ${assertions}; transport, tokens and process SIMULATED_CONTRACT; no paid/model calls`);
