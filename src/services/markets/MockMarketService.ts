import type { Candle, MarketService, Timeframe } from '@/types';
import { mockBook, mockCandles, mockNews, mockQuotes, mockScenarios } from '@/mocks/markets';

const POINTS: Record<Timeframe, number> = { '1D': 78, '5D': 120, '1M': 160, '3M': 200, '1Y': 260 };

export const mockMarketService: MarketService = {
  async quotes(symbols) {
    if (!symbols.length) return mockQuotes;
    return mockQuotes.filter((q) => symbols.includes(q.symbol));
  },
  async candles(symbol, timeframe) {
    const closes = mockCandles(symbol, POINTS[timeframe]);
    const out: Candle[] = closes.map((c, i) => {
      const o = i === 0 ? c : closes[i - 1]!;
      // La mecha siempre envuelve al cuerpo: si no, la vela es inválida.
      const body = { hi: Math.max(o, c), lo: Math.min(o, c) };
      const wick = Math.max(c * 0.0015, (body.hi - body.lo) * 0.35);
      return {
        t: Date.now() - (closes.length - i) * 60_000,
        o,
        h: Number((body.hi + wick).toFixed(2)),
        l: Number((body.lo - wick).toFixed(2)),
        c,
        v: 1_000_000 + ((i * 7919) % 900_000),
      };
    });
    return out;
  },
  async news(symbols) {
    if (!symbols?.length) return mockNews;
    return mockNews.filter((n) => n.symbols.some((s) => symbols.includes(s)));
  },
  async analyze() { return mockScenarios; },
  async book(symbol) {
    const mid = mockQuotes.find((q) => q.symbol === symbol)?.price ?? 100;
    return mockBook(mid);
  },
};

export function seriesFor(symbol: string, timeframe: Timeframe): number[] {
  return mockCandles(symbol, POINTS[timeframe]);
}
