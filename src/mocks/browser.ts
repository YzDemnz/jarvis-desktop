import type { Bookmark, DownloadItem, HistoryEntry } from '@/types';

/**
 * Only used when the renderer runs outside the Electron shell (plain `vite`),
 * so the browser module still has something to show. Inside the app, all of
 * this comes from the main process.
 */

const min = 60_000;
const now = Date.now();

export const mockHistory: HistoryEntry[] = [
  { id: 'h1', title: 'Electron · WebContentsView', url: 'https://electronjs.org/docs/latest/api/web-contents-view', visitedAt: now - min * 4, profileId: 'development' },
  { id: 'h2', title: 'NVIDIA Investor Relations', url: 'https://investor.nvidia.com', visitedAt: now - min * 26, profileId: 'trading' },
  { id: 'h3', title: 'Zustand · documentación', url: 'https://zustand.docs.pmnd.rs', visitedAt: now - min * 51, profileId: 'development' },
  { id: 'h4', title: 'Arma Reforger · server config', url: 'https://community.bistudio.com/wiki/Arma_Reforger:Server_Config', visitedAt: now - min * 190, profileId: 'personal' },
  { id: 'h5', title: 'Ollama · API reference', url: 'https://github.com/ollama/ollama/blob/main/docs/api.md', visitedAt: now - min * 320, profileId: 'development' },
];

export const mockBookmarks: Bookmark[] = [
  { id: 'b1', title: 'Electron docs', url: 'https://electronjs.org/docs', folder: 'Desarrollo', profileId: 'development', createdAt: now - min * 4000 },
  { id: 'b2', title: 'Tailwind CSS', url: 'https://tailwindcss.com/docs', folder: 'Desarrollo', profileId: 'development', createdAt: now - min * 3800 },
  { id: 'b3', title: 'TradingView', url: 'https://tradingview.com', folder: 'Mercados', profileId: 'trading', createdAt: now - min * 2600 },
  { id: 'b4', title: 'FRED · datos macro', url: 'https://fred.stlouisfed.org', folder: 'Mercados', profileId: 'trading', createdAt: now - min * 2200 },
  { id: 'b5', title: 'Reforger wiki', url: 'https://community.bistudio.com', folder: 'Reforger', profileId: 'personal', createdAt: now - min * 900 },
];

export const mockDownloads: DownloadItem[] = [
  { id: 'd1', filename: 'nvda-10q.pdf', url: 'https://investor.nvidia.com/nvda-10q.pdf', savePath: 'C:\\Users\\alejandro\\Downloads\\nvda-10q.pdf', bytes: 2_400_000, received: 2_400_000, state: 'completed', startedAt: now - min * 30 },
  { id: 'd2', filename: 'reforger-mods.zip', url: 'https://example.com/reforger-mods.zip', savePath: 'C:\\Users\\alejandro\\Downloads\\reforger-mods.zip', bytes: 812_000_000, received: 412_000_000, state: 'in_progress', startedAt: now - min * 3 },
  { id: 'd3', filename: 'dataset-macro.csv', url: 'https://fred.stlouisfed.org/dataset-macro.csv', savePath: 'C:\\Users\\alejandro\\Downloads\\dataset-macro.csv', bytes: 18_400_000, received: 18_400_000, state: 'completed', startedAt: now - min * 180 },
];

export const mockProfiles = [
  { id: 'personal' as const, label: 'Personal', accent: '#79A9FF', description: 'Navegación diaria y cuentas personales.' },
  { id: 'work' as const, label: 'Work', accent: '#A78BFA', description: 'Cuentas de trabajo, aisladas de las personales.' },
  { id: 'trading' as const, label: 'Trading', accent: '#DC5F52', description: 'Brókers y terminales de mercado.' },
  { id: 'development' as const, label: 'Development', accent: '#3FB68B', description: 'Entornos locales, paneles y documentación.' },
];
