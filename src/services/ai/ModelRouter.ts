import type { ModelTier, ProviderId, RoutingDecision, TaskType } from '@/types';
import { mockProviders } from '@/mocks/providers';

interface Signal {
  taskType: TaskType;
  patterns: RegExp[];
  difficulty: number;
  tier: ModelTier;
  provider: ProviderId;
  reason: string;
  flags?: Partial<Pick<RoutingDecision, 'requiresWeb' | 'requiresVision' | 'requiresFiles' | 'requiresCode' | 'requiresReasoning'>>;
}

/**
 * Stand-in for the local Ollama router. Same shape as the real thing:
 * classify → score difficulty → pick tier → pick provider → explain.
 * Swap the body for a real completion call without touching the UI.
 */
const SIGNALS: Signal[] = [
  {
    taskType: 'market_analysis',
    patterns: [/\b(analiza|compara|precio|mercado|acci[oó]n|ticker|nvda|amd|btc|invert)/i],
    difficulty: 8, tier: 'REASONING', provider: 'anthropic',
    reason: 'Análisis multi-fuente con escenarios y riesgo',
    flags: { requiresWeb: true, requiresReasoning: true },
  },
  {
    taskType: 'code_debugging',
    patterns: [/\b(error|bug|falla|stack|excepci[oó]n|no compila|typescript|depura)/i],
    difficulty: 8, tier: 'REASONING', provider: 'anthropic',
    reason: 'Base de código extensa + razonamiento sostenido',
    flags: { requiresCode: true, requiresFiles: true, requiresReasoning: true },
  },
  {
    taskType: 'code_generation',
    patterns: [/\b(escribe|genera|implementa|refactoriza|componente|funci[oó]n)\b/i],
    difficulty: 6, tier: 'STANDARD', provider: 'openai',
    reason: 'Generación acotada con contexto moderado',
    flags: { requiresCode: true },
  },
  {
    taskType: 'file_search',
    patterns: [/\b(archivo|carpeta|encuentra|localiza|en mi (pc|equipo|disco)|disco|ruta|directorio)\b/i, /\.(json|ts|tsx|md|csv|pdf|png|zip|xlsx)\b/i],
    difficulty: 3, tier: 'LOCAL', provider: 'local',
    reason: 'Indexación local, sin salir del equipo',
    flags: { requiresFiles: true },
  },
  {
    taskType: 'web_research',
    patterns: [/\b(busca|investiga|documentaci[oó]n|noticias|qu[eé] dicen)\b/i],
    difficulty: 5, tier: 'STANDARD', provider: 'google',
    reason: 'Contexto amplio y recuperación web',
    flags: { requiresWeb: true },
  },
  {
    taskType: 'computer_control',
    patterns: [/\b(abre|ejecuta|cierra|instala|mueve el|haz clic|controla)\b/i],
    difficulty: 6, tier: 'FAST', provider: 'local',
    reason: 'Latencia baja y herramientas del sistema',
    flags: { requiresFiles: true },
  },
  {
    taskType: 'vision',
    patterns: [/\b(pantalla|captura|esta imagen|lo que ves|screenshot)\b/i],
    difficulty: 6, tier: 'STANDARD', provider: 'openai',
    reason: 'Requiere modelo con visión',
    flags: { requiresVision: true },
  },
];

const FALLBACK: Signal = {
  taskType: 'chat', patterns: [], difficulty: 2, tier: 'FAST', provider: 'local',
  reason: 'Conversación corta, se resuelve en local',
};

function pickModelId(provider: ProviderId, tier: ModelTier): string {
  const p = mockProviders.find((x) => x.id === provider) ?? mockProviders[0]!;
  const exact = p.models.find((m) => m.tier === tier);
  return (exact ?? p.models[0]!).id;
}

export function routePrompt(prompt: string, contextSize = 4_000): RoutingDecision {
  const started = performance.now();
  const match = SIGNALS.find((s) => s.patterns.some((r) => r.test(prompt))) ?? FALLBACK;
  const lengthBump = Math.min(2, Math.floor(prompt.length / 180));
  const difficulty = Math.min(10, match.difficulty + lengthBump);

  return {
    taskType: match.taskType,
    difficulty,
    contextSize,
    requiresWeb: match.flags?.requiresWeb ?? false,
    requiresVision: match.flags?.requiresVision ?? false,
    requiresFiles: match.flags?.requiresFiles ?? false,
    requiresCode: match.flags?.requiresCode ?? false,
    requiresReasoning: match.flags?.requiresReasoning ?? difficulty >= 7,
    preferredProvider: match.provider,
    modelTier: match.tier,
    selectedModelId: pickModelId(match.provider, match.tier),
    reason: match.reason,
    confidence: Math.min(0.96, 0.55 + difficulty * 0.04),
    routedBy: 'local-router',
    elapsedMs: Math.round(performance.now() - started) + 34,
  };
}

export function providerLabel(id: ProviderId): string {
  return mockProviders.find((p) => p.id === id)?.label ?? id;
}

export function modelLabel(modelId: string): string {
  for (const p of mockProviders) {
    const m = p.models.find((x) => x.id === modelId);
    if (m) return `${p.label} · ${m.label}`;
  }
  return modelId;
}
