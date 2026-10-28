import type { DisplayInfo, HardwareFingerprint, SystemProfile } from '../../src/types';
import type { HardwareAdapter } from './hardware/HardwareAdapter';
import { missingFields } from './hardware/HardwareAdapter';
import { WindowsHardwareAdapter } from './hardware/WindowsHardwareAdapter';
import { LinuxHardwareAdapter } from './hardware/LinuxHardwareAdapter';
import { MockHardwareAdapter } from './hardware/MockHardwareAdapter';
import { computePerformanceProfile } from '../../src/machine/performance';
import { computeFingerprint } from '../../src/machine/fingerprint';

export function adapterForPlatform(platform: NodeJS.Platform = process.platform): HardwareAdapter {
  if (platform === 'win32') return new WindowsHardwareAdapter();
  if (platform === 'linux') return new LinuxHardwareAdapter();
  // macOS has no adapter yet; a fixture is more honest than a Linux reading.
  return new MockHardwareAdapter('C');
}

/**
 * Composes one adapter's readings into a SystemProfile. Each axis is read
 * independently so one failing query cannot cost us the whole profile, and
 * every null lands in `unavailable` for the UI to be honest about.
 */
export class SystemProfiler {
  private cache: { profile: SystemProfile; at: number } | null = null;

  constructor(
    private adapter: HardwareAdapter = adapterForPlatform(),
    private readonly displaysFn: () => DisplayInfo[] = () => [],
  ) {}

  useAdapter(adapter: HardwareAdapter): void {
    this.adapter = adapter;
    this.cache = null;
  }

  async profile(force = false): Promise<SystemProfile> {
    if (!force && this.cache && Date.now() - this.cache.at < 60_000) return this.cache.profile;

    const [osInfo, cpu, memory, gpus, storage, power] = await Promise.all([
      settle(() => this.adapter.os()),
      settle(() => this.adapter.cpu()),
      settle(() => this.adapter.memory()),
      settle(() => this.adapter.gpus()),
      settle(() => this.adapter.storage()),
      settle(() => this.adapter.power()),
    ]);

    const unavailable: string[] = [];
    if (osInfo) unavailable.push(...missingFields(osInfo as unknown as Record<string, unknown>, 'os'));
    else unavailable.push('os');
    if (cpu) unavailable.push(...missingFields(cpu as unknown as Record<string, unknown>, 'cpu'));
    else unavailable.push('cpu');
    if (memory) unavailable.push(...missingFields(memory as unknown as Record<string, unknown>, 'memory'));
    else unavailable.push('memory');
    (gpus ?? []).forEach((g, i) => unavailable.push(...missingFields(g as unknown as Record<string, unknown>, `gpu[${i}]`)));
    (storage ?? []).forEach((s, i) => unavailable.push(...missingFields(s as unknown as Record<string, unknown>, `storage[${i}]`)));
    if (power) unavailable.push(...missingFields(power as unknown as Record<string, unknown>, 'power'));

    const complete = Boolean(osInfo && cpu && memory && gpus && storage && power);
    const profile: SystemProfile = {
      os: osInfo ?? { platform: process.platform, name: null, version: null, build: null, architecture: process.arch },
      cpu: cpu ?? { manufacturer: null, model: null, physicalCores: null, logicalThreads: null, baseClockMHz: null, maxClockMHz: null, architecture: process.arch, features: [] },
      memory: memory ?? { totalBytes: null, availableBytes: null, usedBytes: null },
      gpus: gpus ?? [],
      storage: storage ?? [],
      displays: safeDisplays(this.displaysFn),
      power: power ?? { batteryPresent: null, onAC: null, batteryPercent: null },
      source: complete
        ? (this.adapter.id === 'windows' ? 'windows' : this.adapter.id === 'linux' ? 'linux' : 'mock')
        : 'partial',
      collectedAt: Date.now(),
      unavailable: [...new Set(unavailable)],
    };

    this.cache = { profile, at: Date.now() };
    return profile;
  }

  async full(force = false): Promise<{ profile: SystemProfile; performance: ReturnType<typeof computePerformanceProfile>; fingerprint: HardwareFingerprint }> {
    const profile = await this.profile(force);
    return {
      profile,
      performance: computePerformanceProfile(profile),
      fingerprint: computeFingerprint(profile),
    };
  }
}

async function settle<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

function safeDisplays(fn: () => DisplayInfo[]): DisplayInfo[] {
  try { return fn(); } catch { return []; }
}
