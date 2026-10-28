import { useMemo } from 'react';
import { cn } from '@/lib/cn';

const SAMPLE: Record<string, string> = {
  'src/stores/useJarvisStore.ts': `import { create } from 'zustand';
import type { AgentEvent, AgentState } from '@/types';
import { routePrompt } from '@/services/ai/ModelRouter';

export const useJarvisStore = create<JarvisState>((set, get) => ({
  state: 'idle',
  permission: 'ASSIST',
  events: [],

  submit: (prompt) => {
    const routing = routePrompt(prompt);
    const script = scriptFor(routing.taskType, prompt);
    set({ routing, running: true, state: 'thinking' });
  },

  stop: () => {
    clearTimers();
    set({ running: false, state: 'idle', approval: null });
  },
}));`,
  'src/services/ai/ModelRouter.ts': `export function routePrompt(prompt: string): RoutingDecision {
  const match = SIGNALS.find((s) => s.patterns.some((r) => r.test(prompt)));
  const difficulty = Math.min(10, match.difficulty + lengthBump);

  return {
    taskType: match.taskType,
    difficulty,
    preferredProvider: match.provider,
    modelTier: match.tier,
    reason: match.reason,
  };
}`,
};

const FALLBACK = `// Este archivo todavía no tiene vista previa.
// El editor real llega cuando se monte Monaco sobre este mismo componente.`;

const KEYWORDS = /\b(import|from|export|const|let|return|function|interface|type|if|else|new|await|async)\b/g;

/** Placeholder surface. Swap the body for Monaco without touching CodingView. */
export function CodeSurface({ path }: { path: string }) {
  const code = SAMPLE[path] ?? FALLBACK;
  const lines = useMemo(() => code.split('\n'), [code]);

  return (
    <div className="h-full overflow-auto scroll-thin bg-void/40">
      <pre className="font-mono text-xs leading-[19px] py-3">
        {lines.map((line, i) => (
          <div key={i} className="flex hover:bg-white/[0.02]">
            <span className="w-11 shrink-0 text-right pr-3 text-faint/60 select-none tnum">{i + 1}</span>
            <code
              className={cn('flex-1 pr-6 whitespace-pre', line.trim().startsWith('//') ? 'text-faint' : 'text-ink/85')}
              dangerouslySetInnerHTML={{
                __html: line
                  .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
                  .replace(/'([^']*)'/g, '<span style="color:#7FA35E">\'$1\'</span>')
                  .replace(KEYWORDS, '<span style="color:#79A9FF">$1</span>'),
              }}
            />
          </div>
        ))}
      </pre>
    </div>
  );
}
