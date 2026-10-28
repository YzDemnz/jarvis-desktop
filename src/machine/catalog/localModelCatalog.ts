import type { LocalModelEntry } from '@/types';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/**
 * Versioned catalog, data only — no logic lives here so it can be replaced or
 * fetched later without touching the engine.
 *
 * Ten well-modelled entries beat a hundred guessed ones: every figure below is
 * a conservative working estimate for the quantisation named, not a benchmark.
 */
export const CATALOG_VERSION = 1;

export const LOCAL_MODEL_CATALOG: LocalModelEntry[] = [
  {
    id: 'qwen2.5:0.5b-instruct-q4',
    displayName: 'Qwen2.5 0.5B Instruct',
    family: 'qwen2.5', provider: 'Alibaba', runtimes: ['ollama', 'llamacpp'],
    tier: 'MICRO', parametersB: 0.5, quantization: 'Q4_K_M',
    diskBytes: 400 * MB, estimatedRamBytes: 1.2 * GB, estimatedVramBytes: 0,
    contextWindow: 32768,
    structuredOutput: 0.62, toolRouting: 0.58, reasoning: 0.3, coding: 0.35, vision: false,
    routerScore: 68,
    supportedOS: ['win32', 'linux', 'darwin'], supportedArchitecture: ['x64', 'arm64'],
    supportedAcceleration: ['cpu', 'nvidia', 'amd', 'intel', 'metal'],
    officialSource: 'https://ollama.com/library/qwen2.5',
    downloadPage: 'https://ollama.com/library/qwen2.5:0.5b',
    pullCommand: 'ollama pull qwen2.5:0.5b',
  },
  {
    id: 'llama3.2:1b-instruct-q4',
    displayName: 'Llama 3.2 1B Instruct',
    family: 'llama3.2', provider: 'Meta', runtimes: ['ollama', 'llamacpp'],
    tier: 'MICRO', parametersB: 1, quantization: 'Q4_K_M',
    diskBytes: 1.3 * GB, estimatedRamBytes: 2.2 * GB, estimatedVramBytes: 1.6 * GB,
    contextWindow: 131072,
    structuredOutput: 0.7, toolRouting: 0.68, reasoning: 0.38, coding: 0.4, vision: false,
    routerScore: 78,
    supportedOS: ['win32', 'linux', 'darwin'], supportedArchitecture: ['x64', 'arm64'],
    supportedAcceleration: ['cpu', 'nvidia', 'amd', 'intel', 'metal'],
    officialSource: 'https://ollama.com/library/llama3.2',
    downloadPage: 'https://ollama.com/library/llama3.2:1b',
    pullCommand: 'ollama pull llama3.2:1b',
  },
  {
    id: 'qwen2.5:3b-instruct-q4',
    displayName: 'Qwen2.5 3B Instruct',
    family: 'qwen2.5', provider: 'Alibaba', runtimes: ['ollama', 'llamacpp'],
    tier: 'LIGHT', parametersB: 3, quantization: 'Q4_K_M',
    diskBytes: 2 * GB, estimatedRamBytes: 3.6 * GB, estimatedVramBytes: 2.8 * GB,
    contextWindow: 32768,
    structuredOutput: 0.82, toolRouting: 0.8, reasoning: 0.55, coding: 0.6, vision: false,
    routerScore: 88,
    supportedOS: ['win32', 'linux', 'darwin'], supportedArchitecture: ['x64', 'arm64'],
    supportedAcceleration: ['cpu', 'nvidia', 'amd', 'intel', 'metal'],
    officialSource: 'https://ollama.com/library/qwen2.5',
    downloadPage: 'https://ollama.com/library/qwen2.5:3b',
    pullCommand: 'ollama pull qwen2.5:3b',
  },
  {
    id: 'llama3.2:3b-instruct-q4',
    displayName: 'Llama 3.2 3B Instruct',
    family: 'llama3.2', provider: 'Meta', runtimes: ['ollama', 'llamacpp'],
    tier: 'LIGHT', parametersB: 3, quantization: 'Q4_K_M',
    diskBytes: 2 * GB, estimatedRamBytes: 3.8 * GB, estimatedVramBytes: 3 * GB,
    contextWindow: 131072,
    structuredOutput: 0.8, toolRouting: 0.78, reasoning: 0.52, coding: 0.55, vision: false,
    routerScore: 84,
    supportedOS: ['win32', 'linux', 'darwin'], supportedArchitecture: ['x64', 'arm64'],
    supportedAcceleration: ['cpu', 'nvidia', 'amd', 'intel', 'metal'],
    officialSource: 'https://ollama.com/library/llama3.2',
    downloadPage: 'https://ollama.com/library/llama3.2:3b',
    pullCommand: 'ollama pull llama3.2:3b',
  },
  {
    id: 'phi3.5:3.8b-mini-q4',
    displayName: 'Phi 3.5 Mini',
    family: 'phi3.5', provider: 'Microsoft', runtimes: ['ollama', 'llamacpp', 'lmstudio'],
    tier: 'LIGHT', parametersB: 3.8, quantization: 'Q4_K_M',
    diskBytes: 2.3 * GB, estimatedRamBytes: 4.2 * GB, estimatedVramBytes: 3.4 * GB,
    contextWindow: 131072,
    structuredOutput: 0.76, toolRouting: 0.7, reasoning: 0.62, coding: 0.6, vision: false,
    routerScore: 76,
    supportedOS: ['win32', 'linux', 'darwin'], supportedArchitecture: ['x64', 'arm64'],
    supportedAcceleration: ['cpu', 'nvidia', 'intel', 'metal'],
    officialSource: 'https://ollama.com/library/phi3.5',
    downloadPage: 'https://ollama.com/library/phi3.5',
    pullCommand: 'ollama pull phi3.5',
  },
  {
    id: 'qwen2.5:7b-instruct-q4',
    displayName: 'Qwen2.5 7B Instruct',
    family: 'qwen2.5', provider: 'Alibaba', runtimes: ['ollama', 'llamacpp', 'lmstudio'],
    tier: 'STANDARD', parametersB: 7, quantization: 'Q4_K_M',
    diskBytes: 4.7 * GB, estimatedRamBytes: 7.5 * GB, estimatedVramBytes: 6 * GB,
    contextWindow: 32768,
    structuredOutput: 0.88, toolRouting: 0.86, reasoning: 0.72, coding: 0.75, vision: false,
    routerScore: 82,
    supportedOS: ['win32', 'linux', 'darwin'], supportedArchitecture: ['x64', 'arm64'],
    supportedAcceleration: ['cpu', 'nvidia', 'amd', 'metal'],
    officialSource: 'https://ollama.com/library/qwen2.5',
    downloadPage: 'https://ollama.com/library/qwen2.5:7b',
    pullCommand: 'ollama pull qwen2.5:7b',
  },
  {
    id: 'llama3.1:8b-instruct-q4',
    displayName: 'Llama 3.1 8B Instruct',
    family: 'llama3.1', provider: 'Meta', runtimes: ['ollama', 'llamacpp', 'lmstudio'],
    tier: 'STANDARD', parametersB: 8, quantization: 'Q4_K_M',
    diskBytes: 4.9 * GB, estimatedRamBytes: 8 * GB, estimatedVramBytes: 6.4 * GB,
    contextWindow: 131072,
    structuredOutput: 0.85, toolRouting: 0.84, reasoning: 0.74, coding: 0.72, vision: false,
    routerScore: 79,
    supportedOS: ['win32', 'linux', 'darwin'], supportedArchitecture: ['x64', 'arm64'],
    supportedAcceleration: ['cpu', 'nvidia', 'amd', 'metal'],
    officialSource: 'https://ollama.com/library/llama3.1',
    downloadPage: 'https://ollama.com/library/llama3.1:8b',
    pullCommand: 'ollama pull llama3.1:8b',
  },
  {
    id: 'qwen2.5-coder:7b-q4',
    displayName: 'Qwen2.5 Coder 7B',
    family: 'qwen2.5-coder', provider: 'Alibaba', runtimes: ['ollama', 'llamacpp'],
    tier: 'STANDARD', parametersB: 7, quantization: 'Q4_K_M',
    diskBytes: 4.7 * GB, estimatedRamBytes: 7.5 * GB, estimatedVramBytes: 6 * GB,
    contextWindow: 32768,
    structuredOutput: 0.84, toolRouting: 0.76, reasoning: 0.7, coding: 0.9, vision: false,
    routerScore: 70,
    supportedOS: ['win32', 'linux', 'darwin'], supportedArchitecture: ['x64', 'arm64'],
    supportedAcceleration: ['cpu', 'nvidia', 'amd', 'metal'],
    officialSource: 'https://ollama.com/library/qwen2.5-coder',
    downloadPage: 'https://ollama.com/library/qwen2.5-coder:7b',
    pullCommand: 'ollama pull qwen2.5-coder:7b',
  },
  {
    id: 'qwen2.5:14b-instruct-q4',
    displayName: 'Qwen2.5 14B Instruct',
    family: 'qwen2.5', provider: 'Alibaba', runtimes: ['ollama', 'llamacpp', 'lmstudio'],
    tier: 'POWER', parametersB: 14, quantization: 'Q4_K_M',
    diskBytes: 9 * GB, estimatedRamBytes: 13 * GB, estimatedVramBytes: 11 * GB,
    contextWindow: 32768,
    structuredOutput: 0.9, toolRouting: 0.88, reasoning: 0.82, coding: 0.82, vision: false,
    routerScore: 72,
    supportedOS: ['win32', 'linux', 'darwin'], supportedArchitecture: ['x64', 'arm64'],
    supportedAcceleration: ['cpu', 'nvidia', 'amd', 'metal'],
    officialSource: 'https://ollama.com/library/qwen2.5',
    downloadPage: 'https://ollama.com/library/qwen2.5:14b',
    pullCommand: 'ollama pull qwen2.5:14b',
  },
  {
    id: 'qwen2.5:32b-instruct-q4',
    displayName: 'Qwen2.5 32B Instruct',
    family: 'qwen2.5', provider: 'Alibaba', runtimes: ['ollama', 'llamacpp'],
    tier: 'MAX_LOCAL', parametersB: 32, quantization: 'Q4_K_M',
    diskBytes: 20 * GB, estimatedRamBytes: 26 * GB, estimatedVramBytes: 22 * GB,
    contextWindow: 32768,
    structuredOutput: 0.92, toolRouting: 0.9, reasoning: 0.9, coding: 0.88, vision: false,
    routerScore: 60,
    supportedOS: ['win32', 'linux'], supportedArchitecture: ['x64'],
    supportedAcceleration: ['cpu', 'nvidia'],
    officialSource: 'https://ollama.com/library/qwen2.5',
    downloadPage: 'https://ollama.com/library/qwen2.5:32b',
    pullCommand: 'ollama pull qwen2.5:32b',
  },
];

export function catalogEntry(id: string): LocalModelEntry | null {
  return LOCAL_MODEL_CATALOG.find((m) => m.id === id) ?? null;
}

/** Matches an installed model name like "qwen2.5:3b" to a catalog entry. */
export function matchInstalled(name: string): LocalModelEntry | null {
  const clean = name.trim().toLowerCase();
  const direct = LOCAL_MODEL_CATALOG.find((m) => m.id.toLowerCase() === clean);
  if (direct) return direct;
  const base = clean.split(':')[0] ?? clean;
  const size = clean.split(':')[1] ?? '';
  return LOCAL_MODEL_CATALOG.find((m) => {
    if (m.family.toLowerCase() !== base && !m.id.toLowerCase().startsWith(`${base}:`)) return false;
    if (!size) return true;
    return m.id.toLowerCase().includes(size.split('-')[0] ?? size);
  }) ?? null;
}
