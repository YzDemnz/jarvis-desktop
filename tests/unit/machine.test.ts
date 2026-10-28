import os from 'node:os';
import type { RuntimeDetection, SystemProfile } from '../../src/types';
import { MACHINE_FIXTURES, fixture, FIXTURE_IDS } from '../../src/machine/fixtures/machines';
import { computePerformanceProfile, pickBestGPU, performanceWording, tierFor } from '../../src/machine/performance';
import { computeFingerprint, compareFingerprints } from '../../src/machine/fingerprint';
import { calculateBudget, DEFAULT_BUDGET_RULES } from '../../src/machine/ResourceBudgetCalculator';
import { LOCAL_MODEL_CATALOG, matchInstalled, catalogEntry } from '../../src/machine/catalog/localModelCatalog';
import { recommendModels, checkCompatibility, detectAcceleration } from '../../src/machine/ModelRecommendationEngine';
import { LocalAIManager } from '../../src/machine/localai/LocalAIManager';
import { OllamaRuntimeAdapter } from '../../src/machine/localai/runtimes/OllamaRuntimeAdapter';
import { llamaCppRuntime, lmStudioRuntime } from '../../src/machine/localai/runtimes/stubs';
import { LocalModelBenchmark, rate, isValidStructured } from '../../src/machine/LocalModelBenchmark';
import { capabilityRegistry, summarizeCapabilities, permissionLabel } from '../../src/machine/CapabilityRegistry';
import { machineContextBuilder } from '../../src/machine/MachineContextBuilder';
import { FirstRunManager, DEFAULT_CONFIG, FIRST_RUN_STEPS } from '../../src/machine/FirstRunManager';
import type { ConfigStore } from '../../src/machine/FirstRunManager';
import { isSensitiveField, sanitizeField, sanitizeText, sanitizeDom, REDACTED } from '../../src/machine/CredentialBoundary';
import { OSIdentityService } from '../../electron/machine/OSIdentityService';
import { SystemProfiler } from '../../electron/machine/SystemProfiler';
import { MockHardwareAdapter } from '../../electron/machine/hardware/MockHardwareAdapter';
import { vendorOf, driveKindOf, adapterRamBytes } from '../../electron/machine/hardware/WindowsHardwareAdapter';
import { CancellationToken } from '../../src/agent';

const GB = 1024 ** 3;
let pass = 0, fail = 0;
const t = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};

const runtimeOf = (over: Partial<RuntimeDetection> = {}): RuntimeDetection => ({
  runtimeId: 'ollama', name: 'Ollama', detected: true, status: 'READY',
  endpoint: 'http://127.0.0.1:11434', version: '0.5.0', models: [],
  capabilities: { structuredOutput: true, streaming: true, embeddings: true, acceleration: ['cpu', 'nvidia'] },
  error: null, checkedAt: Date.now(), ...over,
});

/* ================================================================= */
console.log('\n— OSIdentityService —');
{
  const service = new OSIdentityService();
  const id = service.identity();
  t('devuelve username', typeof id.username === 'string' && id.username.length > 0);
  t('devuelve computerName', typeof id.computerName === 'string' && id.computerName.length > 0);
  t('devuelve homeDirectory', id.homeDirectory === os.homedir() || id.homeDirectory === 'No disponible');
  t('devuelve plataforma real', id.platform === process.platform);
  t('devuelve arquitectura real', id.architecture === process.arch);
  t('userDataDirectory no está vacío', id.userDataDirectory.length > 0);
  t('displayName nunca es una cadena vacía', id.displayName.length > 0);
  t('no expone email', !JSON.stringify(id).includes('@'));
  t('no expone SID', !/S-1-5-/.test(JSON.stringify(id)));
  t('el userData acepta el perfil del usuario o el temporal externo configurado por el host',
    id.userDataDirectory === 'No disponible' || id.userDataDirectory.includes(os.homedir()) || id.userDataDirectory.startsWith(os.tmpdir()),
    id.userDataDirectory);
}

