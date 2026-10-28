import { useMemo, useState } from 'react';
import type { Timeframe } from '@/types';
import { mockBook, mockNews, mockPositions, mockQuotes, mockScenarios } from '@/mocks/markets';
import { seriesFor } from '@/services/markets/MockMarketService';
import { PriceChart } from '@/components/PriceChart';
import { Panel } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ScenarioBoard } from '../markets/ScenarioBoard';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useUIStore } from '@/stores/useUIStore';
import { ago, compact, price, signed } from '@/lib/format';
import { cn } from '@/lib/cn';

export function TradingView() {
  const [symbol, setSymbol] = useState('NVDA');
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const submit = useJarvisStore((s) => s.submit);
  const setJarvisOpen = useUIStore((s) => s.setJarvisOpen);

  const quote = mockQuotes.find((q) => q.symbol === symbol)!;
  const up = quote.change >= 0;
  const series = useMemo(() => seriesFor(symbol, timeframe), [symbol, timeframe]);
  const book = useMemo(() => mockBook(quote.price), [quote.price]);
  const maxSize = Math.max(...book.bids.map((b) => b.size), ...book.asks.map((a) => a.size));

  const pnl = mockPositions.reduce((acc, p) => {
    const dir = p.side === 'long' ? 1 : -1;
    return acc + (p.mark - p.entry) * p.quantity * dir;
  }, 0);
  const exposure = mockPositions.reduce((acc, p) => acc + p.mark * p.quantity, 0);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-3 px-4 h-10 hairline-b bg-graphite/60">
        <div className="flex items-center gap-1">
          {['NVDA', 'AMD', 'TSM', 'BTC', 'SPX'].map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={cn(
                'h-6 px-2 rounded-xs text-xs transition-colors',
                s === symbol ? 'bg-white/[0.08] text-ink' : 'text-faint hover:text-ink hover:bg-white/[0.04]',
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <span className="text-lg tnum text-ink ml-3">{price(quote.price)}</span>
        <span className={cn('text-xs tnum', up ? 'text-moss' : 'text-clay')}>{signed(quote.changePercent)}%</span>

        <Badge tone="amber" className="ml-auto">Paper trading</Badge>
        <Button variant="quiet" data-authority-action onClick={() => { setJarvisOpen(true); submit(`Analiza ${symbol}`); }}>
          Pedir análisis
        </Button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[1fr_270px] grid-rows-[1fr_218px] gap-2.5 p-2.5">
        <Panel className="row-span-1" bodyClassName="min-h-0">
          <PriceChart values={series} color={up ? '#3FB68B' : '#DC5F52'} timeframe={timeframe} onTimeframe={setTimeframe} symbol={symbol} height={260} />
        </Panel>

        <Panel title="Libro de órdenes" meta="simulado" className="row-span-2" bodyClassName="overflow-y-auto scroll-thin">
          <div className="px-2 py-1.5">
            {[...book.asks].reverse().map((a) => (
              <BookRow key={`a${a.price}`} price={a.price} size={a.size} max={maxSize} side="ask" />
            ))}
            <div className="flex items-center justify-center h-7 my-0.5 hairline-t hairline-b">
              <span className="text-xs tnum text-ink">{price(quote.price)}</span>
              <span className="text-2xs text-faint ml-2">spread 0.06</span>
            </div>
            {book.bids.map((b) => (
              <BookRow key={`b${b.price}`} price={b.price} size={b.size} max={maxSize} side="bid" />
            ))}
          </div>
        </Panel>

        <div className="grid grid-cols-2 gap-2.5 min-h-0">
          <Panel title="Posiciones" meta="paper" bodyClassName="overflow-y-auto scroll-thin">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-2xs text-faint">
                  <th className="text-left font-normal px-3 py-1.5">Símbolo</th>
                  <th className="text-right font-normal px-2">Cant.</th>
                  <th className="text-right font-normal px-2">Entrada</th>
                  <th className="text-right font-normal px-3">P&L</th>
                </tr>
              </thead>
              <tbody>
                {mockPositions.map((p) => {
                  const dir = p.side === 'long' ? 1 : -1;
                  const value = (p.mark - p.entry) * p.quantity * dir;
                  return (
                    <tr key={p.id} className="hairline-t">
                      <td className="px-3 py-1.5">
                        <span className="text-ink/90">{p.symbol}</span>
                        <span className={cn('ml-1.5 text-2xs', p.side === 'long' ? 'text-moss' : 'text-clay')}>
                          {p.side === 'long' ? 'L' : 'S'}
                        </span>
                      </td>
                      <td className="text-right px-2 tnum text-muted">{p.quantity}</td>
                      <td className="text-right px-2 tnum text-muted">{price(p.entry)}</td>
                      <td className={cn('text-right px-3 tnum', value >= 0 ? 'text-moss' : 'text-clay')}>
                        {signed(value, 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>

          <div className="grid grid-rows-2 gap-2.5 min-h-0">
            <Panel title="Cartera" bodyClassName="p-3">
              <dl className="grid grid-cols-2 gap-y-2">
                <div>
                  <dt className="text-2xs text-faint">P&L abierto</dt>
                  <dd className={cn('text-base tnum', pnl >= 0 ? 'text-moss' : 'text-clay')}>{signed(pnl, 0)}</dd>
                </div>
                <div>
                  <dt className="text-2xs text-faint">Exposición</dt>
                  <dd className="text-base tnum text-ink/90">{compact(exposure)}</dd>
                </div>
                <div>
                  <dt className="text-2xs text-faint">Posiciones</dt>
                  <dd className="text-base tnum text-ink/90">{mockPositions.length}</dd>
                </div>
                <div>
                  <dt className="text-2xs text-faint">Modo</dt>
                  <dd className="text-sm text-amber">Simulación</dd>
                </div>
              </dl>
            </Panel>

            <Panel title="Titulares" bodyClassName="overflow-y-auto scroll-thin">
              <ul>
                {mockNews.slice(0, 4).map((n) => (
                  <li key={n.id} className="px-3 py-1.5 hairline-b last:border-0">
                    <p className="text-2xs text-ink/80 leading-snug line-clamp-2">{n.headline}</p>
                    <span className="text-2xs text-faint">{n.source} · {ago(n.publishedAt)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </div>

      <div className="shrink-0 hairline-t p-2.5">
        <Panel title="Market Intelligence" meta="escenarios, no predicciones" bodyClassName="p-3 max-h-[280px] overflow-y-auto scroll-thin">
          <div className="grid grid-cols-3 gap-3">
            {mockScenarios.map((s) => (
              <ScenarioBoard key={s.bias} scenarios={[s]} />
            ))}
          </div>
          <p className="text-2xs text-faint mt-3 pt-3 hairline-t">
            Ninguna orden real se envía desde aquí. La ruta prevista es investigación, análisis, simulación,
            paper trade, propuesta de orden, aprobación humana y sólo entonces bróker.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function BookRow({ price: p, size, max, side }: { price: number; size: number; max: number; side: 'bid' | 'ask' }) {
  return (
    <div className="relative flex items-center h-[19px] px-1.5 text-2xs">
      <span
        className={cn('absolute inset-y-[2px] right-1.5 rounded-xs', side === 'bid' ? 'bg-moss/10' : 'bg-clay/10')}
        style={{ width: `${(size / max) * 72}%` }}
      />
      <span className={cn('relative tnum w-16', side === 'bid' ? 'text-moss' : 'text-clay')}>{p.toFixed(2)}</span>
      <span className="relative tnum text-muted ml-auto">{size}</span>
    </div>
  );
}
