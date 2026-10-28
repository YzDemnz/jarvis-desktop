import type { MachinePerformanceProfile, MachinePerformanceTier, SystemProfile } from '@/types';

const GB = 1024 ** 3;

/** Maps a value onto 0–100 through a set of thresholds. */
function band(value: number | null, steps: [number, number][]): number {
  if (value === null || !Number.isFinite(value)) return 0;
  let score = 0;
  for (const [threshold, points] of steps) {
    if (value >= threshold) score = points;
  }
  return score;
}

/**
 * Weighted profile. RAM alone is a bad proxy: a 32 GB machine with four slow
 * cores and no GPU is not a strong machine for local inference, and a 16 GB
 * laptop with 8 GB of VRAM often is. Every axis contributes, and an axis the
 * OS could not report scores zero rather than being guessed.
 */
export function computePerformanceProfile(profile: SystemProfile): MachinePerformanceProfile {
  const notes: string[] = [];

  const threads = profile.cpu.logicalThreads;
  const cpuBase = band(threads, [[2, 15], [4, 30], [6, 45], [8, 60], [12, 75], [16, 88], [24, 100]]);
  const clock = profile.cpu.maxClockMHz ?? profile.cpu.baseClockMHz;
  const clockBonus = clock === null ? 0 : clock >= 4000 ? 10 : clock >= 3000 ? 5 : clock < 2000 ? -10 : 0;
  const cpu = Math.max(0, Math.min(100, cpuBase + clockBonus));
  if (threads === null) notes.push('No se pudo leer el número de hilos de CPU.');

  const ramGB = profile.memory.totalBytes === null ? null : profile.memory.totalBytes / GB;
  const memory = band(ramGB, [[4, 10], [8, 30], [16, 55], [24, 70], [32, 85], [64, 100]]);
  if (ramGB !== null && ramGB < 8) notes.push('La memoria disponible limita el tamaño de los modelos locales.');

  const best = pickBestGPU(profile);
  const gpu = best === null ? 0
    : best.vendor === 'nvidia' ? 85
    : best.vendor === 'amd' ? 65
    : best.vendor === 'apple' ? 80
    : best.vendor === 'intel' ? 35
    : 25;
  if (!profile.gpus.length) notes.push('No se detectó ninguna GPU.');

  const vramGB = best?.vramBytes == null ? null : best.vramBytes / GB;
  const vram = band(vramGB, [[2, 20], [4, 40], [6, 55], [8, 70], [12, 85], [16, 95], [24, 100]]);
  if (best && best.vramBytes === null) notes.push('La VRAM no pudo determinarse; se asumirá inferencia por CPU.');

  const freeGB = totalFreeDisk(profile);
  const storage = band(freeGB, [[10, 15], [25, 35], [50, 55], [100, 75], [250, 90], [500, 100]]);
  if (freeGB !== null && freeGB < 20) notes.push('Queda poco espacio libre para descargar modelos.');

  const arch = profile.cpu.architecture || profile.os.architecture;
  const architecture = arch === 'x64' || arch === 'arm64' ? 100 : arch === 'ia32' ? 30 : 60;
  if (architecture < 60) notes.push('La arquitectura limita los runtimes disponibles.');

  const breakdown = { cpu, memory, gpu, vram, storage, architecture };
  const score = Math.round(
    cpu * 0.24 + memory * 0.26 + gpu * 0.16 + vram * 0.22 + storage * 0.06 + architecture * 0.06,
  );

  return { tier: tierFor(score), score, breakdown, notes };
}

export function tierFor(score: number): MachinePerformanceTier {
  if (score >= 82) return 'EXTREME';
  if (score >= 65) return 'HIGH';
  if (score >= 45) return 'BALANCED';
  if (score >= 27) return 'LOW';
  return 'VERY_LOW';
}

/** Dedicated beats integrated; among equals, more VRAM wins. */
export function pickBestGPU(profile: SystemProfile): SystemProfile['gpus'][number] | null {
  if (!profile.gpus.length) return null;
  const rank = (g: SystemProfile['gpus'][number]) =>
    (g.dedicated === true ? 1000 : g.dedicated === false ? 0 : 400) +
    (g.vendor === 'nvidia' ? 300 : g.vendor === 'amd' ? 200 : g.vendor === 'apple' ? 250 : g.vendor === 'intel' ? 50 : 10) +
    (g.vramBytes ?? 0) / GB;
  return [...profile.gpus].sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

export function totalFreeDisk(profile: SystemProfile): number | null {
  const known = profile.storage.filter((d) => d.freeBytes !== null);
  if (!known.length) return null;
  return known.reduce((a, d) => a + (d.freeBytes ?? 0), 0) / GB;
}

/** Neutral wording for the UI. The tier name itself never reaches the user. */
export function performanceWording(tier: MachinePerformanceTier): string {
  switch (tier) {
    case 'EXTREME': return 'Este equipo puede con modelos locales grandes.';
    case 'HIGH': return 'Este equipo puede con modelos locales exigentes.';
    case 'BALANCED': return 'Este equipo funciona bien con modelos locales medianos.';
    case 'LOW': return 'Este equipo rinde mejor con modelos locales ligeros.';
    case 'VERY_LOW': return 'Este equipo rinde mejor con modelos locales muy pequeños.';
  }
}
