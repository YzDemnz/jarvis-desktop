import type { HardwareChange, HardwareFingerprint, SystemProfile } from '@/types';
import { pickBestGPU } from './performance';

const GB = 1024 ** 3;

/** Buckets, not exact values: two 31.9 GB machines must fingerprint the same. */
function bucketGB(bytes: number | null): number {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return 0;
  const gb = bytes / GB;
  for (const step of [2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256]) {
    if (gb <= step) return step;
  }
  return 512;
}

/** Small, stable, non-cryptographic. Its only job is equality comparison. */
function hash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

/**
 * Non-identifying by construction. Model names and bucketed sizes only — no
 * serials, MACs, UUIDs, disk ids or account data. Two identical laptops from
 * the same batch produce the same fingerprint, which is exactly the point:
 * this answers "did the hardware change?", never "which machine is this?".
 */
export function computeFingerprint(profile: SystemProfile): HardwareFingerprint {
  const gpu = pickBestGPU(profile);
  const gpuModels = profile.gpus
    .map((g) => (g.model ?? `${g.vendor}-desconocida`).trim().toLowerCase())
    .sort();

  const fingerprint: Omit<HardwareFingerprint, 'hash'> = {
    version: 1,
    cpuModel: (profile.cpu.model ?? 'desconocida').trim().toLowerCase(),
    ramBucketGB: bucketGB(profile.memory.totalBytes),
    gpuModels,
    vramBucketGB: bucketGB(gpu?.vramBytes ?? null),
    architecture: profile.cpu.architecture || profile.os.architecture || 'unknown',
  };

  return { ...fingerprint, hash: hash(JSON.stringify(fingerprint)) };
}

/**
 * A changed CPU, GPU set or architecture is significant; so is a RAM or VRAM
 * bucket that moved. Anything else is noise not worth interrupting the user for.
 */
export function compareFingerprints(
  previous: HardwareFingerprint | null,
  current: HardwareFingerprint,
): HardwareChange {
  if (!previous) return { changed: false, significant: false, fields: [] };
  if (previous.hash === current.hash) return { changed: false, significant: false, fields: [] };

  const fields: string[] = [];
  if (previous.cpuModel !== current.cpuModel) fields.push('cpu');
  if (previous.ramBucketGB !== current.ramBucketGB) fields.push('memoria');
  if (previous.gpuModels.join('|') !== current.gpuModels.join('|')) fields.push('gpu');
  if (previous.vramBucketGB !== current.vramBucketGB) fields.push('vram');
  if (previous.architecture !== current.architecture) fields.push('arquitectura');

  return { changed: true, significant: fields.length > 0, fields };
}