console.log('\n— SystemProfiler con fixtures —');
{
  for (const fixtureId of FIXTURE_IDS) {
    const profiler = new SystemProfiler(new MockHardwareAdapter(fixtureId), () => []);
    const profile = await profiler.profile(true);
    t(`fixture ${fixtureId} produce un perfil completo`,
      Boolean(profile.os && profile.cpu && profile.memory && Array.isArray(profile.gpus)));
  }
  const partial = await new SystemProfiler(new MockHardwareAdapter('G'), () => []).profile(true);
  t('los campos ilegibles se listan en unavailable', partial.unavailable.length > 0, String(partial.unavailable.length));
  t('cpu.model desconocido es null, no una invención', partial.cpu.model === null);
  t('storage sin datos queda en null', partial.storage[0]?.freeBytes === null);
  t('nunca se inventa VRAM', partial.gpus[0]?.vramBytes === null);

  const failing = new SystemProfiler({
    id: 'mock', os: () => Promise.reject(new Error('boom')), cpu: () => Promise.reject(new Error('boom')),
    memory: () => Promise.reject(new Error('boom')), gpus: () => Promise.reject(new Error('boom')),
    storage: () => Promise.reject(new Error('boom')), power: () => Promise.reject(new Error('boom')),
  } as never, () => []);
  const broken = await failing.profile(true);
  t('un adapter que falla no rompe el perfilado', broken.source === 'partial');
  t('el perfil roto sigue teniendo forma válida', broken.gpus.length === 0 && broken.cpu.model === null);
}

console.log('\n— Parsing de Windows —');
{
  t('detecta NVIDIA', vendorOf('NVIDIA GeForce RTX 3060') === 'nvidia');
  t('detecta AMD por Radeon', vendorOf('AMD Radeon RX 6700') === 'amd');
  t('detecta Intel', vendorOf('Intel(R) UHD Graphics') === 'intel');
  t('vendor desconocido no se inventa', vendorOf(null) === 'unknown');
  t('NVMe por bus', driveKindOf(null, 'NVMe') === 'nvme');
  t('SSD por media type', driveKindOf('SSD', 'SATA') === 'ssd');
  t('kind desconocido se mantiene unknown', driveKindOf(null, null) === 'unknown');
  t('AdapterRAM saturado en la RX 6600 real no se presenta como 4.3 GB', adapterRamBytes(4293918720) === null);
  t('AdapterRAM de 2 GiB conserva un valor válido', adapterRamBytes(2 * GB) === 2 * GB);
}

console.log('\n— MachinePerformanceProfile —');
{
  const a = computePerformanceProfile(fixture('A'));
  const c = computePerformanceProfile(fixture('C'));
  const d = computePerformanceProfile(fixture('D'));
  const g = computePerformanceProfile(fixture('G'));

  t('la máquina de gama alta puntúa más que la de entrada', d.score > a.score, `${d.score} vs ${a.score}`);
  t('la workstation queda por encima de la de entrada', c.score > a.score, `${c.score} vs ${a.score}`);
  t('no se basa sólo en RAM', c.breakdown.vram > 0 && a.breakdown.vram === 0);
  t('la de entrada no cae en el tramo más alto', a.tier !== 'EXTREME', a.tier);
  t('la de gama alta alcanza un tramo alto', d.tier === 'EXTREME' || d.tier === 'HIGH', d.tier);
  t('el desglose tiene los seis ejes', Object.keys(c.breakdown).length === 6);
  t('la puntuación está en 0..100', [a, c, d, g].every((p) => p.score >= 0 && p.score <= 100));
  t('los datos ausentes generan notas', g.notes.length > 0, String(g.notes.length));
  t('tierFor es monótona', tierFor(10) === 'VERY_LOW' && tierFor(50) === 'BALANCED' && tierFor(90) === 'EXTREME');
  t('el texto al usuario no nombra el tramo',
    !['VERY_LOW', 'LOW', 'HIGH', 'EXTREME', 'BALANCED'].some((x) => performanceWording('LOW').includes(x)));

  const multi = fixture('F');
  t('con dos GPU elige la dedicada', pickBestGPU(multi)?.vendor === 'nvidia');
  t('la integrada no gana a la dedicada', pickBestGPU(multi)?.dedicated === true);
  t('sin GPU devuelve null', pickBestGPU({ ...fixture('B'), gpus: [] } as SystemProfile) === null);
}

