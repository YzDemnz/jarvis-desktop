import { useId, useMemo, useState } from 'react';
import type { Timeframe } from '@/types';
import { areaPath, price, sparkPath } from '@/lib/format';
import { cn } from '@/lib/cn';

interface Props {
  values: number[];
  color: string;
  height?: number;
  timeframe: Timeframe;
  onTimeframe: (t: Timeframe) => void;
  symbol: string;
}

const TIMEFRAMES: Timeframe[] = ['1D', '5D', '1M', '3M', '1Y'];
const W = 1000;

export function PriceChart({ values, color, height = 300, timeframe, onTimeframe, symbol }: Props) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const { min, max, line, area, volumes } = useMemo(() => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const volumes = values.map((_, i) => 0.25 + Math.abs(Math.sin(i * 0.7)) * 0.75);
    return {
      min, max,
      line: sparkPath(values, W, height, 6),
      area: areaPath(values, W, height, 6),
      volumes,
    };
  }, [values, height]);

  const hoverValue = hover !== null ? values[hover] : undefined;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-3 h-8 shrink-0">
        <div className="flex items-center gap-0.5">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              onClick={() => onTimeframe(t)}
              className={cn(
                'h-6 px-2 rounded-xs text-2xs tnum transition-colors',
                t === timeframe ? 'bg-white/[0.08] text-ink' : 'text-faint hover:text-ink hover:bg-white/[0.04]',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-2xs tnum text-faint">
          <span>máx {price(max)}</span>
          <span>mín {price(min)}</span>
          {hoverValue !== undefined && <span className="text-ink">{price(hoverValue)}</span>}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <svg
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          className="w-full h-full"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            setHover(Math.max(0, Math.min(values.length - 1, Math.round(ratio * (values.length - 1)))));
          }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.20" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={W} y1={height * f} y2={height * f} stroke="#ffffff" strokeOpacity="0.045" strokeWidth="1" />
          ))}

          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

          {hover !== null && (
            <>
              <line
                x1={6 + (hover * (W - 12)) / (values.length - 1)}
                x2={6 + (hover * (W - 12)) / (values.length - 1)}
                y1="0" y2={height}
                stroke={color} strokeOpacity="0.4" strokeWidth="1" vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={6 + (hover * (W - 12)) / (values.length - 1)}
                cy={6 + (height - 12) * (1 - ((values[hover]! - min) / (max - min || 1)))}
                r="3" fill={color}
              />
            </>
          )}
        </svg>
      </div>

      <div className="h-12 shrink-0 flex items-end gap-px px-1.5 pb-1" aria-label={`Volumen de ${symbol}`}>
        {volumes.map((v, i) => (
          <span
            key={i}
            className="flex-1 rounded-t-[1px]"
            style={{ height: `${v * 100}%`, background: color, opacity: hover === i ? 0.5 : 0.13 }}
          />
        ))}
      </div>
    </div>
  );
}
