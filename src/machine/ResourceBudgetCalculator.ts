import type { ResourceBudget, SystemProfile } from '@/types';
import { pickBestGPU, totalFreeDisk } from './performance';

const GB = 1024 ** 3;

/**
 * Reserves are rules, not magic numbers, so they can be tuned in one place.
 * They scale with the machine: an 8 GB laptop cannot give up 8 GB to Windows,
 * and a 128 GB workstation should not hand everything to a model either.
 */
export interface BudgetRules {
  /** Fraction of RAM reserved for the OS, floored and capped. */
  systemReserveRatio: number;
  systemReserveMinBytes: number;
  systemReserveMaxBytes: number;
  /** Electron + Chromium + JARVIS itself. Grows a little with tab count. */
  appReserveBytes: number;
  /** Never hand the last slice of RAM to a model. */
  aiRamCeilingRatio: number;
  /** Desktop compositor and Chromium need VRAM too. */
  vramReserveBytes: number;
  vramReserveRatio: number;
  /** Leave the disk breathing room after a download. */
  diskReserveBytes: number;
}

export const DEFAULT_BUDGET_RULES: BudgetRules = {
  systemReserveRatio: 0.22,
  systemReserveMinBytes: 2 * GB,
  systemReserveMaxBytes: 10 * GB,
  appReserveBytes: 4 * GB,
  aiRamCeilingRatio: 0.7,
  vramReserveBytes: 1 * GB,
  vramReserveRatio: 0.15,
  diskReserveBytes: 15 * GB,
};

/**
 * Answers "how much can local AI take without making the computer unpleasant
 * to use". The point is the margin: a model that fits with 200 MB to spare
 * does not fit.
 */
export function calculateBudget(
  profile: SystemProfile,
  rules: BudgetRules = DEFAULT_BUDGET_RULES,
): ResourceBudget {
  const notes: string[] = [];
  const totalRam = profile.memory.totalBytes;

  let systemReserve = rules.systemReserveMinBytes;
  let appReserve = rules.appReserveBytes;
  let safeAIRam = 0;

  if (totalRam === null) {
    notes.push('No se pudo leer la memoria total; se asume el presupuesto mínimo.');
  } else {
    systemReserve = Math.min(
      rules.systemReserveMaxBytes,
      Math.max(rules.systemReserveMinBytes, totalRam * rules.systemReserveRatio),
    );
    // On small machines the fixed app reserve would eat everything, so it
    // shrinks with the machine rather than starving the model outright.
    appReserve = Math.min(rules.appReserveBytes, Math.max(1 * GB, totalRam * 0.18));
    const remaining = totalRam - systemReserve - appReserve;
    safeAIRam = Math.max(0, Math.min(remaining, totalRam * rules.aiRamCeilingRatio));
    if (safeAIRam < 2 * GB) notes.push('Queda muy poca memoria para ejecutar un modelo local.');
  }

  const gpu = pickBestGPU(profile);
  const totalVram = gpu?.vramBytes ?? null;
  let vramReserve = rules.vramReserveBytes;
  let safeAIVram = 0;

  if (totalVram === null) {
    notes.push('No hay información de VRAM; se planifica sobre CPU.');
  } else {
    vramReserve = Math.max(rules.vramReserveBytes, totalVram * rules.vramReserveRatio);
    safeAIVram = Math.max(0, totalVram - vramReserve);
    if (safeAIVram < 2 * GB) notes.push('La VRAM disponible no da para descargar un modelo completo en GPU.');
  }

  const freeDiskGB = totalFreeDisk(profile);
  const freeDisk = freeDiskGB === null ? null : freeDiskGB * GB;
  const safeDisk = freeDisk === null ? 0 : Math.max(0, freeDisk - rules.diskReserveBytes);
  if (freeDisk !== null && safeDisk <= 0) notes.push('No hay espacio suficiente para descargar modelos nuevos.');

  return {
    totalRamBytes: totalRam,
    systemReserveBytes: Math.round(systemReserve),
    appReserveBytes: Math.round(appReserve),
    safeAIRamBytes: Math.round(safeAIRam),
    totalVramBytes: totalVram,
    vramReserveBytes: Math.round(vramReserve),
    safeAIVramBytes: Math.round(safeAIVram),
    freeDiskBytes: freeDisk,
    safeDiskBytes: Math.round(safeDisk),
    notes,
  };
}

/** V2 keeps the conservative total-capacity budget and additionally bounds it by live free resources. */
export function calculateBudgetV2(profile: SystemProfile, observation: { ramFreeBytes: number | null; vramFreeBytes: number | null; storageFreeBytes: number | null; otherLoadBytes: number | null }): ResourceBudget {
  const base = calculateBudget(profile);
  const ramFree = observation.ramFreeBytes ?? profile.memory.availableBytes;
  const vramFree = observation.vramFreeBytes;
  const storageFree = observation.storageFreeBytes ?? base.freeDiskBytes;
  return { ...base,
    safeAIRamBytes: ramFree === null ? 0 : Math.max(0, Math.min(base.safeAIRamBytes, ramFree - (observation.otherLoadBytes ?? 0) - Math.max(512 * 1024 ** 2, base.systemReserveBytes * 0.25))),
    safeAIVramBytes: vramFree === null ? 0 : Math.max(0, Math.min(base.safeAIVramBytes, vramFree - base.vramReserveBytes)),
    freeDiskBytes: storageFree,
    safeDiskBytes: storageFree === null ? 0 : Math.max(0, Math.min(base.safeDiskBytes, storageFree - DEFAULT_BUDGET_RULES.diskReserveBytes)),
    notes: [...base.notes, ...(ramFree === null ? ['RAM libre no medida; no recomendar modelo automáticamente.'] : []),
      ...(vramFree === null ? ['VRAM libre no medida; no recomendar offload automáticamente.'] : [])],
  };
}