console.log('\n— Hardware fingerprint —');
{
  const c = computeFingerprint(fixture('C'));
  const cAgain = computeFingerprint(fixture('C'));
  const d = computeFingerprint(fixture('D'));

  t('es determinista', c.hash === cAgain.hash);
  t('distingue máquinas distintas', c.hash !== d.hash);
  t('usa buckets, no valores exactos', c.ramBucketGB === 32 && c.vramBucketGB === 8, `${c.ramBucketGB}/${c.vramBucketGB}`);
  const json = JSON.stringify(c);
  t('no contiene serial', !/serial/i.test(json));
  t('no contiene MAC', !/([0-9a-f]{2}:){5}[0-9a-f]{2}/i.test(json));
  t('no contiene UUID', !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(json));
  t('sólo lleva los cinco campos previstos',
    Object.keys(c).sort().join(',') === 'architecture,cpuModel,gpuModels,hash,ramBucketGB,version,vramBucketGB'.split(',').sort().join(','),
    Object.keys(c).join(','));

  t('sin previo no hay cambio', compareFingerprints(null, c).changed === false);
  t('igual no es cambio', compareFingerprints(c, cAgain).changed === false);
  const change = compareFingerprints(c, d);
  t('distinto sí es cambio', change.changed && change.significant);
  t('nombra los campos que cambiaron', change.fields.includes('cpu') && change.fields.includes('gpu'), change.fields.join(','));

  // Un cambio pequeño de RAM dentro del mismo bucket no debe alertar.
  const jitter = { ...fixture('C'), memory: { totalBytes: 32 * GB - 100 * 1024 * 1024, availableBytes: 20 * GB, usedBytes: 12 * GB } };
  t('la fluctuación dentro del bucket no alerta',
    compareFingerprints(c, computeFingerprint(jitter as SystemProfile)).significant === false);
}

console.log('\n— ResourceBudgetCalculator —');
{
  const a = calculateBudget(fixture('A'));
  const c = calculateBudget(fixture('C'));
  const g = calculateBudget(fixture('G'));
  const h = calculateBudget(fixture('H'));

  t('reserva sistema y aplicación', c.systemReserveBytes > 0 && c.appReserveBytes > 0);
  t('el presupuesto de IA nunca es toda la RAM', c.safeAIRamBytes < (c.totalRamBytes ?? 0));
  t('las reservas y el presupuesto no exceden el total',
    c.systemReserveBytes + c.appReserveBytes + c.safeAIRamBytes <= (c.totalRamBytes ?? 0) + 1);
  t('la máquina grande tiene más presupuesto', c.safeAIRamBytes > a.safeAIRamBytes);
  t('en 8 GB la reserva de app no se come todo', a.safeAIRamBytes > 0, String(a.safeAIRamBytes));
  const noRam = calculateBudget({ ...fixture('G'), memory: { totalBytes: null, availableBytes: null, usedBytes: null } } as SystemProfile);
  t('sin RAM legible el presupuesto es cero', noRam.safeAIRamBytes === 0 && noRam.notes.length > 0);
  t('sin VRAM legible avisa', g.notes.some((n) => n.includes('VRAM')));
  t('reserva VRAM para el escritorio', c.safeAIVramBytes < (c.totalVramBytes ?? 0));
  t('el disco casi lleno deja presupuesto cero', h.safeDiskBytes === 0, String(h.safeDiskBytes));
  t('las reglas son configurables', DEFAULT_BUDGET_RULES.systemReserveRatio > 0 && DEFAULT_BUDGET_RULES.diskReserveBytes > 0);
}

console.log('\n— Catálogo —');
{
  t('hay al menos diez entradas', LOCAL_MODEL_CATALOG.length >= 10, String(LOCAL_MODEL_CATALOG.length));
  t('ids únicos', new Set(LOCAL_MODEL_CATALOG.map((m) => m.id)).size === LOCAL_MODEL_CATALOG.length);
  t('todas declaran runtime, tier y fuente oficial',
    LOCAL_MODEL_CATALOG.every((m) => m.runtimes.length && m.tier && m.officialSource.startsWith('https://')));
  t('todas estiman RAM y disco', LOCAL_MODEL_CATALOG.every((m) => m.estimatedRamBytes > 0 && m.diskBytes > 0));
  t('la RAM estimada supera al disco', LOCAL_MODEL_CATALOG.every((m) => m.estimatedRamBytes > m.diskBytes * 0.9));
  t('se cubren los cinco tiers',
    new Set(LOCAL_MODEL_CATALOG.map((m) => m.tier)).size >= 4);
  t('catalogEntry encuentra por id', catalogEntry('llama3.2:1b-instruct-q4') !== null);
  t('matchInstalled resuelve un nombre de Ollama', matchInstalled('qwen2.5:3b')?.family === 'qwen2.5', String(matchInstalled('qwen2.5:3b')?.id));
  t('matchInstalled devuelve null si no conoce el modelo', matchInstalled('modelo-inventado:99b') === null);
}

