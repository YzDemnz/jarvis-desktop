export type ExecutionRealm = 'BROKERED' | 'WEB_ISOLATED' | 'STRONG_ISOLATED' | 'PROVIDER_NATIVE' | 'FULL_NATIVE';
export type ExecutionTrust = 'TRUSTED_BROKERED' | 'LIMITED_ISOLATION' | 'STRONG_ISOLATION' | 'PROVIDER_MANAGED' | 'FULL_TRUST';
export type ExecutionNetwork = 'OFF' | 'LOCAL_ONLY' | 'ALLOWLIST' | 'GENERAL' | 'PROVIDER_DEFINED' | 'TOOL_POLICY' | 'SYSTEM';
export type ExecutionUserPolicy = 'NORMAL_USER' | 'ADVANCED' | 'DEVELOPER';
export type ExecutionTask = 'DOCUMENT_ANALYSIS' | 'BROWSER_RESEARCH' | 'UI_GENERATION' | 'CODING_WITH_SHELL' | 'UNKNOWN_UNTRUSTED_AGENT' | 'SYSTEM_CONTROL' | 'RESEARCH_MOCK' | 'DOCUMENT_MOCK';
export type ExecutionArtifactKind = 'TEXT' | 'FILE' | 'DIRECTORY' | 'DIFF' | 'BUILD' | 'LOG' | 'IMAGE' | 'VIDEO' | 'TEST_REPORT';
export type ExecutionStatus = 'AVAILABLE' | 'NOT_AVAILABLE' | 'REQUIRES_FEATURE' | 'INCOMPATIBLE' | 'UNVERIFIED';

export interface ExecutionCapability {
  filesystemIsolation: 'NONE' | 'BROKERED' | 'VIRTUAL' | 'VM' | 'PROVIDER_DEFINED';
  processIsolation: 'NONE' | 'BROKERED' | 'BROWSER' | 'VM' | 'PROVIDER_DEFINED';
  networkIsolation: 'NONE' | 'BROKERED' | 'BROWSER' | 'VM' | 'PROVIDER_DEFINED';
  credentialIsolation: 'NONE' | 'BROKERED' | 'VIRTUAL' | 'VM' | 'PROVIDER_DEFINED';
  uiIsolation: 'NONE' | 'BROKERED' | 'BROWSER' | 'VM' | 'PROVIDER_DEFINED';
  shell: boolean; git: boolean; packageManager: boolean; browser: boolean;
  artifacts: boolean; persistence: boolean; resume: boolean; pause: boolean;
  startupCostMs: number | null;
  trust: ExecutionTrust;
}

export interface ExecutionProbe {
  backendId: string; realm: ExecutionRealm; status: ExecutionStatus;
  evidence: string[]; at: number; capabilities: ExecutionCapability;
  /** Absent in legacy EF-1 probes; security requirements then fail closed. */
  assurance?: { current: AssuranceFingerprintInput; mechanismConfigured: boolean };
}

export interface ExecutionPolicy {
  /** Present only on S2 main-owned dispatch. Absent policies are historical lab contracts. */
  accessMode?: import('../types/agent').AccessMode;
  authoritativeStrong?: boolean;
  user: ExecutionUserPolicy;
  allowProviderNative: boolean;
  allowFullNative: boolean;
  requireExplicitFullNative: boolean;
  network: Partial<Record<ExecutionRealm, ExecutionNetwork>>;
  securityRequirements?: Partial<Record<ExecutionTask, SecurityCapability[]>>;
  securityFallback?: 'NONE' | 'BROKERED_PROPOSAL';
  budget?: import('./RunBudget').RunBudget;
}

export interface ExecutionRequest {
  runId: string; conversationId: string; task: ExecutionTask; prompt: string;
  providerId: string | null; agentId: string | null; projectRoot: string | null;
  requiredTrust: ExecutionTrust | null; requireShell: boolean; allowProposalFallback: boolean;
  requiredCapabilities?: SecurityCapability[];
  explicitRealm?: ExecutionRealm | null;
  brokeredCalls?: Array<{ toolId: string; args: Record<string, unknown> }>;
}

export interface ExecutionSession {
  id: string; runId: string; conversationId: string; backendId: string; realm: ExecutionRealm;
  createdAt: number; state: 'CREATED' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'COMPLETED' | 'FAILED';
}

export interface ExecutionArtifact {
  id: string; runId: string; kind: ExecutionArtifactKind; label: string;
  uri: string | null; contentHash: string | null; bytes: number | null;
  createdAt: number; metadata: Record<string, string | number | boolean | null>;
}

export interface ExecutionAudit {
  id: string; runId: string; sessionId: string; at: number; event: string;
  backendId: string; realm: ExecutionRealm; brokerAuditId: string | null;
  detail: string | null;
}

export interface ExecutionResult {
  toolResults?: unknown[];
  status: 'SUCCESS' | 'PARTIAL' | 'FAIL' | 'CANCELLED';
  summary: string; artifacts: ExecutionArtifact[]; audit: ExecutionAudit[];
  durationMs: number; usageRecordIds: string[];
}

export interface ExecutionHealth { healthy: boolean; detail: string; at: number }
export interface ExecutionUsage { source: 'AUTHORITATIVE' | 'OBSERVED' | 'UNKNOWN'; tokensIn: number | null; tokensOut: number | null; cost: number | null }

export interface ExecutionBackend {
  readonly id: string;
  readonly realm: ExecutionRealm;
  probe(): Promise<ExecutionProbe>;
  capabilities(): ExecutionCapability;
  createSession(request: ExecutionRequest): Promise<ExecutionSession>;
  execute(session: ExecutionSession, request: ExecutionRequest): Promise<ExecutionResult>;
  stream(session: ExecutionSession): AsyncIterable<ExecutionAudit>;
  cancel(session: ExecutionSession): Promise<void>;
  pause(session: ExecutionSession): Promise<boolean>;
  resume(session: ExecutionSession): Promise<boolean>;
  collectArtifacts(session: ExecutionSession): Promise<ExecutionArtifact[]>;
  collectDiff(session: ExecutionSession): Promise<ExecutionArtifact | null>;
  getUsage(session: ExecutionSession): Promise<ExecutionUsage>;
  getHealth(): Promise<ExecutionHealth>;
  shutdown(session: ExecutionSession): Promise<void>;
  destroy(session: ExecutionSession): Promise<void>;
}
import type { AssuranceFingerprintInput, SecurityCapability } from './assurance/CapabilityAssurance';
