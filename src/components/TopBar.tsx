import { forwardRef, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import {
  ArrowLeft, ArrowRight, Minus, MoreHorizontal, PanelRight, Plus, RotateCw, Square, X,
} from 'lucide-react';
import { useUIStore } from '@/stores/useUIStore';
import { useTabsStore } from '@/stores/useTabsStore';
import { useWorkspaceStore } from '@/stores/useWorkspaceStore';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { normalizeInput } from '@/services/browser';
import { IconButton } from './ui/Button';
import { JarvisOrb } from './JarvisOrb';
import { StopAgentButton } from './StopAgentButton';
import { cn } from '@/lib/cn';

interface Props {
  omniboxRef: RefObject<HTMLInputElement>;
}

export const TopBar = forwardRef<HTMLDivElement, Props>(function TopBar({ omniboxRef }, ref) {
  const { module, setModule, jarvisOpen, toggleJarvis, setPalette } = useUIStore();
  const { tabs, open, navigate, reload, stop, back, forward, active } = useTabsStore();
  // The non-null assertion that used to live here was a lie: a stale or corrupt
  // activeId made this undefined and took the whole window down with it.
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.activeId) ?? s.workspaces[0]!);
  const { submit, state } = useJarvisStore();
  const searchEngine = useSettingsStore((s) => s.searchEngine);

  const tab = active();
  const [value, setValue] = useState(tab?.url ?? '');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setValue(module === 'browser' ? tab?.url ?? '' : '');
  }, [tab?.url, module, focused]);

  function commit() {
    const raw = value.trim();
    if (!raw) return;
    const parsed = normalizeInput(raw, searchEngine);

    if (parsed.kind === 'command') {
      useUIStore.getState().setJarvisOpen(true);
      submit(raw);
      setValue('');
    } else {
      // Both urls and searches resolve to a real address before they travel.
      setModule('browser');
      if (tab) navigate(tab.id, parsed.url);
      else open(parsed.url, workspace.id);
    }
    omniboxRef.current?.blur();
  }

  const hint = focused ? 'Escribe una URL, una búsqueda o una orden' : null;

  return (
    <div ref={ref} className="h-11 shrink-0 flex items-center gap-1.5 px-2 bg-graphite hairline-b drag-region">
      <div className="flex items-center gap-0.5 no-drag">
        <IconButton onClick={() => tab && back(tab.id)} disabled={!tab?.canGoBack} aria-label="Atrás">
          <ArrowLeft className="h-[15px] w-[15px]" strokeWidth={1.7} />
        </IconButton>
        <IconButton onClick={() => tab && forward(tab.id)} disabled={!tab?.canGoForward} aria-label="Adelante">
          <ArrowRight className="h-[15px] w-[15px]" strokeWidth={1.7} />
        </IconButton>
        <IconButton
          onClick={() => { if (!tab) return; if (tab.loading) stop(tab.id); else reload(tab.id); }}
          disabled={!tab}
          aria-label={tab?.loading ? 'Detener carga' : 'Recargar'}
        >
          {tab?.loading
            ? <X className="h-[14px] w-[14px]" strokeWidth={1.8} />
            : <RotateCw className="h-[14px] w-[14px]" strokeWidth={1.7} />}
        </IconButton>
      </div>

      {/* One field for addresses, searches and orders. */}
      <div className="flex-1 min-w-0 max-w-[880px] mx-auto no-drag relative">
        <div
          className={cn(
            'h-7 flex items-center gap-2 rounded-md px-2.5 border transition-colors duration-150',
            focused ? 'bg-raised border-signal/45' : 'bg-white/[0.035] border-hairline hover:border-hairline/70',
          )}
        >
          <JarvisOrb state={focused ? 'listening' : state} size={13} />
          <input
            ref={omniboxRef}
            data-authority-omnibox="true"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') omniboxRef.current?.blur();
            }}
            placeholder={module === 'browser' ? 'Dirección, búsqueda u orden para JARVIS' : 'Pide algo a JARVIS o escribe una dirección'}
            spellCheck={false}
            className="flex-1 bg-transparent text-xs outline-none min-w-0 placeholder:text-faint"
          />
          {!focused && (
            <kbd className="text-2xs text-faint border border-hairline rounded-xs px-1 h-[15px] leading-[13px] shrink-0">
              Ctrl L
            </kbd>
          )}
        </div>
        {hint && (
          <p className="absolute left-2.5 top-8 text-2xs text-faint pointer-events-none">{hint}</p>
        )}
      </div>

      <div className="flex items-center gap-1 no-drag">
        <StopAgentButton />

        <IconButton onClick={() => { setModule('browser'); open('about:blank', workspace.id); }} aria-label="Nueva pestaña">
          <Plus className="h-[15px] w-[15px]" strokeWidth={1.7} />
        </IconButton>

        <div className="hidden lg:flex items-center gap-1.5 px-2 h-6 rounded-xs border border-hairline">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: `${workspace.accent}aa` }} />
          <span className="text-2xs text-muted">{workspace.name}</span>
          <span className="text-2xs text-faint tnum">{tabs.length}</span>
        </div>

        <IconButton onClick={toggleJarvis} aria-label="Panel de JARVIS" className={cn(jarvisOpen && 'text-signal')}>
          <PanelRight className="h-[15px] w-[15px]" strokeWidth={1.7} />
        </IconButton>

        <IconButton onClick={() => setPalette(true)} aria-label="Menú">
          <MoreHorizontal className="h-[15px] w-[15px]" strokeWidth={1.7} />
        </IconButton>

        <WindowControls />
      </div>
    </div>
  );
});

function WindowControls() {
  const bridge = window.jarvis;
  if (!bridge) return null;

  return (
    <div className="flex items-center ml-1 no-drag">
      <button onClick={() => bridge.window.minimize()} className="h-7 w-8 grid place-items-center text-muted hover:text-ink hover:bg-white/[0.06]" aria-label="Minimizar">
        <Minus className="h-3.5 w-3.5" strokeWidth={1.7} />
      </button>
      <button onClick={() => bridge.window.toggleMaximize()} className="h-7 w-8 grid place-items-center text-muted hover:text-ink hover:bg-white/[0.06]" aria-label="Maximizar">
        <Square className="h-3 w-3" strokeWidth={1.7} />
      </button>
      <button onClick={() => bridge.window.close()} className="h-7 w-8 grid place-items-center text-muted hover:text-white hover:bg-halt/80" aria-label="Cerrar">
        <X className="h-3.5 w-3.5" strokeWidth={1.7} />
      </button>
    </div>
  );
}
