import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModuleId } from '@/types';
import { MODULE_IDS } from '@/types';

interface UIState {
  module: ModuleId;
  sidebarCollapsed: boolean;
  jarvisOpen: boolean;
  jarvisWidth: number;
  jarvisMinimized: boolean;
  paletteOpen: boolean;
  searchOpen: boolean;
  shortcutsOpen: boolean;
  setModule: (m: ModuleId) => void;
  toggleSidebar: () => void;
  toggleJarvis: () => void;
  setJarvisOpen: (v: boolean) => void;
  setJarvisWidth: (w: number) => void;
  setJarvisMinimized: (v: boolean) => void;
  setPalette: (v: boolean) => void;
  setSearch: (v: boolean) => void;
  setShortcuts: (v: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      module: 'home',
      sidebarCollapsed: false,
      jarvisOpen: true,
      jarvisWidth: 400,
      jarvisMinimized: false,
      paletteOpen: false,
      searchOpen: false,
      shortcutsOpen: false,
      // Persisted or programmatic values are validated here so no consumer has
      // to defend against a module id that does not exist.
      setModule: (module) => set({ module: MODULE_IDS.includes(module) ? module : 'home' }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleJarvis: () => set((s) => ({ jarvisOpen: !s.jarvisOpen, jarvisMinimized: false })),
      setJarvisOpen: (jarvisOpen) => set({ jarvisOpen, jarvisMinimized: false }),
      setJarvisWidth: (w) => set({ jarvisWidth: Math.min(560, Math.max(340, w)) }),
      setJarvisMinimized: (jarvisMinimized) => set({ jarvisMinimized, jarvisOpen: !jarvisMinimized }),
      setPalette: (paletteOpen) => set({ paletteOpen }),
      setSearch: (searchOpen) => set({ searchOpen }),
      setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
    }),
    {
      name: 'jarvis.ui',
      partialize: (s) => ({
        module: s.module,
        sidebarCollapsed: s.sidebarCollapsed,
        jarvisOpen: s.jarvisOpen,
        jarvisWidth: s.jarvisWidth,
      }),
    },
  ),
);
