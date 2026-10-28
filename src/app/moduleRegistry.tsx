import type { ComponentType } from 'react';
import type { ModuleId } from '@/types';
import { HomeView } from '@/features/home/HomeView';
import { BrowserView } from '@/features/browser/BrowserView';
import { MarketsView } from '@/features/markets/MarketsView';
import { TradingView } from '@/features/trading/TradingView';
import { ResearchView } from '@/features/research/ResearchView';
import { ProjectsView } from '@/features/projects/ProjectsView';
import { CodingView } from '@/features/coding/CodingView';
import { FilesView } from '@/features/files/FilesView';
import { VaultView } from '@/features/vault/VaultView';
import { StorageView } from '@/features/storage/StorageView';
import { AutomationsView } from '@/features/automations/AutomationsView';
import { HistoryView } from '@/features/history/HistoryView';
import { SettingsView } from '@/features/settings/SettingsView';

/** One place to register a module. Adding a screen touches this file and the sidebar only. */
export const MODULES: Record<ModuleId, { label: string; component: ComponentType; showTabs: boolean }> = {
  home: { label: 'Home', component: HomeView, showTabs: false },
  browser: { label: 'Browser', component: BrowserView, showTabs: true },
  markets: { label: 'Markets', component: MarketsView, showTabs: false },
  trading: { label: 'Trading', component: TradingView, showTabs: false },
  research: { label: 'Research', component: ResearchView, showTabs: false },
  projects: { label: 'Projects', component: ProjectsView, showTabs: false },
  coding: { label: 'Coding', component: CodingView, showTabs: false },
  files: { label: 'Files', component: FilesView, showTabs: false },
  vault: { label: 'Vault', component: VaultView, showTabs: false },
  storage: { label: 'Storage', component: StorageView, showTabs: false },
  automations: { label: 'Automations', component: AutomationsView, showTabs: false },
  history: { label: 'History', component: HistoryView, showTabs: false },
  settings: { label: 'Settings', component: SettingsView, showTabs: false },
};