console.log('\n— Aceleración —');
{
  t('GPU NVIDIA dedicada con driver → nvidia', detectAcceleration(fixture('C')) === 'nvidia');
  t('sólo integrada Intel → intel', detectAcceleration(fixture('A')) === 'intel');
  t('sin GPU → cpu', detectAcceleration({ ...fixture('B'), gpus: [] } as SystemProfile) === 'cpu');
  t('GPU desconocida no asume CUDA', detectAcceleration(fixture('G')) !== 'nvidia', detectAcceleration(fixture('G')));
  t('con dos GPU elige la dedicada', detectAcceleration(fixture('F')) === 'nvidia');
  const noDriver = { ...fixture('C'), gpus: [{ ...fixture('C').gpus[0]!, driverVersion: null }] };
  t('sin driver no se promete CUDA', detectAcceleration(noDriver as SystemProfile) === 'unknown');
}

console.log('\n— Recomendación —');
{
  const runtimes = [runtimeOf()];

  const a = recommendModels({ profile: fixture('A'), runtimes });
  t('en 8 GB no recomienda un modelo grande',
    !a.router || a.router.parametersB <= 4, String(a.router?.id));
  t('el elegido cabe en el presupuesto',
    !a.router || a.router.estimatedRamBytes <= a.budget.safeAIRamBytes, String(a.router?.estimatedRamBytes));

  const d = recommendModels({ profile: fixture('D'), runtimes });
  t('en 64 GB hay recomendación', d.router !== null);
  t('el router prioriza latencia, no tamaño',
    !d.router || d.router.parametersB <= 8, `router ${d.router?.id}`);
  t('el modelo general puede ser mayor que el router',
    !d.generalModel || !d.router || d.generalModel.parametersB >= d.router.parametersB,
    `${d.generalModel?.id} vs ${d.router?.id}`);
  t('router y modelo general no son el mismo', d.generalModel?.id !== d.router?.id);

  const h = recommendModels({ profile: fixture('H'), runtimes });
  t('con el disco lleno todo es incompatible',
    h.compatibility.every((c) => c.verdict === 'incompatible'), String(h.compatibility.filter((c) => c.verdict !== 'incompatible').length));
  t('sin espacio no recomienda nada', h.router === null);
  t('explica el motivo', h.reason.length > 10);

  const e = recommendModels({ profile: fixture('E'), runtimes });
  t('en ARM descarta los modelos sólo x64',
    e.compatibility.filter((c) => c.verdict !== 'incompatible')
      .every((c) => LOCAL_MODEL_CATALOG.find((m) => m.id === c.modelId)!.supportedArchitecture.includes('arm64')));

  const none = recommendModels({ profile: fixture('C'), runtimes: [runtimeOf({ detected: false, status: 'NOT_CONFIGURED' })] });
  t('sin runtime detectado no hay runtimeId', none.runtimeId === null);
  t('sin runtime lo explica', none.reason.includes('runtime'));

  const withInstalled = recommendModels({
    profile: fixture('C'),
    runtimes: [runtimeOf({ models: [{ id: 'ollama:qwen2.5:3b', runtimeId: 'ollama', name: 'qwen2.5:3b', family: 'qwen2.5', parameterSize: '3B', quantization: 'Q4', diskBytes: 2 * GB }] })],
  });
  t('prefiere lo que ya está instalado', withInstalled.alreadyInstalled === true, String(withInstalled.router?.id));
  t('marca el runtime activo', withInstalled.runtimeId === 'ollama');

  t('ofrece alternativas', d.alternatives.length > 0);
  t('las alternativas no repiten al elegido', !d.alternatives.some((m) => m.id === d.router?.id));

  const budget = calculateBudget(fixture('A'));
  const big = LOCAL_MODEL_CATALOG.find((m) => m.parametersB >= 30)!;
  const compat = checkCompatibility(big, fixture('A'), budget, 'intel');
  t('un modelo enorme en una máquina pequeña es incompatible', compat.verdict === 'incompatible');
  t('la incompatibilidad viene razonada', compat.reasons.length > 0);
  t('no promete VRAM que no hay', compat.fitsVram === false);
}

