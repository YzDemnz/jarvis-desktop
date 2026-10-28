import { app } from 'electron';
import os from 'node:os';

export interface SystemInfo {
  platform: string;
  release: string;
  arch: string;
  hostname: string;
  cpuModel: string;
  cpuCount: number;
  totalMemory: number;
  freeMemory: number;
  uptimeSeconds: number;
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
}

export interface ProcessEntry {
  pid: number;
  name: string;
  /** Memory in bytes where the platform reports it, otherwise 0. */
  memory: number;
}

/**
 * Read-only system inspection. `process.kill` is declared in the registry but
 * has no implementation here on purpose — terminating processes is a
 * DESTRUCTIVE capability for a later stage.
 */
export class SystemService {
  getInfo(): SystemInfo {
    const cpus = os.cpus();
    return {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      hostname: os.hostname(),
      cpuModel: cpus[0]?.model?.trim() ?? 'desconocido',
      cpuCount: cpus.length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      uptimeSeconds: Math.round(os.uptime()),
      appVersion: safe(() => app.getVersion(), '0.0.0'),
      electronVersion: process.versions.electron ?? 'n/d',
      nodeVersion: process.versions.node,
    };
  }

  /**
   * Enumerating processes without a native module means shelling out, which is
   * exactly the capability this stage refuses to build. Until a vetted native
   * binding lands, this reports only what the app can see of itself.
   */
  listProcesses(): ProcessEntry[] {
    const usage = process.memoryUsage();
    return [
      { pid: process.pid, name: 'JARVIS Desktop', memory: usage.rss },
    ];
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export const systemService = new SystemService();
