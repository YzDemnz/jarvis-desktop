import type { MarketNews, Position, Quote, ScenarioAnalysis } from '@/types';

function spark(seed: number, n = 40, drift = 0): number[] {
  const out: number[] = [];
  let v = 100;
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const r = (s / 2147483648 - 0.5) * 2.4;
    v = Math.max(1, v + r + drift);
    out.push(Number(v.toFixed(2)));
  }
  return out;
}

export const mockQuotes: Quote[] = [
  { symbol: 'NVDA', name: 'NVIDIA', assetClass: 'equity', price: 184.62, change: 4.31, changePercent: 2.39, volume: 218_400_000, marketCap: 4.52e12, spark: spark(7, 40, 0.28) },
  { symbol: 'AMD', name: 'Advanced Micro Devices', assetClass: 'equity', price: 162.08, change: -1.94, changePercent: -1.18, volume: 61_200_000, marketCap: 2.6e11, spark: spark(13, 40, -0.1) },
  { symbol: 'MSFT', name: 'Microsoft', assetClass: 'equity', price: 512.44, change: 2.11, changePercent: 0.41, volume: 19_800_000, marketCap: 3.8e12, spark: spark(21, 40, 0.06) },
  { symbol: 'TSM', name: 'Taiwan Semiconductor', assetClass: 'equity', price: 241.7, change: 3.02, changePercent: 1.27, volume: 14_100_000, spark: spark(31, 40, 0.14) },
  { symbol: 'SPX', name: 'S&P 500', assetClass: 'index', price: 6_412.9, change: 18.4, changePercent: 0.29, volume: 0, spark: spark(41, 40, 0.05) },
  { symbol: 'NDX', name: 'Nasdaq 100', assetClass: 'index', price: 23_884.1, change: 96.2, changePercent: 0.4, volume: 0, spark: spark(47, 40, 0.09) },
  { symbol: 'DXY', name: 'Dollar Index', assetClass: 'forex', price: 97.84, change: -0.21, changePercent: -0.21, volume: 0, spark: spark(53, 40, -0.03) },
  { symbol: 'BTC', name: 'Bitcoin', assetClass: 'crypto', price: 113_240, change: -1_820, changePercent: -1.58, volume: 32_000_000_000, spark: spark(59, 40, -0.22) },
  { symbol: 'ETH', name: 'Ethereum', assetClass: 'crypto', price: 4_186, change: 62, changePercent: 1.5, volume: 14_000_000_000, spark: spark(61, 40, 0.11) },
  { symbol: 'EURUSD', name: 'Euro / Dólar', assetClass: 'forex', price: 1.0912, change: 0.0014, changePercent: 0.13, volume: 0, spark: spark(67, 40, 0.01) },
  { symbol: 'XAU', name: 'Oro', assetClass: 'commodity', price: 3_684.2, change: 21.6, changePercent: 0.59, volume: 0, spark: spark(71, 40, 0.08) },
  { symbol: 'CL', name: 'Crudo WTI', assetClass: 'commodity', price: 68.44, change: -0.82, changePercent: -1.18, volume: 0, spark: spark(73, 40, -0.07) },
];

export const mockNews: MarketNews[] = [
  { id: 'n1', headline: 'Los hiperescaladores elevan su guía de capex para el próximo año fiscal', source: 'Reuters', publishedAt: Date.now() - 1000 * 60 * 24, symbols: ['NVDA', 'MSFT'], sentiment: 'positive' },
  { id: 'n2', headline: 'Nuevas restricciones de exportación entran en revisión regulatoria', source: 'Bloomberg', publishedAt: Date.now() - 1000 * 60 * 95, symbols: ['NVDA', 'AMD', 'TSM'], sentiment: 'negative' },
  { id: 'n3', headline: 'La cadena de suministro de memoria HBM sigue ajustada hasta el segundo trimestre', source: 'DigiTimes', publishedAt: Date.now() - 1000 * 60 * 180, symbols: ['NVDA', 'TSM'], sentiment: 'neutral' },
  { id: 'n4', headline: 'Rotación hacia semiconductores tras datos de inflación más suaves', source: 'WSJ', publishedAt: Date.now() - 1000 * 60 * 320, symbols: ['SPX', 'NDX'], sentiment: 'positive' },
  { id: 'n5', headline: 'Un competidor anuncia un acelerador de inferencia de menor coste', source: 'The Information', publishedAt: Date.now() - 1000 * 60 * 480, symbols: ['NVDA', 'AMD'], sentiment: 'negative' },
];

