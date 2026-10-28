import { useState } from 'react';
import {
  Activity, Archive, Braces, ChevronsLeft, ChevronsRight, CircleUser, Compass,
  FolderTree, Globe, KeyRound, LineChart, Microscope, PanelsTopLeft, Settings,
  Sparkles, Wand2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ModuleId } from '@/types';
import { useUIStore } from '@/stores/useUIStore';
import { useWorkspaceStore } from '@/stores/useWorkspaceStore';
import { cn } from '@/lib/cn';

interface Item {
  id: ModuleId;
  label: string;
  icon: LucideIcon;
}

const PRIMARY: Item[] = [
  { id: 'home', label: 'Home', icon: Compass },
  { id: 'browser', label: 'Browser', icon: Globe },
  { id: 'markets', label: 'Markets', icon: LineChart },
  { id: 'trading', label: 'Trading', icon: Activity },
  { id: 'research', label: 'Research', icon: Microscope },
  { id: 'projects', label: 'Projects', icon: PanelsTopLeft },
  { id: 'coding', label: 'Coding', icon: Braces },
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'vault', label: 'Vault', icon: KeyRound },
  { id: 'storage', label: 'Storage', icon: Archive },
  { id: 'automations', label: 'Automations', icon: Wand2 },
  { id: 'history', label: 'History', icon: Sparkles },
];

export function Sidebar() {
  const { module, setModule, sidebarCollapsed, toggleSidebar } = useUIStore();
  const { workspaces, activeId, setActive } = useWorkspaceStore();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0]!;

  return (
    <nav
      className={cn(
        'shrink-0 flex flex-col bg-graphite hairline-r transition-[width] duration-200 ease-swift',
        sidebarCollapsed ? 'w-[52px]' : 'w-[204px]',
      )}
    >
      {/* Workspace switcher doubles as the app's identity block */}
      <div className="relative p-2 pb-1">
        <button
          onClick={() => setSwitcherOpen((v) => !v)}
          aria-label="Cambiar workspace"
          aria-expanded={switcherOpen}
          className={cn(
            'w-full flex items-center gap-2.5 rounded h-9 px-2 no-drag',
            'hover:bg-white/[0.05] transition-colors',
            switcherOpen && 'bg-white/[0.06]',
          )}
        >
          <span
            className="h-4 w-4 rounded-[3px] shrink-0 border"
            style={{ background: `${active.accent}22`, borderColor: `${active.accent}66` }}
          />
          {!sidebarCollapsed && (
            <>
              <span className="text-sm truncate text-ink/90">{active.name}</span>
              <ChevronsRight className={cn('ml-auto h-3 w-3 text-faint transition-transform', switcherOpen && 'rotate-90')} />
            </>
          )}
        </button>

        {switcherOpen && (
          <div className="absolute left-2 right-2 top-[46px] z-40 raised-surface rounded-md p-1 shadow-2xl shadow-black/60">
            {workspaces.map((w) => (
              <button
                key={w.id}
                onClick={() => { setActive(w.id); setSwitcherOpen(false); }}
                className={cn(
                  'w-full flex items-center gap-2.5 h-8 px-2 rounded-xs text-left',
                  'hover:bg-white/[0.06] transition-colors',
                  w.id === activeId && 'bg-white/[0.05]',
                )}
              >
                <span className="h-3 w-3 rounded-[2px] shrink-0 border" style={{ background: `${w.accent}22`, borderColor: `${w.accent}66` }} />
                <span className="text-xs truncate">{w.name}</span>
              </button>
            ))}
            <div className="hairline-t mt-1 pt-1 px-2 pb-1">
              <p className="text-2xs text-faint leading-snug">{active.description}</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-2 py-1 space-y-0.5">
        {PRIMARY.map((item) => {
          const Icon = item.icon;
          const selected = module === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setModule(item.id)}
              title={sidebarCollapsed ? item.label : undefined}
              className={cn(
                'group relative w-full flex items-center gap-2.5 h-[30px] rounded-xs px-2 no-drag',
                'transition-colors duration-150',
                selected ? 'text-ink bg-white/[0.06]' : 'text-muted hover:text-ink hover:bg-white/[0.035]',
              )}
            >
              {selected && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-signal" />}
              <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.6} />
              {!sidebarCollapsed && <span className="text-sm truncate">{item.label}</span>}
            </button>
          );
        })}
      </div>

      <div className="px-2 py-2 hairline-t space-y-0.5">
        <button
          onClick={() => setModule('settings')}
          title={sidebarCollapsed ? 'Settings' : undefined}
          className={cn(
            'w-full flex items-center gap-2.5 h-[30px] rounded-xs px-2 transition-colors',
            module === 'settings' ? 'text-ink bg-white/[0.06]' : 'text-muted hover:text-ink hover:bg-white/[0.035]',
          )}
        >
          <Settings className="h-[15px] w-[15px] shrink-0" strokeWidth={1.6} />
          {!sidebarCollapsed && <span className="text-sm">Settings</span>}
        </button>

        <div className="flex items-center gap-2.5 h-[30px] px-2 text-muted">
          <CircleUser className="h-[15px] w-[15px] shrink-0" strokeWidth={1.6} />
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-xs truncate text-ink/80">Alejandro</div>
            </div>
          )}
        </div>

        <button
          onClick={toggleSidebar}
          className="w-full flex items-center gap-2.5 h-[30px] rounded-xs px-2 text-faint hover:text-ink hover:bg-white/[0.035] transition-colors"
        >
          {sidebarCollapsed ? <ChevronsRight className="h-[15px] w-[15px]" strokeWidth={1.6} /> : <ChevronsLeft className="h-[15px] w-[15px]" strokeWidth={1.6} />}
          {!sidebarCollapsed && <span className="text-xs">Contraer</span>}
        </button>
      </div>
    </nav>
  );
}
