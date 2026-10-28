import { Globe, Loader2, Pin, Plus, X } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useTabsStore } from '@/stores/useTabsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useWorkspaceStore } from '@/stores/useWorkspaceStore';
import { cn } from '@/lib/cn';

export function TabStrip() {
  const { tabs, activeId, activate, close, togglePin, open } = useTabsStore();
  const setModule = useUIStore((s) => s.setModule);
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  if (!tabs.length) {
    return (
      <div className="h-8 shrink-0 flex items-center px-3 bg-graphite hairline-b">
        <button
          onClick={() => open('about:blank', workspaceId)}
          className="text-xs text-faint hover:text-ink transition-colors"
        >
          Abrir una pestaña
        </button>
      </div>
    );
  }

  return (
    <div className="h-8 shrink-0 flex items-stretch bg-graphite hairline-b overflow-x-auto scroll-thin">
      {tabs.map((t) => {
        const selected = t.id === activeId;
        return (
          <div
            key={t.id}
            onClick={() => { activate(t.id); setModule('browser'); }}
            onAuxClick={(e) => { if (e.button === 1) close(t.id); }}
            className={cn(
              'group relative flex items-center gap-2 pl-3 pr-2 min-w-0 cursor-default select-none',
              'border-r border-hairline transition-colors duration-150',
              t.pinned ? 'w-auto max-w-[130px]' : 'w-[190px]',
              selected ? 'bg-panel text-ink' : 'text-muted hover:bg-white/[0.03] hover:text-ink/90',
            )}
          >
            {selected && <span className="absolute inset-x-0 top-0 h-[1.5px] bg-signal" />}

            <TabIcon loading={t.loading} favicon={t.favicon} />
            <span className="text-xs truncate flex-1 min-w-0">{t.title}</span>

            {t.pinned && <Pin className="h-3 w-3 shrink-0 text-faint" strokeWidth={1.7} />}

            <button
              onClick={(e) => { e.stopPropagation(); close(t.id); }}
              onDoubleClick={(e) => { e.stopPropagation(); togglePin(t.id); }}
              className="opacity-0 group-hover:opacity-100 h-4 w-4 grid place-items-center rounded-xs hover:bg-white/10 shrink-0"
              aria-label={`Cerrar ${t.title}`}
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>
        );
      })}

      <button
        onClick={() => open('about:blank', workspaceId)}
        className="w-8 shrink-0 grid place-items-center text-faint hover:text-ink hover:bg-white/[0.04] transition-colors"
        aria-label="Nueva pestaña"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.7} />
      </button>
    </div>
  );
}

/** Favicon when the page has one, spinner while it loads, dot as the fallback. */
function TabIcon({ loading, favicon }: { loading: boolean; favicon?: string }) {
  if (loading) return <Loader2 className="h-3 w-3 shrink-0 text-signal animate-spin" strokeWidth={2} />;
  if (favicon) {
    return (
      <img
        src={favicon}
        alt=""
        className="h-3.5 w-3.5 shrink-0 rounded-[2px] object-contain"
        onError={(e: SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }
  return <Globe className="h-3 w-3 shrink-0 text-faint" strokeWidth={1.6} />;
}