export const mockScenarios: ScenarioAnalysis[] = [
  {
    bias: 'bullish', confidence: 0.42,
    thesis: 'La demanda de cómputo para entrenamiento sigue por encima de la oferta y el capex anunciado cubre los próximos cuatro trimestres.',
    catalysts: ['Guía de capex al alza', 'Cuellos de botella en HBM que favorecen al líder', 'Ciclo de renovación en centros de datos'],
    risks: ['Múltiplo ya exigente', 'Concentración de ingresos en pocos clientes'],
    invalidation: 'Cierre semanal por debajo de 168 con volumen en expansión.',
    sources: [{ title: 'Reuters · capex hiperescaladores', url: 'https://reuters.com' }, { title: 'DigiTimes · HBM', url: 'https://digitimes.com' }],
  },
  {
    bias: 'neutral', confidence: 0.35,
    thesis: 'El precio descuenta ya un escenario de ejecución perfecta; el rango 168–192 concentra la mayor parte del volumen reciente.',
    catalysts: ['Resultados dentro de guía', 'Sin cambios regulatorios inmediatos'],
    risks: ['Compresión de márgenes por mezcla de producto'],
    invalidation: 'Ruptura sostenida de cualquiera de los extremos del rango.',
    sources: [{ title: 'WSJ · rotación sectorial', url: 'https://wsj.com' }],
  },
  {
    bias: 'bearish', confidence: 0.23,
    thesis: 'Un endurecimiento de controles de exportación o un competidor creíble en inferencia reducirían el crecimiento esperado.',
    catalysts: ['Revisión regulatoria en curso', 'Anuncio de acelerador rival'],
    risks: ['El mercado podría ignorar el riesgo regulatorio si los resultados sorprenden'],
    invalidation: 'Recuperación por encima de 192 tras la publicación de resultados.',
    sources: [{ title: 'Bloomberg · controles de exportación', url: 'https://bloomberg.com' }, { title: 'The Information · competencia', url: 'https://theinformation.com' }],
  },
];

export const mockPositions: Position[] = [
  { id: 'pos1', symbol: 'NVDA', side: 'long', quantity: 120, entry: 171.4, mark: 184.62, paper: true },
  { id: 'pos2', symbol: 'TSM', side: 'long', quantity: 200, entry: 236.1, mark: 241.7, paper: true },
  { id: 'pos3', symbol: 'BTC', side: 'short', quantity: 0.8, entry: 118_900, mark: 113_240, paper: true },
];

export function mockBook(mid: number) {
  const bids = Array.from({ length: 9 }, (_, i) => ({ price: Number((mid - (i + 1) * 0.06).toFixed(2)), size: Math.round(400 + Math.sin(i * 1.7) * 280 + i * 90) }));
  const asks = Array.from({ length: 9 }, (_, i) => ({ price: Number((mid + (i + 1) * 0.06).toFixed(2)), size: Math.round(380 + Math.cos(i * 1.4) * 260 + i * 80) }));
  return { bids, asks };
}

export function mockCandles(symbol: string, points: number): number[] {
  let s = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const out: number[] = [];
  const base = mockQuotes.find((q) => q.symbol === symbol)?.price ?? 100;
  let v = base * 0.88;
  for (let i = 0; i < points; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const r = (s / 2147483648 - 0.48) * base * 0.022;
    v = Math.max(base * 0.5, v + r + (base * 0.12) / points);
    out.push(Number(v.toFixed(2)));
  }
  out[out.length - 1] = base;
  return out;
}
