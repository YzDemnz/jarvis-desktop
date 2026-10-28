import { useMemo, useState } from 'react';
import type { AssetClass, Timeframe } from '@/types';
import { mockNews, mockQuotes, mockScenarios } from '@/mocks/markets';
import { seriesFor } from '@/services/markets/MockMarketService';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useUIStore } from '@/stores/useUIStore';
import { PriceChart } from '@/components/PriceChart';
import { Sparkline } from '@/components/ui/Sparkline';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { ScenarioBoard } from './ScenarioBoard';
import { ago, compact, price, signed } from '@/lib/format';
import { cn } from '@/lib/cn';

const CLASS_LABEL: Record<AssetClass, string> = {
  equity: 'Acciones', index: 'Índices', crypto: 'Cripto', forex: 'Divisas', commodity: 'Materias',
};

export function MarketsView() {
  const [symbol, setSymbol] = useState('NVDA');
  const [timeframe, setTimeframe] = useState<Timeframe>('1M');
  const [filter, setFilter] = useState<AssetClass | 'all'>('all');
  const submit = useJarvisStore((s) => s.submit);
  const setJarvisOpen = useUIStore((s) => s.setJarvisOpen);

  const quote = mockQuotes.find((q) => q.symbol === symbol)!;
  const up = quote.change >= 0;
  const color = up ? '#3FB68B' : '#DC5F52';
  const series = useMemo(() => seriesFor(symbol, timeframe), [symbol, timeframe]);
  const news = mockNews.filter((n) => n.symbols.includes(symbol) || filter === 'all').slice(0, 5);

  const watchlist = filter === 'all' ? mockQuotes : mockQuotes.filter((q) => q.assetClass === filter);

  return (
    <div className="h-full flex min-h-0">
      {/* Watchlist */}
      <aside className="w-[248px] shrink-0 flex flex-col hairline-r bg-graphite/60 min-h-0">
        <div className="flex items-center gap-1 px-2 h-9 hairline-b overflow-x-auto scroll-thin">
          {(['all', 'equity', 'index', 'crypto', 'forex', 'commodity'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={cn(
                'h-6 px-1.5 rounded-xs text-2xs whitespace-nowrap transition-colors',
                c === filter ? 'bg-white/[0.08] text-ink' : 'text-faint hover:text-ink',
              )}
            >
              {c === 'all' ? 'Todo' : CLASS_LABEL[c]}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
          {watchlist.map((q) => {
            const qUp = q.change >= 0;
            const selected = q.symbol === symbol;
            return (
              <button
                key={q.symbol}
                onClick={() => setSymbol(q.symbol)}
                className={cn(
                  'relative w-full flex items-center gap-2 px-3 h-[42px] text-left transition-colors',
                  selected ? 'bg-white/[0.05]' : 'hover:bg-white/[0.025]',
                )}
              >
                {selected && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-signal" />}
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink/90">{q.symbol}</div>
                  <div className="text-2xs text-faint truncate">{q.name}</div>
                </div>
                <Sparkline values={q.spark} color={qUp ? '#3FB68B' : '#DC5F52'} width={38} height={16} />
                <div className="text-right shrink-0 w-[62px]">
                  <div className="text-xs tnum text-ink/90">{price(q.price)}</div>
                  <div className={cn('text-2xs tnum', qUp ? 'text-moss' : 'text-clay')}>{signed(q.changePercent)}%</div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Chart and detail */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <header className="shrink-0 px-5 pt-4 pb-3 hairline-b">
          <div className="flex items-end gap-5 flex-wrap">
            <div>
              <div className="flex items-baseline gap-2.5">
                <h1 className="text-xl text-ink tracking-tight">{quote.symbol}</h1>
                <span className="text-sm text-faint">{quote.name}</span>
              </div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-[26px] tnum leading-none text-ink">{price(quote.price)}</span>
                <span className={cn('text-sm tnum', up ? 'text-moss' : 'text-clay')}>
                  {signed(quote.change)} ({signed(quote.changePercent)}%)
                </span>
              </div>
            </div>

            <dl className="flex items-center gap-6 ml-auto text-right">
              <div>
                <dt className="text-2xs text-faint">Volumen</dt>
                <dd className="text-sm tnum text-ink/85">{compact(quote.volume)}</dd>
              </div>
              {quote.marketCap && (
                <div>
                  <dt className="text-2xs text-faint">Capitalización</dt>
                  <dd className="text-sm tnum text-ink/85">{compact(quote.marketCap)}</dd>
                </div>
              )}
              <Button
                variant="solid"
                data-authority-action onClick={() => { setJarvisOpen(true); submit(`Analiza ${quote.symbol}`); }}
              >
                Analizar con JARVIS
              </Button>
            </dl>
          </div>
        </header>

        <div className="flex-1 min-h-0">
          <PriceChart values={series} color={color} timeframe={timeframe} onTimeframe={setTimeframe} symbol={symbol} height={300} />
        </div>

        <div className="shrink-0 h-[232px] grid grid-cols-2 gap-3 p-3 hairline-t">
          <Panel title="Noticias" bodyClassName="overflow-y-auto scroll-thin">
            <ul>
              {news.map((n) => (
                <li key={n.id} className="px-3.5 py-2 hairline-b last:border-0">
                  <p className="text-xs text-ink/85 leading-snug">{n.headline}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      n.sentiment === 'positive' ? 'bg-moss' : n.sentiment === 'negative' ? 'bg-clay' : 'bg-muted',
                    )} />
                    <span className="text-2xs text-faint">{n.source}</span>
                    <span className="text-2xs text-faint ml-auto">{ago(n.publishedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Lectura de JARVIS" meta={`${mockScenarios.length} escenarios`} bodyClassName="overflow-y-auto scroll-thin p-3">
            <ScenarioBoard scenarios={mockScenarios} compact />
          </Panel>
        </div>
      </div>
    </div>
  );
}
