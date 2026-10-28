import type { CPUInfo, GPUInfo, MemoryInfo, OSInfo, PowerInfo, StorageInfo } from '../../../src/types';

/**
 * One adapter per platform. Every method resolves; a value the OS will not
 * give comes back as null and is recorded in `unavailable`, never guessed.
 */
export interface HardwareAdapter {
  readonly id: 'windows' | 'linux' | 'darwin' | 'mock';
  os(): Promise<OSInfo>;
  cpu(): Promise<CPUInfo>;
  memory(): Promise<MemoryInfo>;
  gpus(): Promise<GPUInfo[]>;
  storage(): Promise<StorageInfo[]>;
  power(): Promise<PowerInfo>;
}

export function missingFields(source: Record<string, unknown>, prefix: string): string[] {
  return Object.entries(source)
    .filter(([, value]) => value === null)
    .map(([key]) => `${prefix}.${key}`);
}