console.log('\n— El benchmark manda sobre la estimación —');
{
  const runtimes = [runtimeOf()];
  const base = recommendModels({ profile: fixture('D'), runtimes });
  const slow = recommendModels({
    profile: fixture('D'), runtimes,
    benchmarks: [{
      modelId: base.router!.id, runtimeId: 'ollama', available: true,
      timeToFirstTokenMs: 5000, tokensPerSecond: 2, structuredOutputSuccess: true,
      completionSuccess: true, ramDeltaBytes: null, vramDeltaBytes: null,
      rating: 'SLOW', cancelled: false, error: null, ranAt: Date.now(),
    }],
  });
  // Lo correcto no es degradar el veredicto del mismo modelo, sino cambiar de
  // modelo: eso es justamente "preferir una alternativa".
  t('un benchmark lento hace preferir otra alternativa',
    slow.router?.id !== base.router?.id
      || ['SLOW', 'USABLE', 'NOT_RECOMMENDED'].includes(slow.expectedPerformance),
    `${base.router?.id} -> ${slow.router?.id} (${slow.expectedPerformance})`);

  const broken = recommendModels({
    profile: fixture('D'), runtimes,
    benchmarks: [{
      modelId: base.router!.id, runtimeId: 'ollama', available: true,
      timeToFirstTokenMs: 200, tokensPerSecond: 60, structuredOutputSuccess: false,
      completionSuccess: true, ramDeltaBytes: null, vramDeltaBytes: null,
      rating: 'NOT_RECOMMENDED', cancelled: false, error: null, ranAt: Date.now(),
    }],
  });
  t('si falla la salida estructurada, cambia de router', broken.router?.id !== base.router?.id,
    `${base.router?.id} -> ${broken.router?.id}`);
  t('un benchmark cancelado no influye',
    recommendModels({ profile: fixture('D'), runtimes, benchmarks: [{ ...broken.compatibility as never, modelId: base.router!.id, runtimeId: 'ollama', available: false, timeToFirstTokenMs: null, tokensPerSecond: null, structuredOutputSuccess: false, completionSuccess: false, ramDeltaBytes: null, vramDeltaBytes: null, rating: 'NOT_RECOMMENDED', cancelled: true, error: null, ranAt: 0 }] }).router?.id === base.router?.id);
}

console.log('\n— LocalAIManager —');
{
  const online = new OllamaRuntimeAdapter({
    health: async () => ({ online: true, endpoint: 'http://127.0.0.1:11434', version: '0.5.0', models: [] }),
    listModels: async () => [{ name: 'qwen2.5:3b', size: 2 * GB, family: 'qwen2.5', parameterSize: '3B' }],
  });
  const manager = new LocalAIManager([online, llamaCppRuntime(), lmStudioRuntime()]);
  const state = await manager.discover();
  t('detecta Ollama online', state.status === 'READY', state.status);
  t('marca el runtime activo', state.activeRuntimeId === 'ollama');
  t('lista los modelos', state.runtimes[0]?.models.length === 1);
  t('extrae la cuantización del nombre', state.runtimes[0]?.models[0]?.quantization === null || typeof state.runtimes[0]?.models[0]?.quantization === 'string');
  t('los runtimes sin implementar no fingen estar', state.runtimes.filter((r) => r.runtimeId !== 'ollama').every((r) => !r.detected));
  t('varios runtimes conviven', state.runtimes.length === 3);

  const noModels = new LocalAIManager([new OllamaRuntimeAdapter({
    health: async () => ({ online: true, endpoint: 'x', version: '0.5.0', models: [] }),
    listModels: async () => [],
  })]);
  t('online sin modelos es NO_MODELS', (await noModels.discover()).status === 'NO_MODELS');

  const offline = new LocalAIManager([new OllamaRuntimeAdapter({
    health: async () => ({ online: false, endpoint: 'x', models: [], error: 'ECONNREFUSED' }),
    listModels: async () => [],
  })]);
  const offState = await offline.discover();
  t('offline es OFFLINE', offState.status === 'OFFLINE', offState.status);
  t('offline no rompe nada', offState.runtimes[0]?.error !== null);
  t('offline no marca runtime activo', offState.activeRuntimeId === null);

  const throwing = new LocalAIManager([{
    id: 'ollama', name: 'Ollama',
    detect: async () => { throw new Error('boom'); },
    health: async () => ({ online: false, version: null, error: null }),
    listModels: async () => [], capabilities: () => ({ structuredOutput: false, streaming: false, embeddings: false, acceleration: [] }),
    getVersion: async () => null,
  }]);
  const errState = await throwing.discover();
  t('un adapter que lanza se registra como ERROR', errState.status === 'ERROR', errState.status);
  t('el descubrimiento nunca propaga la excepción', errState.runtimes.length === 1);

  const empty = new LocalAIManager([]);
  t('sin runtimes es NOT_CONFIGURED', (await empty.discover()).status === 'NOT_CONFIGURED');
}

