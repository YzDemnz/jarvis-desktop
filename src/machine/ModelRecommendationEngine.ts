import type {
  Acceleration, BenchmarkResult, ExpectedPerformance, InstalledModel, LocalModelEntry,
  ModelCompatibility, ModelRecommendation, ResourceBudget, RuntimeDetection, SystemProfile,
} from '@/types';
import { LOCAL_MODEL_CATALOG, matchInstalled } from './catalog/localModelCatalog';
import { calculateBudget } from './ResourceBudgetCalculator';
import { pickBestGPU } from './performance';

export interface RecommendationInput {
  profile: SystemProfile;
  runtimes: RuntimeDetection[];
  catalog?: LocalModelEntry[];
  /** Measured results beat estimates when present. */
  benchmarks?: BenchmarkResult[];
}

/**
 * A GPU being present says nothing about which backend can use it. Vendor and
 * driver decide; anything unclear falls back to CPU rather than promising
 * acceleration the machine may not deliver.
 */
export function detectAcceleration(profile: SystemProfile): Acceleration {
  const gpu = pickBestGPU(profile);
  if (!gpu) return 'cpu';
  if (gpu.dedicated === false && gpu.vendor !== 'apple') {
    return gpu.vendor === 'intel' ? 'intel' : 'cpu';
  }
  switch (gpu.vendor) {
    case 'nvidia': return gpu.driverVersion === null ? 'unknown' : 'nvidia';
    case 'amd': return 'amd';
    case 'apple': return 'metal';
    case 'intel': return 'intel';
    default: return 'unknown';
  }
}

/** Can this model actually run here, with margin? */
export function checkCompatibility(
  model: LocalModelEntry,
  profile: SystemProfile,
  budget: ResourceBudget,
  acceleration: Acceleration,
): ModelCompatibility {
  const reasons: string[] = [];
  const arch = profile.cpu.architecture || profile.os.architecture;

  const archOk = model.supportedArchitecture.includes(arch);
  if (!archOk) reasons.push(`No hay build para ${arch}.`);

  const osOk = model.supportedOS.includes(profile.os.platform);
  if (!osOk) reasons.push(`No está soportado en ${profile.os.platform}.`);

  const fitsRam = budget.safeAIRamBytes >= model.estimatedRamBytes;
  if (!fitsRam) reasons.push('No cabe en la memoria disponible dejando margen al sistema.');

  const fitsDisk = budget.freeDiskBytes === null
    ? false
    : budget.safeDiskBytes >= model.diskBytes;
  if (!fitsDisk) {
    reasons.push(budget.freeDiskBytes === null
      ? 'No se pudo comprobar el espacio libre.'
      : 'No hay espacio en disco con margen suficiente.');
  }

  // GPU offload is a bonus, never a requirement: everything can fall back to CPU.
  const accelSupported = model.supportedAcceleration.includes(acceleration);
  const fitsVram = acceleration !== 'cpu' && acceleration !== 'unknown'
    && accelSupported
    && budget.safeAIVramBytes >= model.estimatedVramBytes
    && model.estimatedVramBytes > 0;
  if (!fitsVram && acceleration !== 'cpu') {
    reasons.push(accelSupported
      ? 'No cabe entero en la VRAM; se repartirá con la CPU.'
      : `El backend ${acceleration} no está soportado por este modelo.`);
  }

  const hardFail = !archOk || !osOk || !fitsRam || !fitsDisk;
  const tight = !hardFail && (
    budget.safeAIRamBytes < model.estimatedRamBytes * 1.25
    || (budget.freeDiskBytes !== null && budget.safeDiskBytes < model.diskBytes * 1.3)
  );
  if (tight) reasons.push('Entra, pero con poco margen.');

  return {
    modelId: model.id,
    verdict: hardFail ? 'incompatible' : tight ? 'tight' : 'compatible',
    fitsRam, fitsVram, fitsDisk,
    acceleration: fitsVram ? acceleration : 'cpu',
    reasons,
  };
}

function expectedFor(
  model: LocalModelEntry,
  compat: ModelCompatibility,
  acceleration: Acceleration,
): ExpectedPerformance {
  if (compat.verdict === 'incompatible') return 'NOT_RECOMMENDED';
  const gpu = compat.fitsVram && acceleration !== 'cpu' && acceleration !== 'unknown';
  if (gpu) return model.parametersB <= 8 ? 'EXCELLENT' : 'GOOD';
  if (model.parametersB <= 1) return 'GOOD';
  if (model.parametersB <= 4) return compat.verdict === 'tight' ? 'USABLE' : 'GOOD';
  if (model.parametersB <= 8) return compat.verdict === 'tight' ? 'SLOW' : 'USABLE';
  return 'SLOW';
}

const PERFORMANCE_RANK: Record<ExpectedPerformance, number> = {
  EXCELLENT: 4, GOOD: 3, USABLE: 2, SLOW: 1, NOT_RECOMMENDED: 0,
};

/**
 * Picks a router and, separately, a general model. They are different jobs: the
 * router needs to answer fast and emit valid JSON every time, which a small
 * model does better than a large slow one. Raw capability is the wrong metric
 * for it, so routerScore and structured-output reliability dominate.
 */
