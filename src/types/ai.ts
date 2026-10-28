/** Providers are registry entries, never hardcoded in UI. */
export type ProviderId = 'local' | 'openai' | 'anthropic' | 'google' | (string & {});

export type ModelTier = 'LOCAL' | 'FAST' | 'STANDARD' | 'REASONING' | 'MAX';

export type ProviderStatus = 'ready' | 'connected' | 'degraded' | 'offline' | 'unconfigured';

export interface AIModel {
  id: string;
  providerId: ProviderId;
  label: string;
  tier: ModelTier;
  contextWindow: number;
  capabilities: {
    vision: boolean;
    tools: boolean;
    code: boolean;
    reasoning: boolean;
    streaming: boolean;
  };
  costPerMTokens?: { input: number; output: number };
  local?: boolean;
}

export interface AIProvider {
  id: ProviderId;
  label: string;
  status: ProviderStatus;
  endpoint?: string;
  requiresApiKey: boolean;
  models: AIModel[];
  latencyMs?: number;
}

export type TaskType =
  | 'chat'
  | 'code_generation'
  | 'code_debugging'
  | 'web_research'
  | 'market_analysis'
  | 'file_search'
  | 'computer_control'
  | 'summarization'
  | 'vision'
  | 'planning';

export interface RoutingDecision {
  taskType: TaskType;
  /** 1–10 */
  difficulty: number;
  contextSize: number;
  requiresWeb: boolean;
  requiresVision: boolean;
  requiresFiles: boolean;
  requiresCode: boolean;
  requiresReasoning: boolean;
  preferredProvider: ProviderId;
  modelTier: ModelTier;
  selectedModelId: string;
  reason: string;
  /** 0–1 */
  confidence: number;
  routedBy: 'ollama' | 'heuristic' | 'local-router' | 'manual' | 'fallback';
  elapsedMs: number;
  /** Tools the router thinks the task needs. Advisory only — it cannot run them. */
  suggestedTools?: string[];
}

export interface AgentTask {
  id: string;
  workspaceId: string;
  prompt: string;
  createdAt: number;
  status: 'planning' | 'running' | 'completed' | 'failed' | 'cancelled';
  routing?: RoutingDecision;
  eventIds: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  modelId?: string;
  taskId?: string;
  sources?: { title: string; url: string }[];
  pending?: boolean;
}

/** One lane in the multi-model panel. */
export interface ModelLane {
  id: string;
  label: string;
  providerId: ProviderId;
  role: string;
  state: 'idle' | 'queued' | 'working' | 'done' | 'failed';
  note?: string;
}

/** Contract that every real provider adapter will implement in stage 2. */
export interface AIService {
  listProviders(): Promise<AIProvider[]>;
  route(prompt: string, context: { workspaceId: string; hasSelection: boolean }): Promise<RoutingDecision>;
  complete(input: {
    modelId: string;
    messages: ChatMessage[];
    signal?: AbortSignal;
  }): AsyncIterable<string>;
}