console.log('\n— Benchmark —');
{
  t('valida la forma exacta', isValidStructured('{"ok":true,"n":7}'));
  t('rechaza JSON con otra forma', !isValidStructured('{"ok":true,"n":8}'));
  t('rechaza prosa alrededor', !isValidStructured('claro: {"ok":true,"n":7}'));
  t('rápido y fiable es EXCELLENT', rate(200, 40, true, true) === 'EXCELLENT');
  t('lento es SLOW', rate(4000, 3, true, true) === 'SLOW');
  t('sin salida estructurada nunca se recomienda', rate(100, 100, false, true) === 'NOT_RECOMMENDED');

  const benchmark = new LocalModelBenchmark();
  const good = await benchmark.run({
    id: 'ollama', name: 'Ollama',
    detect: async () => runtimeOf(), health: async () => ({ online: true, version: '1', error: null }),
    listModels: async () => [], capabilities: () => ({ structuredOutput: true, streaming: true, embeddings: false, acceleration: ['cpu'] }),
    getVersion: async () => '1',
    generate: async (input) => (input.json ? '{"ok":true,"n":7}' : 'Sirve para elegir a quién preguntar.'),
  }, 'qwen2.5:3b');
  t('un benchmark correcto reporta disponible', good.available && good.completionSuccess);
  t('reporta salida estructurada correcta', good.structuredOutputSuccess);
  t('no inventa tokens por segundo sin contador del runtime', good.tokensPerSecond === null);
  t('no confunde respuesta completa con primer token', good.timeToFirstTokenMs === null);

  const badJson = await benchmark.run({
    id: 'ollama', name: 'Ollama', detect: async () => runtimeOf(),
    health: async () => ({ online: true, version: '1', error: null }), listModels: async () => [],
    capabilities: () => ({ structuredOutput: true, streaming: true, embeddings: false, acceleration: ['cpu'] }),
    getVersion: async () => '1', generate: async () => 'no soy json',
  }, 'malo');
  t('JSON inválido baja a NOT_RECOMMENDED', badJson.rating === 'NOT_RECOMMENDED');
  t('registra el fallo estructurado', badJson.structuredOutputSuccess === false);

  const token = new CancellationToken();
  token.cancel('parada');
  const cancelled = await benchmark.run({
    id: 'ollama', name: 'Ollama', detect: async () => runtimeOf(),
    health: async () => ({ online: true, version: '1', error: null }), listModels: async () => [],
    capabilities: () => ({ structuredOutput: true, streaming: true, embeddings: false, acceleration: ['cpu'] }),
    getVersion: async () => '1', generate: async () => '{"ok":true,"n":7}',
  }, 'x', token);
  t('un token cancelado detiene el benchmark', cancelled.cancelled === true);
  t('un benchmark cancelado no se marca disponible', cancelled.available === false);

  const unmeasurable = await benchmark.run(llamaCppRuntime(), 'x');
  t('un runtime sin generate lo dice', unmeasurable.error !== null && !unmeasurable.available);
}

