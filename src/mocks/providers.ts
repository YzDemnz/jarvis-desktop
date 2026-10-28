import type { AIProvider } from '@/types';

export const mockProviders: AIProvider[] = [
  {
    id: 'local',
    label: 'Ollama',
    status: 'ready',
    endpoint: 'http://127.0.0.1:11434',
    requiresApiKey: false,
    latencyMs: 38,
    models: [
      { id: 'local/router', providerId: 'local', label: 'Router 8B', tier: 'LOCAL', contextWindow: 32000, local: true,
        capabilities: { vision: false, tools: true, code: true, reasoning: false, streaming: true } },
      { id: 'local/general', providerId: 'local', label: 'General 14B', tier: 'FAST', contextWindow: 64000, local: true,
        capabilities: { vision: false, tools: true, code: true, reasoning: true, streaming: true } },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    status: 'connected',
    requiresApiKey: true,
    latencyMs: 410,
    models: [
      { id: 'anthropic/reasoning', providerId: 'anthropic', label: 'Reasoning', tier: 'REASONING', contextWindow: 200000,
        capabilities: { vision: true, tools: true, code: true, reasoning: true, streaming: true },
        costPerMTokens: { input: 3, output: 15 } },
      { id: 'anthropic/max', providerId: 'anthropic', label: 'Max', tier: 'MAX', contextWindow: 200000,
        capabilities: { vision: true, tools: true, code: true, reasoning: true, streaming: true },
        costPerMTokens: { input: 15, output: 75 } },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    status: 'connected',
    requiresApiKey: true,
    latencyMs: 360,
    models: [
      { id: 'openai/fast', providerId: 'openai', label: 'Fast', tier: 'FAST', contextWindow: 128000,
        capabilities: { vision: true, tools: true, code: true, reasoning: false, streaming: true } },
      { id: 'openai/standard', providerId: 'openai', label: 'Standard', tier: 'STANDARD', contextWindow: 128000,
        capabilities: { vision: true, tools: true, code: true, reasoning: true, streaming: true } },
    ],
  },
  {
    id: 'google',
    label: 'Gemini',
    status: 'connected',
    requiresApiKey: true,
    latencyMs: 290,
    models: [
      { id: 'google/standard', providerId: 'google', label: 'Standard', tier: 'STANDARD', contextWindow: 1000000,
        capabilities: { vision: true, tools: true, code: true, reasoning: true, streaming: true } },
    ],
  },
];
