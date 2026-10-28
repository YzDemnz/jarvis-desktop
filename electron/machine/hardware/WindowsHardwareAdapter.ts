import { execFile } from 'node:child_process';
import os from 'node:os';
import type { CPUInfo, GPUInfo, MemoryInfo, OSInfo, PowerInfo, StorageInfo, GPUVendor, DriveKind } from '../../../src/types';
import type { HardwareAdapter } from './HardwareAdapter';

/**
 * Windows reads hardware through CIM. Every query below is a fixed string
 * written by us and stored as a constant: nothing is interpolated, nothing is
 * composed at runtime, and no model ever contributes a character to it.
 *
 * `execFile` is used rather than a shell, so there is no command line for an
 * argument to escape into.
 */
const QUERIES = {
  cpu: 'Get-CimInstance Win32_Processor | Select-Object -First 1 Manufacturer,Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed | ConvertTo-Json -Compress',
  gpu: 'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterCompatibility,AdapterRAM,DriverVersion,VideoProcessor | ConvertTo-Json -Compress',
  disk: 'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,VolumeName,Size,FreeSpace,FileSystem | ConvertTo-Json -Compress',
  physicalDisk: 'Get-PhysicalDisk | Select-Object MediaType,BusType | ConvertTo-Json -Compress',
  osInfo: 'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture | ConvertTo-Json -Compress',
  battery: 'Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress',
} as const;

type QueryId = keyof typeof QUERIES;

const TIMEOUT_MS = 6000;

/** Runs one of our own fixed queries. A failure yields null, never a throw. */
function run(id: QueryId): Promise<unknown | null> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', QUERIES[id]],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout?.trim()) { resolve(null); return; }
        try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
      },
    );
  });
}

const asArray = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === 'object') return [value as Record<string, unknown>];
  return [];
};

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value
    : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value)
    : null;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

export function vendorOf(name: string | null): GPUVendor {
  if (!name) return 'unknown';
  const n = name.toLowerCase();
  if (n.includes('nvidia') || n.includes('geforce') || n.includes('quadro') || n.includes('rtx')) return 'nvidia';
  if (n.includes('amd') || n.includes('radeon') || n.includes('advanced micro')) return 'amd';
  if (n.includes('intel')) return 'intel';
  if (n.includes('apple')) return 'apple';
  return 'other';
}

export function driveKindOf(mediaType: string | null, busType: string | null): DriveKind {
  const bus = (busType ?? '').toLowerCase();
  const media = (mediaType ?? '').toLowerCase();
  if (bus.includes('nvme')) return 'nvme';
  if (media.includes('ssd') || media === '4') return 'ssd';
  if (media.includes('hdd') || media === '3') return 'hdd';
  return 'unknown';
}

/** WMI reports 0xFFF00000 for some cards with more than 4 GiB of VRAM. */
export function adapterRamBytes(value: unknown): number | null {
  const ram = num(value);
  return ram === null || ram <= 0 || ram >= 0xFFF00000 ? null : ram;
}

export class WindowsHardwareAdapter implements HardwareAdapter {
  readonly id = 'windows' as const;

  async os(): Promise<OSInfo> {
    const raw = asArray(await run('osInfo'))[0] ?? {};
    return {
      platform: 'win32',
      name: str(raw.Caption),
      version: str(raw.Version),
      build: str(raw.BuildNumber),
      architecture: process.arch,
    };
  }

  async cpu(): Promise<CPUInfo> {
    const raw = asArray(await run('cpu'))[0] ?? {};
    const cpus = os.cpus();
    return {
      manufacturer: str(raw.Manufacturer),
      model: str(raw.Name) ?? str(cpus[0]?.model ?? null),
      physicalCores: num(raw.NumberOfCores),
      logicalThreads: num(raw.NumberOfLogicalProcessors) ?? (cpus.length || null),
      baseClockMHz: cpus[0]?.speed ?? null,
      maxClockMHz: num(raw.MaxClockSpeed),
      architecture: process.arch,
      // Instruction-set detection needs a native probe; until then the honest
      // answer is an empty list rather than an assumption.
      features: [],
    };
  }

  async memory(): Promise<MemoryInfo> {
    const total = os.totalmem();
    const free = os.freemem();
    return { totalBytes: total || null, availableBytes: free || null, usedBytes: total ? total - free : null };
  }

  async gpus(): Promise<GPUInfo[]> {
    const rows = asArray(await run('gpu'));
    return rows.map((row) => {
      const model = str(row.Name);
      const vendor = vendorOf(str(row.AdapterCompatibility) ?? model);
      // Win32_VideoController.AdapterRAM is a signed 32-bit field and wraps
      // above 4 GB, so a value at or past the cap is reported as unknown
      // rather than as a wrong number.
      const vram = adapterRamBytes(row.AdapterRAM);
      return {
        vendor,
        model,
        dedicated: vendor === 'intel' ? false : vendor === 'unknown' ? null : true,
        vramBytes: vram,
        driverVersion: str(row.DriverVersion),
      };
    });
  }

  async storage(): Promise<StorageInfo[]> {
    const logical = asArray(await run('disk'));
    const physical = asArray(await run('physicalDisk'));
    const kind = driveKindOf(str(physical[0]?.MediaType ?? null), str(physical[0]?.BusType ?? null));

    return logical.map((row) => ({
      path: `${str(row.DeviceID) ?? 'C:'}\\`,
      label: str(row.VolumeName),
      totalBytes: num(row.Size),
      freeBytes: num(row.FreeSpace),
      filesystem: str(row.FileSystem),
      // The per-volume mapping to a physical disk needs another query; until
      // then this is only reported when every physical disk agrees.
      kind: physical.length === 1 ? kind : 'unknown',
    }));
  }

  async power(): Promise<PowerInfo> {
    const raw = asArray(await run('battery'))[0];
    if (!raw) return { batteryPresent: false, onAC: true, batteryPercent: null };
    const status = num(raw.BatteryStatus);
    return {
      batteryPresent: true,
      // 2 means "AC connected" in Win32_Battery.
      onAC: status === null ? null : status === 2,
      batteryPercent: num(raw.EstimatedChargeRemaining),
    };
  }
}