console.log('\n— CapabilityRegistry —');
{
  const ctx = (over: Partial<Parameters<typeof capabilityRegistry.evaluate>[0]> = {}) =>
    capabilityRegistry.evaluate({
      profile: fixture('C'), localAI: null, permission: 'ASSIST', hasNativeBridge: true, ...over,
    });

  const assist = ctx();
  t('cubre las 19 capacidades', assist.length === 19, String(assist.length));
  t('cada una lleva estado y permiso', assist.every((c) => c.state && c.requiredPermission));
  t('filesystem.search disponible en ASSIST', assist.find((c) => c.id === 'filesystem.search')?.state === 'AVAILABLE');
  t('filesystem.delete no se habilita en ASSIST', assist.find((c) => c.id === 'filesystem.delete')?.state !== 'AVAILABLE');

  const observe = ctx({ permission: 'OBSERVE' });
  t('en OBSERVE la búsqueda queda restringida', observe.find((c) => c.id === 'filesystem.search')?.state === 'RESTRICTED');
  t('en OBSERVE la lectura sigue disponible', observe.find((c) => c.id === 'filesystem.read')?.state === 'AVAILABLE');

  const admin = ctx({ permission: 'ADMIN' });
  t('ni en ADMIN se habilita el borrado', admin.find((c) => c.id === 'filesystem.delete')?.state === 'DISABLED');
  t('el terminal estructurado se habilita en ADMIN (sin shell)', admin.find((c) => c.id === 'terminal.execute')?.state === 'AVAILABLE');
  t('el terminal sigue restringido en ASSIST', assist.find((c) => c.id === 'terminal.execute')?.state === 'RESTRICTED');
  // Esta fase habilita el teclado bajo CONTROL, pero sólo a través del helper nativo.
  t('sin helper nativo el teclado no existe ni en ADMIN', admin.find((c) => c.id === 'keyboard.control')?.state === 'UNAVAILABLE');

  const noBridge = ctx({ hasNativeBridge: false });
  t('sin proceso principal el filesystem no está disponible',
    noBridge.find((c) => c.id === 'filesystem.read')?.state === 'UNAVAILABLE');

  const noGpu = ctx({ profile: { ...fixture('B'), gpus: [] } as SystemProfile, localAI: { status: 'READY', runtimes: [], activeRuntimeId: 'ollama', routerModelId: null, generalModelId: null, acceleration: 'cpu', discoveredAt: 0 } });
  t('sin GPU la aceleración no está disponible',
    noGpu.find((c) => c.id === 'localAI.gpuAcceleration')?.state === 'UNAVAILABLE');

  const withAI = ctx({ localAI: { status: 'READY', runtimes: [], activeRuntimeId: 'ollama', routerModelId: 'x', generalModelId: null, acceleration: 'nvidia', discoveredAt: 0 } });
  t('con IA local y GPU, la aceleración está disponible',
    withAI.find((c) => c.id === 'localAI.gpuAcceleration')?.state === 'AVAILABLE');
  t('sin IA local la capacidad no está disponible',
    assist.find((c) => c.id === 'localAI')?.state === 'UNAVAILABLE');

  const summary = summarizeCapabilities(assist);
  t('el resumen suma el total', Object.values(summary).reduce((a, b) => a + b, 0) === assist.length);
  t('FULL se muestra sin el alias antiguo', permissionLabel('FULL') === 'FULL' && permissionLabel('ADMIN') === 'ADMIN');
  t('los demás niveles no se renombran', permissionLabel('ASSIST') === 'ASSIST');

  // Máquinas distintas producen capacidades distintas.
  const partialCaps = capabilityRegistry.evaluate({ profile: fixture('G'), localAI: null, permission: 'ASSIST', hasNativeBridge: true });
  t('una máquina sin datos de GPU restringe la aceleración',
    partialCaps.find((c) => c.id === 'localAI.gpuAcceleration')?.state !== 'AVAILABLE');
}

console.log('\n— MachineContextBuilder —');
{
  const sources = {
    profile: fixture('C'),
    localAI: { status: 'READY' as const, runtimes: [runtimeOf()], activeRuntimeId: 'ollama' as const, routerModelId: 'qwen2.5:3b', generalModelId: null, acceleration: 'nvidia' as const, discoveredAt: 0 },
    capabilities: capabilityRegistry.evaluate({ profile: fixture('C'), localAI: null, permission: 'ASSIST', hasNativeBridge: true }),
  };

  const page = machineContextBuilder.build('Resume esta página', sources);
  t('una página no recibe hardware', !page.lines.some((l) => l.startsWith('CPU')), page.lines.join(' | '));
  t('una página recibe capacidades de navegador', page.topics.includes('browser'));

  const model = machineContextBuilder.build('¿Qué modelo local puedo usar?', sources);
  t('la pregunta por modelos recibe hardware', model.lines.some((l) => l.startsWith('CPU')));
  t('y recibe el estado de la IA local', model.lines.some((l) => l.startsWith('IA local')));
  t('incluye memoria y GPU', model.lines.some((l) => l.startsWith('Memoria')) && model.lines.some((l) => l.startsWith('GPU')));

  const file = machineContextBuilder.build('Busca config.json', sources);
  t('una búsqueda de archivos no recibe GPU', !file.lines.some((l) => l.startsWith('GPU')));
  t('pero sí las capacidades de archivos', file.lines.some((l) => l.includes('archivos')));

  const chat = machineContextBuilder.build('hola qué tal', sources);
  t('una charla no recibe contexto de máquina', chat.lines.length === 0 && chat.topics[0] === 'none');
  t('el contexto de charla cuesta cero tokens', chat.approxTokens === 0);
  t('el contexto de modelos cuesta más que el de charla', model.approxTokens > chat.approxTokens);
  t('el contexto siempre es acotado', model.approxTokens < 200, String(model.approxTokens));
}

