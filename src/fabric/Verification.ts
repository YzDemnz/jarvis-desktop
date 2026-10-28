/** Result verification is scoped evidence, never transport success or model agreement. */
export type VerificationState = 'PRODUCED' | 'VERIFIED' | 'FAILED' | 'INCONCLUSIVE' | 'REVIEW_REQUIRED';
export type EvidenceStrength = 'DETERMINISTIC' | 'OBSERVATION' | 'MODEL_REVIEW' | 'HUMAN_REVIEW';
export interface ResultVerification {
  id: string; taskId: string; operationId: string; subjectHash: string;
  verifierId: string; verifierVersion: number; category: string; criteriaHash: string;
  state: VerificationState; strength: EvidenceStrength; scope: string;
  checks: { name: string; passed: boolean | null }[];
  createdAt: number; expiresAt: number; policyRevision: number; authorityEpoch: number;
}
export type VerificationContract =
  | { kind: 'TEXT_EXACT'; expected: string }
  | { kind: 'JSON_SHAPE'; fields: Record<string, 'string' | 'number' | 'boolean' | 'array'> }
  | { kind: 'JSON_STRING_LIST'; field: string }
  | { kind: 'FOLLOWUP_BRIEF' }
  | { kind: 'PURE_REDUCER'; functionName: string; fields: [string, string]; cases: { items: Record<string, number>[]; expected: number }[] }
  | { kind: 'MODEL_REVIEW' };
