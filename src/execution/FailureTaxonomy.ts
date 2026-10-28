export type RunFailureClass = 'SUCCESS' | 'PARTIAL' | 'ENV_UNAVAILABLE' | 'AUTH_REQUIRED' | 'PROVIDER_ERROR'
  | 'MODEL_INCOMPATIBLE' | 'POLICY_BLOCKED' | 'TOOL_BLOCKED' | 'TIMEOUT' | 'CANCELLED'
  | 'TASK_FAILED' | 'RESULT_REJECTED' | 'INTERNAL_ERROR' | 'UNKNOWN';
export type StructuredFailureSignal = Exclude<RunFailureClass, 'SUCCESS' | 'PARTIAL' | 'TASK_FAILED' | 'UNKNOWN'>;
export interface RunEvidence {
  objectiveVerified: boolean;
  acceptedArtifactCount: number;
  usefulProgressVerified: boolean;
  taskExecuted: boolean;
  exitCode: number | null;
  /** Only structured, attributable signals are admissible. Free-text diagnostics do not set this. */
  signals: StructuredFailureSignal[];
  diagnostic: string | null;
}
export interface ClassifiedRun { classification: RunFailureClass; reason: string }

/** Pure, conservative classifier. Exit code and generic text are not diagnostic evidence. */
export function classifyRun(evidence: RunEvidence): ClassifiedRun {
  const signals = [...new Set(evidence.signals)];
  if (signals.length > 1) return { classification: 'UNKNOWN', reason: `CONTRADICTORY_SIGNALS:${signals.join(',')}` };
  if (signals[0] === 'RESULT_REJECTED') return { classification: 'RESULT_REJECTED', reason: 'PROTECTED_RESULT_INVALID' };
  if (evidence.objectiveVerified && evidence.acceptedArtifactCount > 0 && !signals.length)
    return { classification: 'SUCCESS', reason: 'OBJECTIVE_AND_ARTIFACT_VERIFIED' };
  if (evidence.objectiveVerified && (evidence.acceptedArtifactCount <= 0 || signals.length))
    return { classification: 'UNKNOWN', reason: 'OBJECTIVE_EVIDENCE_CONTRADICTORY' };
  if (signals.length) return { classification: signals[0]!, reason: evidence.diagnostic?.trim() || `STRUCTURED_${signals[0]}` };
  if (evidence.usefulProgressVerified || evidence.acceptedArtifactCount > 0)
    return { classification: 'PARTIAL', reason: 'USEFUL_PROGRESS_NOT_COMPLETE' };
  if (evidence.taskExecuted) return { classification: 'TASK_FAILED', reason: 'TASK_EXECUTED_OBJECTIVE_NOT_MET' };
  return { classification: 'UNKNOWN', reason: evidence.diagnostic?.trim() || 'INSUFFICIENT_ATTRIBUTABLE_EVIDENCE' };
}