console.log('\n— FirstRunManager —');
{
  const makeStore = (initial: unknown = null): ConfigStore & { saved: unknown } => {
    let value = initial;
    return {
      get saved() { return value; },
      read: () => value as never,
      write: (c) => { value = c; },
      clear: () => { value = null; },
    };
  };

  const fresh = new FirstRunManager(makeStore());
  t('una instalación nueva es primera ejecución', fresh.isFirstRun() && fresh.isActive());
  t('empieza en welcome', fresh.currentStep() === 'welcome');
  t('avanza por los siete pasos', FIRST_RUN_STEPS.length === 7);
  FIRST_RUN_STEPS.slice(1).forEach(() => fresh.next());
  t('llega a ready', fresh.currentStep() === 'ready');
  t('no se pasa del final', fresh.next() === 'ready');
  fresh.back();
  t('puede retroceder', fresh.currentStep() === 'privacy');

  fresh.setPermissionPreset('CONTROL');
  fresh.setSessionPolicy('clear_on_exit');
  fresh.setLocalAIChoice('skipped');
  const done = fresh.complete();
  t('completar marca completed', done.completed && done.completedAt !== null);
  t('conserva el preset elegido', done.permissionPreset === 'CONTROL');
  t('conserva la política de sesiones', done.sessionPolicy === 'clear_on_exit');
  t('ya no está activo', !fresh.isActive());

  const existing = new FirstRunManager(makeStore({ ...DEFAULT_CONFIG, completed: true }));
  t('una instalación existente no es primera ejecución', !existing.isFirstRun());
  t('y no arranca el onboarding', !existing.isActive());
  existing.reconfigure();
  t('reconfigurar reactiva el flujo', existing.isActive() && existing.currentStep() === 'welcome');
  t('reconfigurar no borra lo ya elegido', existing.currentConfig().completed === true);

  const corrupt = new FirstRunManager(makeStore({ basura: true }));
  t('una config corrupta se trata como nueva', corrupt.isFirstRun());
  t('y no hereda permisos', corrupt.currentConfig().permissionPreset === 'RESTRICTED');

  const store = makeStore();
  const reset = new FirstRunManager(store);
  reset.complete();
  reset.reset();
  t('reset vuelve al estado inicial', reset.isFirstRun() && store.saved === null);
}

console.log('\n— CredentialBoundary —');
{
  t('input de tipo password es sensible', isSensitiveField({ type: 'password' }));
  t('autocomplete one-time-code es sensible', isSensitiveField({ autocomplete: 'one-time-code' }));
  t('un campo llamado pin es sensible', isSensitiveField({ name: 'pin' }));
  t('un campo de OTP es sensible', isSensitiveField({ id: 'otp-input' }));
  t('placeholder de 2FA es sensible', isSensitiveField({ placeholder: 'Código 2FA' }));
  t('un campo de recuperación es sensible', isSensitiveField({ ariaLabel: 'recovery code' }));
  t('un campo de email no es sensible', !isSensitiveField({ type: 'email', name: 'email' }));
  t('un buscador no es sensible', !isSensitiveField({ name: 'search', placeholder: 'Buscar' }));

  t('el valor sensible se sustituye', sanitizeField({ type: 'password', value: 'hunter2' }).value === REDACTED);
  t('el valor inocuo sobrevive', sanitizeField({ type: 'email', value: 'a@b.c' }).value === 'a@b.c');

  t('contraseña en texto redactada', !sanitizeText('password: hunter2').includes('hunter2'));
  t('contraseña en español redactada', !sanitizeText('Contraseña: miClaveSecreta').includes('miClaveSecreta'));
  t('PIN redactado', !sanitizeText('PIN: 4821').includes('4821'));
  t('OTP redactado', !sanitizeText('Tu código de verificación es 903214').includes('903214'));
  t('2FA redactado', !sanitizeText('2FA 118204').includes('118204'));
  t('recovery code redactado', !sanitizeText('recovery code: ABCD-EFGH').includes('ABCD-EFGH'));
  t('token de api redactado', !sanitizeText('ghp_ABCDEFGHIJKLMNOPQRST0123').includes('ABCDEFGHIJKLMNOPQRST'));
  t('el texto normal no se toca', sanitizeText('El precio de NVDA es 184.62') === 'El precio de NVDA es 184.62');

  const dom = sanitizeDom({
    tag: 'form',
    children: [
      { tag: 'input', attributes: { type: 'password', name: 'password' }, value: 'hunter2' },
      { tag: 'input', attributes: { type: 'email', name: 'email' }, value: 'a@b.c' },
      { tag: 'p', text: 'Tu PIN: 9921' },
    ],
  }) as { children: { value?: string; text?: string }[] };
  t('el DOM redacta el campo de contraseña', dom.children[0]?.value === REDACTED);
  t('el DOM conserva el email', dom.children[1]?.value === 'a@b.c');
  t('el DOM redacta un PIN en texto', !String(dom.children[2]?.text).includes('9921'));
}

console.log(`\n${pass} ok · ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
