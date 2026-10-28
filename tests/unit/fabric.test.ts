import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FabricDatabase } from '../../electron/fabric/FabricDatabase';
import { ConnectedAIRegistry, FUTURE_PROVIDER_IDS } from '../../src/fabric/ConnectedAIRegistry';
import { CapabilityRouter } from '../../src/fabric/CapabilityRouter';
import { ContextBudgetManager, HandoffContextBuilder } from '../../src/fabric/ContextBudgetManager';
import { ConversationLedger } from '../../src/fabric/ConversationLedger';
import { FabricEngine } from '../../src/fabric/FabricEngine';
import { UsageLedger } from '../../src/fabric/UsageLedger';
import { LocalRuntimeRegistry } from '../../src/machine/localai/LocalRuntimeRegistry';
import { OllamaRuntimeAdapter } from '../../src/machine/localai/runtimes/OllamaRuntimeAdapter';
import { LlamaCppRuntime } from '../../electron/machine/LlamaCppRuntime';
import { ResourcePressureEngine } from '../../src/machine/ResourcePressureEngine';
import { validateModelConfiguration } from '../../src/machine/ResourcePressureEngine';
import { calculateBudgetV2 } from '../../src/machine/ResourceBudgetCalculator';
import { IntelligenceBenchmarkEngine } from '../../src/machine/IntelligenceBenchmarkEngine';
import { fixture } from '../../src/machine/fixtures/machines';
import { VersionedModelCatalog } from '../../electron/machine/VersionedModelCatalog';
import type { ConversationMessage, IntelligenceProvider, IntelligenceRequest, ProviderCapability, ProviderDescriptor, TaskState, UsageRecord } from '../../src/fabric/types';

