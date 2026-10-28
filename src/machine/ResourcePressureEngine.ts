import type { SystemProfile } from '@/types';
import { calculateBudget } from './ResourceBudgetCalculator';

export type PerformanceProfile = 'LOW' | 'MEDIUM' | 'MAX' | 'CUSTOM';
export function resolvePerformanceProfile(requested: PerformanceProfile, developerMode: boolean): PerformanceProfile {
  if (requested === 'CUSTOM' && !developerMode) throw new Error('CUSTOM requires Developer Mode');
  return requested;
}
export type ResourcePressure = 'MINIMAL' | 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH' | 'UNSAFE';
export interface LocalModelConfiguration {
  modelId: string; runtimeId: string; quantization: string; contextTokens: number;
  gpuOffloadLayers: number; threads: number; kvCache: 'F16' | 'Q8_0' | 'Q4_0'; batchSize: number;
}
export interface ResourceObservation {
  ramFreeBytes: number | null; vramFreeBytes: number | null; sharedGpuFreeBytes: number | null;
  cpuUtilization: number | null; gpuUtilization: number | null; thermalCelsius: number | null;
  onBattery: boolean | null; freeStorageBytes: number | null; otherLoadBytes: number | null;
}
export interface PressureAssessment { level: ResourcePressure; automatic: boolean; reasons: string[]; headroomRamBytes: number | null; headroomVramBytes: number | null; }
export interface ModelDemand { ramBytes: number; vramBytes: number; diskBytes: number; cpuThreads: number; }

/** Uses live free memory when known. Unknown GPU data cannot be treated as free VRAM. */
export class ResourcePressureEngine {
  assess(profile: SystemProfile, observation: ResourceObservation, demand: ModelDemand): PressureAssessment {
    const budget = calculateBudget(profile);
    const ramFree = observation.ramFreeBytes ?? profile.memory.availableBytes;
    const vramFree = observation.vramFreeBytes;
    const diskFree = observation.freeStorageBytes ?? budget.freeDiskBytes;
    const ramHeadroom = ramFree === null ? null : ramFree - demand.ramBytes - (observation.otherLoadBytes ?? 0) - Math.max(512 * 1024 ** 2, budget.systemReserveBytes * 0.25);
    const vramHeadroom = demand.vramBytes === 0 ? null : vramFree === null ? null : vramFree - demand.vramBytes - budget.vramReserveBytes;
    const reasons: string[] = [];
    if (ramHeadroom === null) reasons.push('RAM libre desconocida');
    if (demand.vramBytes > 0 && vramHeadroom === null) reasons.push('VRAM libre desconocida');
    if (diskFree !== null && demand.diskBytes > diskFree - 2 * 1024 ** 3) reasons.push('espacio insuficiente');
    if (ramHeadroom !== null && ramHeadroom < 0) reasons.push('RAM insuficiente');
    if (vramHeadroom !== null && vramHeadroom < 0) reasons.push('VRAM insuficiente');
    if (observation.thermalCelsius !== null && observation.thermalCelsius >= 90) reasons.push('temperatura alta');
    if (observation.cpuUtilization !== null && observation.cpuUtilization >= 95) reasons.push('CPU saturada');
    if (profile.cpu.logicalThreads !== null && demand.cpuThreads > profile.cpu.logicalThreads) reasons.push('hilos CPU insuficientes');
    if (observation.onBattery === true) reasons.push('equipo en batería');
    if (observation.sharedGpuFreeBytes !== null && demand.vramBytes > 0 && vramFree === null) reasons.push('sólo memoria GPU compartida medida');
    const unsafe = reasons.some((r) => ['espacio insuficiente', 'RAM insuficiente', 'VRAM insuficiente', 'temperatura alta', 'hilos CPU insuficientes'].includes(r));
    if (unsafe) return { level: 'UNSAFE', automatic: false, reasons, headroomRamBytes: ramHeadroom, headroomVramBytes: vramHeadroom };
    const ratio = ramFree && ramHeadroom !== null ? ramHeadroom / ramFree : 0.25;
    const level: ResourcePressure = ratio < 0.12 ? 'VERY_HIGH' : ratio < 0.25 ? 'HIGH' : ratio < 0.45 ? 'MODERATE' : ratio < 0.7 ? 'LOW' : 'MINIMAL';
    return { level, automatic: ramHeadroom !== null && (demand.vramBytes === 0 || vramHeadroom !== null), reasons, headroomRamBytes: ramHeadroom, headroomVramBytes: vramHeadroom };
  }
}

export function validateModelConfiguration(config: LocalModelConfiguration, profile: SystemProfile, developerMode: boolean): void {
  if (!config.modelId || !config.runtimeId || !config.quantization) throw new Error('Incomplete model configuration');
  if (![config.contextTokens, config.gpuOffloadLayers, config.threads, config.batchSize].every(Number.isInteger)) throw new Error('Invalid model configuration');
  if (config.contextTokens < 512 || config.contextTokens > 262144 || config.gpuOffloadLayers < 0 || config.gpuOffloadLayers > 999 || config.batchSize < 1 || config.batchSize > 8192) throw new Error('Unsafe model configuration');
  if (config.threads < 1 || config.threads > (profile.cpu.logicalThreads ?? 256)) throw new Error('Thread count exceeds hardware');
  if (config.kvCache !== 'F16' && !developerMode) throw new Error('Experimental KV cache requires Developer Mode');
}
