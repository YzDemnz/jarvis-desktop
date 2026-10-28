import type { ProcessInfo } from '@/types';
import type { WindowsAutomationAdapter } from './adapter';

/**
 * Read-only. `process.terminate` is declared in the registry as DESTRUCTIVE and
 * disabled; there is deliberately no kill method here to call.
 */
export class ProcessService {
  constructor(private adapter: WindowsAutomationAdapter) {}
  useAdapter(adapter: WindowsAutomationAdapter): void { this.adapter = adapter; }

  list(): Promise<ProcessInfo[]> { return this.adapter.processes(); }

  async find(name: string): Promise<ProcessInfo[]> {
    const needle = name.trim().toLowerCase().replace(/\.exe$/, '');
    if (needle.length < 2) return [];
    return (await this.adapter.processes()).filter((p) => p.name.toLowerCase().replace(/\.exe$/, '').includes(needle));
  }

  async info(pid: number): Promise<ProcessInfo | null> {
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('PID inválido.');
    return (await this.adapter.processes()).find((p) => p.pid === pid) ?? null;
  }
}
