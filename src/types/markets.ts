export type AssetClass = 'equity' | 'index' | 'crypto' | 'forex' | 'commodity';

export interface Quote {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  spark: number[];
}

export type Timeframe = '1D' | '5D' | '1M' | '3M' | '1Y';

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface MarketNews {
  id: string;
  headline: string;
  source: string;
  publishedAt: number;
  symbols: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface ScenarioAnalysis {
  bias: 'bullish' | 'neutral' | 'bearish';
  thesis: string;
  /** 0–1 */
  confidence: number;
  catalysts: string[];
  risks: string[];
  invalidation: string;
  sources: { title: string; url: string }[];
}

export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entry: number;
  mark: number;
  /** Paper only. No broker is wired up. */
  paper: true;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface MarketService {
  quotes(symbols: string[]): Promise<Quote[]>;
  candles(symbol: string, timeframe: Timeframe): Promise<Candle[]>;
  news(symbols?: string[]): Promise<MarketNews[]>;
  analyze(symbol: string): Promise<ScenarioAnalysis[]>;
  book(symbol: string): Promise<{ bids: OrderBookLevel[]; asks: OrderBookLevel[] }>;
}