export function recommendModels(input: RecommendationInput): ModelRecommendation {
  const { profile, runtimes } = input;
  const catalog = input.catalog ?? LOCAL_MODEL_CATALOG;
  const budget = calculateBudget(profile);
  const acceleration = detectAcceleration(profile);

  const available = runtimes.filter((r) => r.detected);
  const runtimeId = available.find((r) => r.status === 'READY')?.runtimeId
    ?? available[0]?.runtimeId
    ?? null;

  const usable = runtimeId ? catalog.filter((m) => m.runtimes.includes(runtimeId)) : catalog;
  const compatibility = usable.map((m) => checkCompatibility(m, profile, budget, acceleration));
  const byId = new Map(compatibility.map((c) => [c.modelId, c]));
  const viable = usable.filter((m) => byId.get(m.id)?.verdict !== 'incompatible');

  // Anything already on disk costs nothing to adopt.
  const installed = available.flatMap((r) => r.models);
  const installedEntries = dedupe(installed
    .map((m) => matchInstalled(m.name))
    .filter((m): m is LocalModelEntry => m !== null)
    .filter((m) => byId.get(m.id)?.verdict !== 'incompatible'));

  const benchmarkPenalty = (m: LocalModelEntry) => {
    const bench = input.benchmarks?.find((b) => b.modelId === m.id);
    if (!bench || bench.cancelled) return 0;
    // Measured reality overrides the estimate, in both directions.
    if (!bench.structuredOutputSuccess) return -45;
    if (bench.rating === 'NOT_RECOMMENDED') return -60;
    if (bench.rating === 'SLOW') return -30;
    if (bench.rating === 'EXCELLENT') return 15;
    if (bench.rating === 'GOOD') return 8;
    return 0;
  };

  const routerRank = (m: LocalModelEntry) => {
    const compat = byId.get(m.id);
    const tightPenalty = compat?.verdict === 'tight' ? -12 : 0;
    const installedBonus = installedEntries.some((x) => x.id === m.id) ? 20 : 0;
    const vramBonus = compat?.fitsVram ? 10 : 0;
    return m.routerScore + m.structuredOutput * 25 + m.toolRouting * 15
      + tightPenalty + installedBonus + vramBonus + benchmarkPenalty(m);
  };

  const routerPool = installedEntries.length ? installedEntries : viable;
  const router = [...routerPool].sort((a, b) => routerRank(b) - routerRank(a))[0] ?? null;

  const generalRank = (m: LocalModelEntry) => {
    const compat = byId.get(m.id);
    const tightPenalty = compat?.verdict === 'tight' ? -0.25 : 0;
    const installedBonus = installedEntries.some((x) => x.id === m.id) ? 0.2 : 0;
    return m.reasoning + m.coding * 0.5 + tightPenalty + installedBonus + benchmarkPenalty(m) / 100;
  };
  const generalPool = installedEntries.length ? installedEntries : viable;
  const generalModel = [...generalPool].sort((a, b) => generalRank(b) - generalRank(a))[0] ?? null;

  const routerCompat = router ? byId.get(router.id) ?? null : null;
  let expectedPerformance: ExpectedPerformance = 'NOT_RECOMMENDED';
  if (router && routerCompat) {
    expectedPerformance = expectedFor(router, routerCompat, acceleration);
    const bench = input.benchmarks?.find((b) => b.modelId === router.id && !b.cancelled);
    if (bench) {
      // Observed beats theoretical, and only ever downgrades silently.
      const observed = bench.rating as ExpectedPerformance;
      if (PERFORMANCE_RANK[observed] < PERFORMANCE_RANK[expectedPerformance]) expectedPerformance = observed;
    }
  }

  const alternatives = viable
    .filter((m) => m.id !== router?.id && m.id !== generalModel?.id)
    .sort((a, b) => routerRank(b) - routerRank(a))
    .slice(0, 4);

  return {
    router,
    generalModel: generalModel && generalModel.id === router?.id && viable.length > 1
      ? [...generalPool].sort((a, b) => generalRank(b) - generalRank(a))[1] ?? generalModel
      : generalModel,
    runtimeId,
    acceleration: routerCompat?.fitsVram ? acceleration : 'cpu',
    expectedPerformance,
    alternatives,
    compatibility,
    budget,
    alreadyInstalled: Boolean(router && installedEntries.some((m) => m.id === router.id)),
    reason: buildReason(router, runtimeId, acceleration, budget, viable.length),
  };
}

function buildReason(
  router: LocalModelEntry | null,
  runtimeId: string | null,
  acceleration: Acceleration,
  budget: ResourceBudget,
  viableCount: number,
): string {
  if (!runtimeId) return 'No se detectó ningún runtime local instalado.';
  if (!router) {
    return viableCount === 0
      ? 'Ningún modelo del catálogo cabe en este equipo dejando margen al sistema.'
      : 'No hay un modelo adecuado para este equipo.';
  }
  const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
  const accel = acceleration === 'cpu' ? 'CPU' : acceleration.toUpperCase();
  return `Elegido por fiabilidad de salida estructurada y latencia, con ${gb(budget.safeAIRamBytes)} de memoria utilizable y aceleración ${accel}.`;
}

function dedupe(models: LocalModelEntry[]): LocalModelEntry[] {
  const seen = new Set<string>();
  return models.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

export function installedSummary(runtimes: RuntimeDetection[]): InstalledModel[] {
  return runtimes.filter((r) => r.detected).flatMap((r) => r.models);
}
