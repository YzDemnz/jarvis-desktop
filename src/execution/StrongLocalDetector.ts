import fs from 'node:fs';
import path from 'node:path';
import type { StrongBackendDetector } from './backends/StrongLocalBackend';
import type { ExecutionStatus } from './types';

export interface LocalBackendFinding { id: 'WINDOWS_SANDBOX' | 'HYPERV' | 'WINDOWS_CONTAINERS' | 'LINUX_VM' | 'WSL'; status: ExecutionStatus; evidence: string[] }
export interface LocalHostProbe { exists(path: string): boolean; command(name: string): boolean; windowsRoot: string }
export const nodeHostProbe: LocalHostProbe = {
  exists: p => fs.existsSync(p),
  command: name => (process.env.PATH ?? '').split(path.delimiter).some(dir => ['.exe', '.cmd', '.bat', ''].some(ext => fs.existsSync(path.join(dir, `${name}${ext}`)))),
  windowsRoot: process.env.SystemRoot ?? 'C:\\Windows',
};

/** Read-only detection. Existence of a hypervisor or CLI is never attestation. */
export class LocalStrongDetector implements StrongBackendDetector {
  constructor(private readonly host: LocalHostProbe = nodeHostProbe) {}
  findings(): LocalBackendFinding[] {
    const root = this.host.windowsRoot;
    const sandbox = this.host.exists(path.join(root, 'System32', 'WindowsSandbox.exe')) || this.host.command('wsb');
    const hyperv = this.host.exists(path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules', 'Hyper-V', 'Hyper-V.psd1'));
    const containers = this.host.command('docker') || this.host.command('podman') || this.host.command('containerd');
    return [
      { id: 'WINDOWS_SANDBOX', status: sandbox ? 'UNVERIFIED' : 'NOT_AVAILABLE', evidence: [sandbox ? 'Executable found; feature/VM/security not validated' : 'No Windows Sandbox executable'] },
      { id: 'HYPERV', status: hyperv ? 'UNVERIFIED' : 'NOT_AVAILABLE', evidence: [hyperv ? 'Management module found; no VM attested' : 'Hyper-V management module absent'] },
      { id: 'WINDOWS_CONTAINERS', status: containers ? 'UNVERIFIED' : 'NOT_AVAILABLE', evidence: [containers ? 'Container CLI found; Hyper-V isolation not attested' : 'No container CLI'] },
      { id: 'LINUX_VM', status: 'NOT_AVAILABLE', evidence: ['No dedicated Linux VM backend configured'] },
      { id: 'WSL', status: this.host.command('wsl') ? 'UNVERIFIED' : 'NOT_AVAILABLE', evidence: ['WSL, even if installed, is not a strong security realm'] },
    ];
  }
  async detect(): Promise<{ status: ExecutionStatus; evidence: string[] }> {
    const findings = this.findings();
    const candidates = findings.filter(f => f.id !== 'WSL' && f.status === 'UNVERIFIED');
    return { status: candidates.length ? 'UNVERIFIED' : 'NOT_AVAILABLE', evidence: findings.flatMap(f => `${f.id}:${f.status}:${f.evidence[0]}`) };
  }
}
