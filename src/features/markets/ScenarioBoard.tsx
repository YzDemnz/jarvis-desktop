import type { ScenarioAnalysis } from '@/types';
import { cn } from '@/lib/cn';

const BIAS = {
  bullish: { label: 'Alcista', tone: 'text-moss', bar: 'bg-moss' },
  neutral: { label: 'Neutral', tone: 'text-muted', bar: 'bg-muted' },
  bearish: { label: 'Bajista', tone: 'text-clay', bar: 'bg-clay' },
} as const;

/**
 * Market opinions are always framed as competing scenarios with an
 * invalidation level — never as a single confident call.
 */
export function ScenarioBoard({ scenarios, compact = false }: { scenarios: ScenarioAnalysis[]; compact?: boolean }) {
  return (
    <div className={cn('space-y-2.5', compact && 'space-y-2')}>
      {scenarios.map((s) => {
        const b = BIAS[s.bias];
        return (
          <article key={s.bias} className="rounded border border-hairline bg-white/[0.02] p-2.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={cn('text-xs', b.tone)}>{b.label}</span>
              <span className="h-[3px] flex-1 max-w-[90px] rounded-full bg-white/[0.07] overflow-hidden">
                <span className={cn('block h-full rounded-full opacity-70', b.bar)} style={{ width: `${s.confidence * 100}%` }} />
              </span>
              <span className="text-2xs text-faint tnum">{Math.round(s.confidence * 100)}%</span>
            </div>

            <p className="text-xs text-muted leading-relaxed">{s.thesis}</p>

            {!compact && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2.5 pt-2.5 hairline-t">
                <div>
                  <div className="text-2xs text-faint mb-1">Catalizadores</div>
                  <ul className="space-y-0.5">
                    {s.catalysts.map((c) => (
                      <li key={c} className="text-2xs text-muted leading-snug">{c}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-2xs text-faint mb-1">Riesgos</div>
                  <ul className="space-y-0.5">
                    {s.risks.map((r) => (
                      <li key={r} className="text-2xs text-muted leading-snug">{r}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="mt-2 pt-2 hairline-t">
              <span className="text-2xs text-faint">Se invalida si </span>
              <span className="text-2xs text-ink/80">{s.invalidation.toLowerCase()}</span>
            </div>

            {!compact && s.sources.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {s.sources.map((src) => (
                  <a
                    key={src.url}
                    href={src.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-2xs text-faint hover:text-signal border border-hairline rounded-xs px-1.5 h-[16px] leading-[14px] transition-colors"
                  >
                    {src.title}
                  </a>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
