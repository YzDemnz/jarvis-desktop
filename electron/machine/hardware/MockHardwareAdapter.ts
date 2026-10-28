import type { CPUInfo, GPUInfo, MemoryInfo, OSInfo, PowerInfo, StorageInfo, SystemProfile } from '../../../src/types';
import type { HardwareAdapter } from './HardwareAdapter';
import { MACHINE_FIXTURES } from '../../../src/machine/fixtures/machines';

/**
 * Serves a fixture instead of reading the machine. Used by tests and by the
 * renderer harness, where pretending a Linux container is Windows would make
 * every assertion meaningless.
 */
export class MockHardwareAdapter implements HardwareAdapter {
  readonly id = 'mock' as const;
  private profile: SystemProfile;

  constructor(fixtureId: string = 'C') {
    this.profile = MACHINE_FIXTURES[fixtureId] ?? MACHINE_FIXTURES.C!;
  }

  use(fixtureId: string): void {
    this.profile = MACHINE_FIXTURES[fixtureId] ?? this.profile;
  }

  async os(): Promise<OSInfo> { return this.profile.os; }
  async cpu(): Promise<CPUInfo> { return this.profile.cpu; }
  async memory(): Promise<MemoryInfo> { return this.profile.memory; }
  async gpus(): Promise<GPUInfo[]> { return this.profile.gpus; }
  async storage(): Promise<StorageInfo[]> { return this.profile.storage; }
  async power(): Promise<PowerInfo> { return this.profile.power; }
}
