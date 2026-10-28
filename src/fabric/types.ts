/** Serializable contracts. A provider can propose work, never execute OS tools. */
export type IntelligenceKind = 'LOCAL_MODEL' | 'GENERAL_AI' | 'CODING_AGENT' | 'SPECIALIST' | 'CREATIVE_IMAGE' | 'CREATIVE_VIDEO' | 'VOICE' | 'RESEARCH' | 'CUSTOM_PROVIDER';
export type ConnectionState = 'NOT_INSTALLED' | 'DETECTED' | 'NOT_CONNECTED' | 'AUTH_REQUIRED' | 'CONNECTED' | 'AVAILABLE' | 'BUSY' | 'RATE_LIMITED' | 'QUOTA_LOW' | 'QUOTA_EXHAUSTED' | 'OFFLINE' | 'DEGRADED' | 'ERROR' | 'NOT_IMPLEMENTED';
export type Capability = 'reasoning' | 'coding' | 'repository' | 'research' | 'web' | 'vision' | 'imageGeneration' | 'videoGeneration' | 'voice' | 'longContext' | 'toolCalling' | 'structuredOutput' | 'computerUse' | 'uiGeneration' | 'documentAnalysis' | 'chat';
export type CostClass = 'LOCAL' | 'SUBSCRIPTION' | 'PAID_API' | 'UNKNOWN';
export type PrivacyClass = 'LOCAL' | 'REMOTE' | 'UNKNOWN';
export type CostPolicy = 'SUBSCRIPTIONS_FIRST' | 'QUALITY_FIRST' | 'LOCAL_FIRST' | 'ECONOMY' | 'MANUAL';
export type QuotaState = 'NORMAL' | 'CONSERVE' | 'CRITICAL' | 'EXHAUSTED' | 'UNKNOWN';
export type UsageUnit = 'INPUT_TOKENS' | 'OUTPUT_TOKENS' | 'CACHED_TOKENS' | 'REQUESTS' | 'MESSAGES' | 'CREDITS' | 'IMAGES' | 'VIDEO_SECONDS' | 'AUDIO_SECONDS' | 'CHARACTERS' | 'SUBSCRIPTION_PERCENT' | 'CURRENCY' | 'LOCAL_TOKENS' | 'UNKNOWN';
export type UsageSource = 'AUTHORITATIVE' | 'OBSERVED' | 'ESTIMATED' | 'USER_SUPPLIED' | 'UNKNOWN';

export interface ProviderIdentity { id: string; label: string; kind: IntelligenceKind; accountId?: string | null; }
export interface ProviderCapability { id: Capability; strength: number; available: boolean; }
export interface ProviderDescriptor extends ProviderIdentity {
  surface?: { transport: 'OLLAMA_HTTP' | 'RESPONSES_API' | 'CODEX_APP_SERVER' | 'LLAMA_CPP_CLI' | 'CHAT_COMPLETIONS_API' | 'MESSAGES_API'; destination: string | null;
    auth: 'NOT_REQUIRED' | 'MISSING' | 'SECRET_REF' | 'PROVIDER_MANAGED' | 'UNKNOWN'; secretRef: string | null;
    models: string[]; latencyMs: number | null; successfulRequests: number; lastFailure: string | null;
    verification: 'DISCOVERED' | 'INFERENCE_OBSERVED' | 'PROTOCOL_ONLY'; rateLimits: unknown | null };
  state: ConnectionState;
  capabilities: ProviderCapability[];
  costClass: CostClass;
  privacyClass: PrivacyClass;
  contextLimit: number | null;
  quality: number;
  healthCheckedAt: number | null;
  quota: QuotaState;
}
export interface IntelligenceRequest { taskId: string; prompt: string; context?: string; signal?: AbortSignal; }
export interface ExecutionProvenance { transport: 'LLAMA_CPP_CLI'; runtimeRelease: string; binarySHA256: string; modelSHA256: string; transmittedInputSHA256: string; ownership: 'WINDOWS_JOB'; tools: 'NONE' }
export interface IntelligenceResponse { text: string; model: string | null; usage?: UsageRecord[]; provenance?: ExecutionProvenance; }
export interface IntelligenceProvider {
  identity(): ProviderIdentity;
  capabilities(): Promise<ProviderCapability[]>;
  connectionState(): Promise<ConnectionState>;
  entitlement(): Promise<{ paid: boolean; details: string | null }>;
  health(): Promise<{ ok: boolean; message: string | null }>;
  usage(): Promise<UsageRecord[]>;
  estimate(request: IntelligenceRequest): Promise<{ amount: number | null; currency: string | null }>;
  execute(request: IntelligenceRequest): Promise<IntelligenceResponse>;
  stream?(request: IntelligenceRequest): AsyncIterable<string>;
  cancel?(taskId: string): Promise<void>;
}
export interface UsageRecord {
  id: string; providerId: string; accountId: string | null; modelId: string | null; taskId: string | null;
  unit: UsageUnit; amount: number; input: number | null; output: number | null; cached: number | null;
  estimatedCost: number | null; currency: string | null; timestamp: number; resetAt: number | null;
  source: UsageSource;
}
export interface QuotaSnapshot { providerId: string; accountId: string | null; unit: UsageUnit; used: number | null; limit: number | null; remaining: number | null; resetAt: number | null; source: UsageSource; state: QuotaState; }
export interface ConversationMessage {
  conversationId: string; messageId: string; parentId: string | null; role: 'user' | 'assistant' | 'tool' | 'system';
  content: string; timestamp: number; providerId: string | null; modelId: string | null; channel: string | null;
  taskId: string | null; tools: string[]; artifacts: string[]; usageIds: string[]; contextRefs: string[]; routingDecisionId: string | null;
}
export interface TaskEvidence {
  id: string; kind: 'step' | 'command' | 'artifact';
  source: 'RENDERER_REPORTED' | 'MAIN_PROCESS';
  status: string; summary: string; at: number;
  contentHash?: string | null;
}
export interface TaskState {
  taskId: string; conversationId: string; goal: string; currentTask: string;
  instructions: string[]; findings: string[]; decisions: string[]; artifacts: string[];
  openQuestions: string[]; pendingSteps: string[]; updatedAt: number;
  /** Public outcomes only: never arguments, credentials or private reasoning. */
  completedWork?: string[]; evidence?: TaskEvidence[];
}
export interface RoutingRequest { taskId: string; taskType: string; required: Capability[]; preferred?: Capability[]; policy?: CostPolicy; allowPaidApi?: boolean; maxPrivacy?: PrivacyClass; reservePremiumCapacity?: number;
  dataClass?: 'GENERIC' | 'CLIENT_DATA' | 'LOCAL_ONLY'; allowedProviderIds?: string[]; authorizedDestinations?: string[] }
export interface RoutingAudit { id: string; taskId: string; taskType: string; candidates: string[]; rejected: { providerId: string; reason: string }[]; selectedProviderId: string | null; fallbackFrom: string | null; policy: CostPolicy; required: Capability[]; quota: Record<string, QuotaState>; timestamp: number; }
