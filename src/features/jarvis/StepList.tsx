import { Check, CircleDashed, Loader2, ShieldAlert, X } from 'lucide-react';
import type { AgentStep, AgentStepStatus } from '@/types';
import { cn } from '@/lib/cn';

const MARK: Record<AgentStepStatus, { icon: typeof Check; tone: string; spin?: boolean }> = {
  queued: { icon: CircleDashed, tone: 'text-faint' },
  running: { icon: Loader2, tone: 'text-signal', spin: true },
  awaiting_approval: { icon: ShieldAlert, tone: 'text-amber' },
  completed: { icon: Check, tone: 'text-moss' },
  failed: { icon: X, tone: 'text-clay' },
  cancelled: { icon: CircleDashed, tone: 'text-faint' },
  skipped: { icon: CircleDashed, tone: 'text-faint' },
};

/** UNDERSTAND → CHANGE → VERIFY, read from the tool a sub-step actually called. */
export function phaseOf(step: AgentStep): string | null {
  if (!step.parentId || !step.toolId) return null;
  if (/^file\.(patch|write|create|rename|move|copy|trash)$|^directory\.create$/.test(step.toolId)) return 'Cambiar';
  if (step.toolId === 'terminal.execute' || step.toolId === 'process.start') return 'Verificar';
  if (step.toolId === 'changes.review') return 'Revisar';
  return 'Entender';
}

/**
 * The plan as the user reads it: what is done, what is happening, what is
 * still waiting. Tool ids and arguments stay in Activity — this is the part
 * that belongs in the conversation.
 */
export function StepList({ steps }: { steps: AgentStep[] }) {
  if (!steps.length) return null;

  return (
    <ul className="space-y-1">
      {steps.map((step, i) => {
        const mark = MARK[step.status];
        const Icon = mark.icon;
        const dim = step.status === 'queued' || step.status === 'cancelled' || step.status === 'skipped';
        const phase = phaseOf(step);
        const prev = i > 0 ? phaseOf(steps[i - 1]!) : null;
        return (
          <li key={step.id} className={cn('flex items-start gap-2 min-w-0', step.parentId && 'pl-4')} data-testid={step.parentId ? 'substep' : step.kind === 'delegate' ? 'delegate-step' : 'step'} data-phase={phase ?? undefined}>
            {phase && phase !== prev && <span className="sr-only">{phase}</span>}
            <Icon
              className={cn('h-3 w-3 mt-[3px] shrink-0', mark.tone, mark.spin && 'animate-spin')}
              strokeWidth={step.status === 'completed' ? 2.2 : 1.7}
            />
            <span className={cn('text-xs leading-[17px] min-w-0 flex-1', dim ? 'text-faint' : 'text-ink/80')}>
              {phase && phase !== prev && <span className="font-mono text-2xs uppercase tracking-wide text-faint mr-1.5">{phase}</span>}
              {step.title}
              {step.summary && step.status === 'completed' && (
                <span className="text-faint"> · {step.summary}</span>
              )}
              {step.error && step.status === 'failed' && (
                <span className="text-clay/80"> · {step.error}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