let pass = 0; let fail = 0;
const t = (name: string, ok: boolean) => { if (ok) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-fabric-'));
const dbPath = path.join(dir, 'fabric.sqlite');
let activeDb: FabricDatabase | null = null;
const descriptor = (id: string, over: Partial<ProviderDescriptor> = {}): ProviderDescriptor => ({ id, label: id,
  kind: id === 'local' ? 'LOCAL_MODEL' : 'GENERAL_AI', state: 'AVAILABLE',
  capabilities: [{ id: 'chat', strength: 1, available: true }, { id: 'coding', strength: 1, available: true }],
  costClass: id === 'local' ? 'LOCAL' : 'SUBSCRIPTION', privacyClass: id === 'local' ? 'LOCAL' : 'REMOTE',
  contextLimit: 8192, quality: id === 'local' ? 0.4 : 0.9, healthCheckedAt: Date.now(), quota: 'UNKNOWN', ...over });
const message = (id: string, providerId: string | null = null): ConversationMessage => ({ conversationId: 'c1', messageId: id,
  parentId: null, role: 'assistant', content: `content ${id}`, timestamp: Date.now(), providerId, modelId: null, channel: null,
  taskId: 'task', tools: [], artifacts: [], usageIds: [], contextRefs: [], routingDecisionId: null });
const task: TaskState = { taskId: 'task', conversationId: 'c1', goal: 'repair bug', currentTask: 'test', instructions: ['preserve files'],
  findings: ['test fails'], decisions: ['small patch'], artifacts: ['math.js'], openQuestions: [], pendingSteps: ['verify'], updatedAt: Date.now() };

try {
  console.log('\n— SQLite ledgers —');
  let db = new FabricDatabase(dbPath); activeDb = db; const usage = new UsageLedger(db); const convo = new ConversationLedger(db);
  t('unknown quota remains unknown', usage.quota('cloud', null, 'REQUESTS').remaining === null);
  const estimate = usage.updateQuota({ providerId: 'cloud', accountId: null, unit: 'REQUESTS', used: 8, limit: 10,
    remaining: null, resetAt: null, source: 'ESTIMATED' });
  t('estimated usage never invents remaining', estimate.state === 'UNKNOWN' && estimate.remaining === null);
  const known = usage.updateQuota({ providerId: 'cloud', accountId: null, unit: 'REQUESTS', used: 9, limit: 10,
    remaining: 1, resetAt: Date.now() + 1000, source: 'AUTHORITATIVE' });
  t('authoritative quota conserves', known.state === 'CONSERVE' && known.remaining === 1);
  usage.updateQuota({ providerId: 'resetting', accountId: null, unit: 'REQUESTS', used: 10, limit: 10,
    remaining: 0, resetAt: Date.now() - 1, source: 'AUTHORITATIVE' });
  t('passed reset becomes unknown until provider refresh', usage.quota('resetting', null, 'REQUESTS').state === 'UNKNOWN');
  const record: UsageRecord = { id: 'u1', providerId: 'cloud', accountId: null, modelId: 'm', taskId: 'task', unit: 'INPUT_TOKENS',
    amount: 20, input: 20, output: null, cached: null, estimatedCost: null, currency: null, timestamp: Date.now(), resetAt: null, source: 'OBSERVED' };
  usage.record(record); convo.append(message('m1', 'cloud')); convo.append(message('m2', 'local')); convo.saveTask(task);
  usage.record({ ...record, id: 'u2', unit: 'IMAGES', amount: 2, input: null, timestamp: record.timestamp + 1 });
  t('multiple usage units coexist', usage.page('cloud').some((r) => r.unit === 'IMAGES') && usage.page('cloud').some((r) => r.unit === 'INPUT_TOKENS'));
  db.saveBenchmark({ hardwareFingerprint: 'fingerprint', runtimeId: 'ollama', modelId: 'm', configuration: 'Q4/4096/0/8/F16/512' }, { tps: 8 });
  db.close(); db = new FabricDatabase(dbPath); activeDb = db;
  t('UsageLedger persists after restart', new UsageLedger(db).page('cloud').some((r) => r.id === 'u1'));
  t('quota persists after restart', db.quota('cloud', null, 'REQUESTS').state === 'CONSERVE');
  t('ConversationLedger persists after restart', new ConversationLedger(db).page('c1').length === 2);
  t('task state persists after restart', db.task('task')?.goal === 'repair bug');
  t('benchmark keyed by hardware/runtime/model/config', (db.benchmark({ hardwareFingerprint: 'fingerprint', runtimeId: 'ollama', modelId: 'm', configuration: 'Q4/4096/0/8/F16/512' }) as { tps: number })?.tps === 8);
  t('benchmark wrong configuration misses', db.benchmark({ hardwareFingerprint: 'fingerprint', runtimeId: 'ollama', modelId: 'm', configuration: 'other' }) === null);
  t('bounded pages', db.messagePage('c1', 1).length === 1 && db.usagePage('cloud', 1).length === 1);

  console.log('\n— Registry, router and fallback —');
  const registry = new ConnectedAIRegistry(); registry.register(descriptor('cloud')); registry.register(descriptor('local'));
  registry.get('cloud')!.capabilities[0]!.available = false;
  t('registry is defensive copy', registry.get('cloud')!.capabilities[0]!.available);
  t('future adapters remain names, not connections', FUTURE_PROVIDER_IDS.includes('codex'));
  const router = new CapabilityRouter();
  const request = { taskId: 'task', taskType: 'chat', required: ['chat' as const] };
  t('subscriptions first', router.route(request, registry.list()).selectedProviderId === 'cloud');
  t('local first policy', router.route({ ...request, policy: 'LOCAL_FIRST' }, registry.list()).selectedProviderId === 'local');
  t('capability rejection', router.route({ ...request, required: ['vision'] }, registry.list()).selectedProviderId === null);
  t('paid API fallback disabled', router.route(request, [descriptor('paid', { costClass: 'PAID_API' })]).selectedProviderId === null);
  t('offline cloud -> local', router.route(request, [descriptor('cloud', { state: 'OFFLINE' }), descriptor('local')]).selectedProviderId === 'local');
  t('degraded allowed if compatible', router.route(request, [descriptor('cloud', { state: 'DEGRADED' })]).selectedProviderId === 'cloud');
  t('quota exhausted -> next', router.route(request, [descriptor('cloud', { quota: 'EXHAUSTED' }), descriptor('local')]).selectedProviderId === 'local');
  t('privacy cannot silently escalate', router.route({ ...request, maxPrivacy: 'LOCAL' }, registry.list()).selectedProviderId === 'local');
  t('premium reserve protects critical capacity', router.route(request, [descriptor('cloud', { quota: 'CRITICAL' }), descriptor('local')]).selectedProviderId === 'local');
  const stubRegistry = new ConnectedAIRegistry(); stubRegistry.register(descriptor('codex', { state: 'NOT_IMPLEMENTED', capabilities: [] }));
  t('unimplemented adapter never routes', router.route(request, stubRegistry.list()).selectedProviderId === null);
  const exhausted = new UsageLedger(db).updateQuota({ providerId: 'cloud', accountId: null, unit: 'REQUESTS', used: 10, limit: 10, remaining: 0, resetAt: Date.now() + 1000, source: 'AUTHORITATIVE' });
  t('authoritative exhausted state', exhausted.state === 'EXHAUSTED');
  const engine = new FabricEngine(registry, new UsageLedger(db), db);
  const localAdapter: IntelligenceProvider = { identity: () => ({ id: 'local', label: 'local', kind: 'LOCAL_MODEL' }),
    capabilities: async (): Promise<ProviderCapability[]> => [{ id: 'chat', strength: 1, available: true }],
    connectionState: async () => 'AVAILABLE', entitlement: async () => ({ paid: false, details: null }),
    health: async () => ({ ok: true, message: null }), usage: async () => [],
    estimate: async () => ({ amount: null, currency: null }), execute: async () => ({ text: 'local result', model: 'm' }) };
  engine.attach(localAdapter);
  const e2e = await engine.execute(request, { taskId: 'task', prompt: 'hi' });
  t('all cloud exhausted -> local execution', e2e.response?.text === 'local result');
  t('routing audit persists', db.routingPage('task').length > 0);
  const stopRegistry = new ConnectedAIRegistry(); stopRegistry.register(descriptor('local'));
  const stopEngine = new FabricEngine(stopRegistry, new UsageLedger(db), db);
  stopEngine.attach({ ...localAdapter, execute: async (input: IntelligenceRequest) => new Promise((_, reject) => {
    input.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  }) });
  const stopController = new AbortController();
  const stopping = stopEngine.execute({ ...request, taskId: 'stopping' }, { taskId: 'stopping', prompt: 'long', signal: stopController.signal });
  stopController.abort();
  t('STOP during provider execution prevents fallback', (await stopping).response === null && db.routingPage('stopping').length === 1);

  console.log('\n— Conversation handoff and context —');
  const handoff = new HandoffContextBuilder().build(task, db.messagePage('c1').map((r) => r.message), 4096, 4096);
  t('provider change preserves JARVIS task context', handoff.goal === 'repair bug' && handoff.recentMessages.some((m) => m.providerId === 'cloud') && handoff.recentMessages.some((m) => m.providerId === 'local'));
  t('context budget bounded', new ContextBudgetManager().select(Array.from({ length: 100 }, (_, i) => ({ ...message(`x${i}`), content: 'x'.repeat(1000) })), 2048, 2048).selected.length < 100);

  console.log('\n— Local runtimes, catalog and pressure —');
  const runtime = new OllamaRuntimeAdapter({ health: async () => ({ online: true, endpoint: 'http://127.0.0.1:11434', version: 'test', models: [] }),
    listModels: async () => [], generate: async () => 'ok' });
  const runtimes = new LocalRuntimeRegistry([runtime]);
  t('LocalRuntimeRegistry finds Ollama', runtimes.get('ollama') === runtime);
  let duplicate = false; try { runtimes.register(runtime); } catch { duplicate = true; }
  t('duplicate runtime rejected', duplicate);
  const fakeLlama = new LlamaCppRuntime({ executable: process.execPath, fetcher: async (url, init) => {
    if (String(url).endsWith('/health')) return new Response('{}', { status: 200 });
    if (String(url).endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'small.gguf' }] }), { status: 200 });
    if (String((init as RequestInit).body).includes('"stream":true')) return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n');
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
  } });
  t('llama.cpp capability probe does not invent GPU', fakeLlama.probe().installed && fakeLlama.probe().gpuAvailable === null);
  t('llama.cpp detect and list models', (await fakeLlama.detect()).models[0]?.name === 'small.gguf');
  t('llama.cpp structured generate contract', (await fakeLlama.generate({ model: 'small.gguf', prompt: 'hi', json: true })).includes('ok'));
  let streamed = ''; for await (const token of fakeLlama.stream({ model: 'small.gguf', prompt: 'hi' })) streamed += token;
  t('llama.cpp streaming contract', streamed === 'hi');
  const catalog = new VersionedModelCatalog(path.join(dir, 'catalog.json'));
  t('versioned built-in catalog', catalog.load().entries.length > 0 && catalog.load().source === 'builtin');
  fs.writeFileSync(path.join(dir, 'catalog.json'), '{bad json');
  t('invalid update falls back safely', !!catalog.load().error && catalog.load().source === 'builtin');
  const entry = catalog.load().entries[0]!;
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ version: 2, entries: [{ ...entry, catalogVersion: 2 }] }));
  t('catalog update without recompile', catalog.load().source === 'user-data' && catalog.load().version === 2);
  const pressure = new ResourcePressureEngine(); const machine = fixture('C');
  const observed = { ramFreeBytes: machine.memory.availableBytes, vramFreeBytes: null, sharedGpuFreeBytes: null,
    cpuUtilization: 30, gpuUtilization: null, thermalCelsius: null, onBattery: null, freeStorageBytes: null, otherLoadBytes: null };
  t('unsafe demand never auto-recommended', !pressure.assess(machine, observed, { ramBytes: 10 ** 15, vramBytes: 0, diskBytes: 0, cpuThreads: 2 }).automatic);
  t('unknown GPU free memory blocks automatic offload', !pressure.assess(machine, observed, { ramBytes: 1024, vramBytes: 1024, diskBytes: 0, cpuThreads: 2 }).automatic);
  t('budget v2 uses live free RAM', calculateBudgetV2(machine, { ramFreeBytes: 1024 ** 3, vramFreeBytes: null, storageFreeBytes: null, otherLoadBytes: null }).safeAIRamBytes < 1024 ** 3);
  const config = { modelId: 'small', runtimeId: 'ollama', quantization: 'Q4_K_M', contextTokens: 4096, gpuOffloadLayers: 0,
    threads: 2, kvCache: 'F16' as const, batchSize: 512 };
  validateModelConfiguration(config, machine, false);
  let badConfig = false; try { validateModelConfiguration({ ...config, threads: 999 }, machine, false); } catch { badConfig = true; }
  t('configuration bound to actual hardware', badConfig);
  const benchmarkRuntime = new OllamaRuntimeAdapter({ health: async () => ({ online: true, endpoint: 'local', version: 'x', models: [] }),
    listModels: async () => [], generate: async (input) => input.json ? input.prompt.includes('n\\":7') ? '{"ok":true,"n":7}'
      : input.prompt.includes('tool') || input.prompt.includes('herramienta') ? '{"tool":"file.read"}' : '{"task":"coding"}' : 'JARVIS_OK' });
  const bench = await new IntelligenceBenchmarkEngine(db).run(benchmarkRuntime, config, 'fingerprint',
    () => ({ ramBytes: 100, vramBytes: null, cpuPercent: 2 }));
  t('benchmark stores reproducible key', !!db.benchmark(bench.key) && bench.startupMs !== null && bench.timeToFirstTokenMs === null);
  db.close(); activeDb = null;
} finally { activeDb?.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }

console.log(`\nFabric: ${pass} ok · ${fail} fallos`);
if (fail) process.exitCode = 1;
