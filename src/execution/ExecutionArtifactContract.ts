import type { ExecutionArtifact } from './types';

const KINDS = new Set(['TEXT', 'FILE', 'DIRECTORY', 'DIFF', 'BUILD', 'LOG', 'IMAGE', 'VIDEO', 'TEST_REPORT']);

/** Validation of metadata only. File bytes still require the capsule Import Gate. */
export function validateExecutionArtifact(value: ExecutionArtifact, runId: string): void {
  if (!value || value.runId !== runId || !value.id || !KINDS.has(value.kind) || !value.label || value.label.length > 200) {
    throw new Error('EXECUTION_ARTIFACT_INVALID');
  }
  if (value.bytes !== null && (!Number.isSafeInteger(value.bytes) || value.bytes < 0)) throw new Error('EXECUTION_ARTIFACT_SIZE_INVALID');
  if (value.contentHash !== null && !/^[0-9a-f]{64}$/i.test(value.contentHash)) throw new Error('EXECUTION_ARTIFACT_HASH_INVALID');
  if (value.uri && !/^artifact:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.uri)) {
    throw new Error('EXECUTION_ARTIFACT_URI_UNTRUSTED');
  }
}
