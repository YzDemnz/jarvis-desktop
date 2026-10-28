import type { SystemProfile } from '@/types';

const GB = 1024 ** 3;

function base(overrides: Partial<SystemProfile>): SystemProfile {
  return {
    os: { platform: 'win32', name: 'Windows 11 Pro', version: '10.0.22631', build: '22631', architecture: 'x64' },
    cpu: {
      manufacturer: 'Intel', model: 'Intel Core i5-10400', physicalCores: 6, logicalThreads: 12,
      baseClockMHz: 2900, maxClockMHz: 4300, architecture: 'x64', features: ['avx2'],
    },
    memory: { totalBytes: 16 * GB, availableBytes: 9 * GB, usedBytes: 7 * GB },
    gpus: [],
    storage: [{ path: 'C:\\', label: 'Sistema', totalBytes: 512 * GB, freeBytes: 200 * GB, filesystem: 'NTFS', kind: 'nvme' }],
    displays: [{ id: 'd1', width: 1920, height: 1080, scaleFactor: 1, primary: true }],
    power: { batteryPresent: false, onAC: true, batteryPercent: null },
    source: 'mock',
    collectedAt: 0,
    unavailable: [],
    ...overrides,
  };
}

/**
 * Eight machines that exercise the decision space, not eight named special
 * cases: nothing in the engine may branch on these ids. They exist so the
 * recommendation logic can be proven against low RAM, absent VRAM, multiple
 * GPUs, ARM and a nearly full disk without owning eight computers.
 */
export const MACHINE_FIXTURES: Record<string, SystemProfile> = {
  /** A: entry laptop. 8 GB, integrated graphics, small disk. */
  A: base({
    cpu: { manufacturer: 'Intel', model: 'Intel Core i3-1115G4', physicalCores: 2, logicalThreads: 4, baseClockMHz: 3000, maxClockMHz: 4100, architecture: 'x64', features: ['avx2'] },
    memory: { totalBytes: 8 * GB, availableBytes: 3 * GB, usedBytes: 5 * GB },
    gpus: [{ vendor: 'intel', model: 'Intel UHD Graphics', dedicated: false, vramBytes: null, driverVersion: '31.0.101' }],
    storage: [{ path: 'C:\\', label: 'Sistema', totalBytes: 256 * GB, freeBytes: 38 * GB, filesystem: 'NTFS', kind: 'ssd' }],
    power: { batteryPresent: true, onAC: false, batteryPercent: 62 },
    unavailable: ['gpu.vramBytes'],
  }),

  /** B: mainstream desktop. 16 GB, midrange dedicated GPU. */
  B: base({
    gpus: [{ vendor: 'nvidia', model: 'NVIDIA GeForce RTX 3060', dedicated: true, vramBytes: 6 * GB, driverVersion: '551.23' }],
  }),

  /** C: workstation. 32 GB, 8 GB VRAM. */
  C: base({
    cpu: { manufacturer: 'AMD', model: 'AMD Ryzen 7 5800X', physicalCores: 8, logicalThreads: 16, baseClockMHz: 3800, maxClockMHz: 4700, architecture: 'x64', features: ['avx2'] },
    memory: { totalBytes: 32 * GB, availableBytes: 21 * GB, usedBytes: 11 * GB },
    gpus: [{ vendor: 'nvidia', model: 'NVIDIA GeForce RTX 3070', dedicated: true, vramBytes: 8 * GB, driverVersion: '551.23' }],
    storage: [{ path: 'C:\\', label: 'Sistema', totalBytes: 1024 * GB, freeBytes: 620 * GB, filesystem: 'NTFS', kind: 'nvme' }],
  }),

  /** D: high end. 64 GB, 24 GB VRAM. */
  D: base({
    cpu: { manufacturer: 'AMD', model: 'AMD Ryzen 9 7950X', physicalCores: 16, logicalThreads: 32, baseClockMHz: 4500, maxClockMHz: 5700, architecture: 'x64', features: ['avx2', 'avx512'] },
    memory: { totalBytes: 64 * GB, availableBytes: 48 * GB, usedBytes: 16 * GB },
    gpus: [{ vendor: 'nvidia', model: 'NVIDIA GeForce RTX 4090', dedicated: true, vramBytes: 24 * GB, driverVersion: '552.12' }],
    storage: [{ path: 'C:\\', label: 'Sistema', totalBytes: 2048 * GB, freeBytes: 1400 * GB, filesystem: 'NTFS', kind: 'nvme' }],
  }),

  /** E: ARM. Different architecture, unified memory. */
  E: base({
    os: { platform: 'win32', name: 'Windows 11 on ARM', version: '10.0.22631', build: '22631', architecture: 'arm64' },
    cpu: { manufacturer: 'Qualcomm', model: 'Snapdragon X Elite', physicalCores: 12, logicalThreads: 12, baseClockMHz: 3400, maxClockMHz: 4000, architecture: 'arm64', features: ['neon'] },
    memory: { totalBytes: 16 * GB, availableBytes: 10 * GB, usedBytes: 6 * GB },
    gpus: [{ vendor: 'other', model: 'Qualcomm Adreno X1', dedicated: false, vramBytes: null, driverVersion: null }],
    power: { batteryPresent: true, onAC: true, batteryPercent: 90 },
    unavailable: ['gpu.vramBytes', 'gpu.driverVersion'],
  }),

  /** F: two GPUs, integrated plus dedicated. */
  F: base({
    memory: { totalBytes: 32 * GB, availableBytes: 20 * GB, usedBytes: 12 * GB },
    gpus: [
      { vendor: 'intel', model: 'Intel Iris Xe Graphics', dedicated: false, vramBytes: null, driverVersion: '31.0.101' },
      { vendor: 'nvidia', model: 'NVIDIA GeForce RTX 4070 Laptop', dedicated: true, vramBytes: 8 * GB, driverVersion: '552.12' },
    ],
    power: { batteryPresent: true, onAC: true, batteryPercent: 100 },
  }),

  /** G: the OS reports almost nothing about the graphics stack. */
  G: base({
    cpu: { manufacturer: null, model: null, physicalCores: null, logicalThreads: 8, baseClockMHz: null, maxClockMHz: null, architecture: 'x64', features: [] },
    gpus: [{ vendor: 'unknown', model: null, dedicated: null, vramBytes: null, driverVersion: null }],
    storage: [{ path: 'C:\\', label: null, totalBytes: null, freeBytes: null, filesystem: null, kind: 'unknown' }],
    source: 'partial',
    unavailable: ['cpu.model', 'cpu.manufacturer', 'cpu.physicalCores', 'gpu.model', 'gpu.vramBytes', 'storage.freeBytes'],
  }),

  /** H: capable machine, but the disk is nearly full. */
  H: base({
    memory: { totalBytes: 32 * GB, availableBytes: 18 * GB, usedBytes: 14 * GB },
    gpus: [{ vendor: 'nvidia', model: 'NVIDIA GeForce RTX 3060', dedicated: true, vramBytes: 12 * GB, driverVersion: '551.23' }],
    storage: [{ path: 'C:\\', label: 'Sistema', totalBytes: 512 * GB, freeBytes: 6 * GB, filesystem: 'NTFS', kind: 'ssd' }],
  }),
};

export function fixture(id: keyof typeof MACHINE_FIXTURES): SystemProfile {
  const found = MACHINE_FIXTURES[id];
  if (!found) throw new Error(`Fixture desconocida: ${String(id)}`);
  return { ...found, collectedAt: Date.now() };
}

export const FIXTURE_IDS = Object.keys(MACHINE_FIXTURES);
