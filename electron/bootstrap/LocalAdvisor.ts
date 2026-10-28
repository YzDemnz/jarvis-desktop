import type { SystemProfile } from '../../src/types';
import type { LocalCandidate, LocalPlan, RuntimeCatalog } from './contracts';
/** Estimates are explicit constraints, never model-produced capability scores. */
export function adviseLocal(profile: SystemProfile, candidates: LocalCandidate[], runtime: RuntimeCatalog, location: string, freeDisk: number): LocalPlan | null {
    if (profile.os.platform !== runtime.os || profile.os.architecture !== runtime.arch || profile.source === 'mock')
        return null;
    const total = profile.memory.totalBytes, available = profile.memory.availableBytes;
    if (total === null || available === null)
        return null;
    const usable = Math.max(0, Math.min(available - 2 * 1024 ** 3, total * 0.65));
    const cores = profile.cpu.physicalCores ?? 1;
    const allowed = candidates.filter(c => c.ramBytes <= usable && c.artifact.size * 2 + runtime.artifact.size * 3 + 512 * 1024 ** 2 <= freeDisk);
    // CPU backend: VRAM is observed but cannot justify a larger CPU model. A
    // confirmed accelerator catalog can add its own advisor in a future release.
    const responsive = allowed.filter(c => cores >= 10 || c.ramBytes <= (cores >= 4 ? 6 : 2) * 1024 ** 3);
    const sorted = (responsive.length ? responsive : allowed).sort((a, b) => b.priority - a.priority);
    const chosen = sorted[0];
    if (!chosen)
        return null;
    return { catalogVersion: 1, candidateId: chosen.id, runtimeId: runtime.id, location,
        requiredDiskBytes: chosen.artifact.size * 2 + runtime.artifact.size * 3 + 512 * 1024 ** 2,
        reason: `${chosen.label}: ${(chosen.ramBytes / 1024 ** 3).toFixed(1)} GB de RAM estimada, con margen para Windows. Backend CPU comprobable; la GPU no se presupone compatible. Se verificará la respuesta y velocidad antes de usarlo.`,
        acceleration: 'cpu', alternatives: sorted.slice(1).map(c => c.id) };
}
