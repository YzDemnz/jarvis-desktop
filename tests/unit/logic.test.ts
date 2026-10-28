import { routePrompt } from '../../src/services/ai/ModelRouter';
import { scriptFor } from '../../src/services/agent/scripts';
import { normalizeInput } from '../../src/services/browser/omnibox';
import { TOOL_REGISTRY, permissionRank } from '../../src/services/agent/tools';
import { mockQuotes, mockScenarios, mockCandles } from '../../src/mocks/markets';
import { mockMarketService } from '../../src/services/markets/MockMarketService';
import { bytes, price, signed, sparkPath } from '../../src/lib/format';
import { shellNavigationAllowed, safeExternalUrl } from '../../electron/security';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const t = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};

console.log('\n— ModelRouter —');
const r1 = routePrompt('Analiza NVIDIA');
t('“Analiza NVIDIA” → market_analysis', r1.taskType === 'market_analysis', r1.taskType);
t('elige un modelo', !!r1.selectedModelId, JSON.stringify(r1.selectedModelId));
t('confianza en rango', r1.confidence > 0 && r1.confidence <= 1, String(r1.confidence));
t('dificultad 1..10', r1.difficulty >= 1 && r1.difficulty <= 10, String(r1.difficulty));
const r2 = routePrompt('busca config.json en mi PC');
t('búsqueda de archivos → file_search', r2.taskType === 'file_search', r2.taskType);
t('file_search se queda en local', r2.modelTier === 'LOCAL', r2.modelTier);
const r3 = routePrompt('hola');
t('saludo → chat', r3.taskType === 'chat', r3.taskType);
const r4 = routePrompt('abre Blender');
t('“abre Blender” → computer_control', r4.taskType === 'computer_control', r4.taskType);

console.log('\n— Guiones del agente —');
const s1 = scriptFor('market_analysis', 'Analiza NVIDIA');
t('market_analysis trae 5 carriles', s1.lanes.length === 5, String(s1.lanes.length));
t('market_analysis trae pasos', s1.steps.length >= 10, String(s1.steps.length));
t('todos los pasos tienen delay > 0', s1.steps.every((x) => x.delay > 0));
t('los carriles referenciados existen',
  s1.steps.filter((x) => x.lane).every((x) => s1.lanes.some((l) => l.id === x.lane)),
  s1.steps.filter((x) => x.lane && !s1.lanes.some((l) => l.id === x.lane)).map((x) => x.lane).join(','));
t('hay respuesta final', s1.answer.length > 40);
const s2 = scriptFor('computer_control', 'abre Blender');
t('computer_control pide aprobación', s2.steps.some((x) => !!x.approval));
const types = ['market_analysis','file_search','code_debugging','computer_control','web_research','chat'] as const;
t('todos los tipos devuelven guion', types.every((k) => scriptFor(k as never, 'x').steps.length > 0));

console.log('\n— Omnibox —');
t('dominio → url', normalizeInput('github.com').kind === 'url', normalizeInput('github.com').kind);
t('https → url', normalizeInput('https://a.dev/x').kind === 'url');
t('una palabra → search', normalizeInput('electron').kind === 'search', normalizeInput('electron').kind);
t('frase larga → command', normalizeInput('analiza el mercado de nvidia hoy').kind === 'command',
  normalizeInput('analiza el mercado de nvidia hoy').kind);

console.log('\n— Shell y enlaces externos —');
const shellIndex = resolve('dist/index.html');
t('la página propia puede navegar', shellNavigationAllowed(pathToFileURL(shellIndex).href, shellIndex));
t('otro archivo no entra al shell', !shellNavigationAllowed(pathToFileURL(resolve('dist/other.html')).href, shellIndex));
t('el origen dev autorizado puede navegar', shellNavigationAllowed('http://localhost:5173/panel', shellIndex, 'http://localhost:5173'));
t('origen remoto no entra al shell', !shellNavigationAllowed('https://example.com', shellIndex, 'http://localhost:5173'));
t('HTTPS externo aceptado', safeExternalUrl('https://example.com/a') === 'https://example.com/a');
t('archivos y protocolos de SO bloqueados', safeExternalUrl('file:///C:/Windows/notepad.exe') === null && safeExternalUrl('ms-settings:') === null);
t('URL externa con credenciales bloqueada', safeExternalUrl('https://user:pass@example.com') === null);

console.log('\n— Herramientas —');
t('el registro trae herramientas', TOOL_REGISTRY.length >= 20, String(TOOL_REGISTRY.length));
t('toda herramienta declara riesgo y categoría', TOOL_REGISTRY.every((x) => !!x.risk && !!x.category));
t('toda herramienta tiene permiso y estrategia',
  TOOL_REGISTRY.every((x) => !!x.requiredPermission && !!x.strategy));
t('jerarquía de permisos ordenada', permissionRank('OBSERVE') < permissionRank('ADMIN'));

console.log('\n— Mercados —');
t('12 cotizaciones', mockQuotes.length === 12, String(mockQuotes.length));
t('3 escenarios', mockScenarios.length === 3);
const conf = mockScenarios.reduce((a, s) => a + s.confidence, 0);
t('las confianzas suman ~1', Math.abs(conf - 1) < 0.02, String(conf));
const closes = mockCandles('NVDA', 60);
t('60 cierres', closes.length === 60, String(closes.length));
t('cierres deterministas', JSON.stringify(mockCandles('NVDA', 20)) === JSON.stringify(mockCandles('NVDA', 20)));

const svc = mockMarketService;
await (async () => {
  const cs = await svc.candles('NVDA', '1D');
  t('el servicio devuelve velas OHLC', cs.length > 0 && typeof cs[0]!.h === 'number');
  t('velas coherentes (h>=l)', cs.every((c) => c.h >= c.l));
  t('cuerpo dentro de la mecha', cs.every((c) => c.h >= c.o && c.h >= c.c && c.l <= c.o && c.l <= c.c));
  t('volumen positivo', cs.every((c) => c.v > 0));
  const q = await svc.quotes(['NVDA', 'BTC']);
  t('quotes filtra por símbolo', q.length === 2, String(q.length));
  const bk = await svc.book('NVDA');
  t('libro con bids y asks', bk.bids.length > 0 && bk.asks.length > 0);
  t('mejor bid por debajo del mejor ask', bk.bids[0]!.price < bk.asks[0]!.price);
})();

console.log('\n— Formato —');
t('bytes conserva la fracción', bytes(1536).includes('1.5'), bytes(1536));
t('bytes en GB', bytes(62e9).includes('GB'), bytes(62e9));
t('price', price(184.62).includes('184.62'), price(184.62));
t('signed positivo lleva +', signed(2.39).startsWith('+'), signed(2.39));
t('sparkPath produce path', sparkPath([1, 5, 3, 8], 100, 20).startsWith('M'));

console.log(`\n${pass} ok · ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
