import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import type { CPUInfo, GPUInfo, MemoryInfo, OSInfo, PowerInfo, StorageInfo } from '../../../src/types';
import type { HardwareAdapter } from './HardwareAdapter';
import { vendorOf } from './WindowsHardwareAdapter';

/**
 * Reads from /proc and /sys only. No shelling out, no package assumptions:
 * whatever the kernel exposes is reported, everything else stays null.
 */
export class LinuxHardwareAdapter implements HardwareAdapter {
  readonly id = 'linux' as const;

  async os(): Promise<OSInfo> {
    let name: string | null = null;
    let version: string | null = null;
    try {
      const release = await fsp.readFile('/etc/os-release', 'utf8');
      name = release.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1] ?? null;
      version = release.match(/^VERSION_ID="?([^"\n]+)"?/m)?.[1] ?? null;
    } catch { /* not every distro has it */ }
    return { platform: 'linux', name, version, build: os.release(), architecture: process.arch };
  }

  async cpu(): Promise<CPUInfo> {
    const cpus = os.cpus();
    let model: string | null = cpus[0]?.model?.trim() ?? null;
    let physicalCores: number | null = null;
    let features: string[] = [];
    try {
      const info = await fsp.readFile('/proc/cpuinfo', 'utf8');
      model = info.match(/^model name\s*:\s*(.+)$/m)?.[1]?.trim() ?? model;
      const siblings = Number(info.match(/^siblings\s*:\s*(\d+)$/m)?.[1] ?? '');
      const cores = Number(info.match(/^cpu cores\s*:\s*(\d+)$/m)?.[1] ?? '');
      if (Number.isFinite(cores) && cores > 0) {
        physicalCores = siblings > 0 ? Math.round((cpus.length / siblings) * cores) : cores;
      }
      const flags = info.match(/^flags\s*:\s*(.+)$/m)?.[1]?.split(/\s+/) ?? [];
      features = ['avx2', 'avx512f', 'neon'].filter((f) => flags.includes(f));
    } catch { /* fall back to os.cpus */ }

    return {
      manufacturer: model?.split(' ')[0] ?? null,
      model,
      physicalCores,
      logicalThreads: cpus.length || null,
      baseClockMHz: cpus[0]?.speed ?? null,
      maxClockMHz: null,
      architecture: process.arch,
      features,
    };
  }

  async memory(): Promise<MemoryInfo> {
    const total = os.totalmem();
    let available = os.freemem();
    try {
      const meminfo = await fsp.readFile('/proc/meminfo', 'utf8');
      const kb = Number(meminfo.match(/^MemAvailable:\s+(\d+) kB$/m)?.[1] ?? '');
      if (Number.isFinite(kb) && kb > 0) available = kb * 1024;
    } catch { /* keep os.freemem */ }
    return { totalBytes: total || null, availableBytes: available || null, usedBytes: total ? total - available : null };
  }

  async gpus(): Promise<GPUInfo[]> {
    const out: GPUInfo[] = [];
    const root = '/sys/class/drm';
    try {
      for (const entry of await fsp.readdir(root)) {
        if (!/^card\d+$/.test(entry)) continue;
        const device = `${root}/${entry}/device`;
        const vendorId = (await readMaybe(`${device}/vendor`))?.trim() ?? null;
        const vendor = vendorId === '0x10de' ? 'nvidia' as const
          : vendorId === '0x1002' ? 'amd' as const
          : vendorId === '0x8086' ? 'intel' as const
          : vendorOf(null);
        const vramRaw = await readMaybe(`${device}/mem_info_vram_total`);
        const vram = vramRaw && Number.isFinite(Number(vramRaw.trim())) ? Number(vramRaw.trim()) : null;
        out.push({
          vendor,
          model: (await readMaybe(`${device}/product_name`))?.trim() ?? null,
          dedicated: vendor === 'intel' ? false : vendor === 'unknown' ? null : true,
          vramBytes: vram,
          driverVersion: null,
        });
      }
    } catch { /* headless or no drm */ }
    return out;
  }

  async storage(): Promise<StorageInfo[]> {
    const paths = ['/', os.homedir()];
    const seen = new Set<string>();
    const out: StorageInfo[] = [];
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      try {
        const stats = await fsp.statfs(path);
        out.push({
          path,
          label: path === '/' ? 'Raíz' : 'Home',
          totalBytes: stats.blocks * stats.bsize,
          freeBytes: stats.bavail * stats.bsize,
          filesystem: null,
          kind: 'unknown',
        });
      } catch { /* not mounted */ }
    }
    return out;
  }

  async power(): Promise<PowerInfo> {
    const base = '/sys/class/power_supply/BAT0';
    if (!fs.existsSync(base)) return { batteryPresent: false, onAC: true, batteryPercent: null };
    const capacity = await readMaybe(`${base}/capacity`);
    const status = (await readMaybe(`${base}/status`))?.trim().toLowerCase() ?? null;
    return {
      batteryPresent: true,
      onAC: status === null ? null : status !== 'discharging',
      batteryPercent: capacity && Number.isFinite(Number(capacity.trim())) ? Number(capacity.trim()) : null,
    };
  }
}

async function readMaybe(path: string): Promise<string | null> {
  try { return await fsp.readFile(path, 'utf8'); } catch { return null; }
}
