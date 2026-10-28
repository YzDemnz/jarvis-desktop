import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle, Bookmark, Clock, Download, Globe, PanelRightClose, Search, ShieldCheck,
} from 'lucide-react';
import { useTabsStore } from '@/stores/useTabsStore';
import { useWorkspaceStore } from '@/stores/useWorkspaceStore';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useUIStore } from '@/stores/useUIStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { browserService, hasRealBrowser } from '@/services/browser';
import type { Bookmark as BookmarkType, DownloadItem, HistoryEntry } from '@/types';
import { Button } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { ago, bytes } from '@/lib/format';
import { cn } from '@/lib/cn';

type SidePanel = 'none' | 'history' | 'bookmarks' | 'downloads';

/**
 * The page itself is painted by a WebContentsView owned by the main process.
 * React's job here is inverted: it measures the hole the page should fill and
 * reports it. That keeps the native surface glued to the layout through every
 * resize, panel toggle and sidebar collapse, without the UI ever touching the
 * engine.
 */
export function BrowserView() {
  const { tabs, active, open, bind, setBounds, setVisible } = useTabsStore();
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const submit = useJarvisStore((s) => s.submit);
  const setJarvisOpen = useUIStore((s) => s.setJarvisOpen);
  const paletteOpen = useUIStore((s) => s.paletteOpen);
  const searchOpen = useUIStore((s) => s.searchOpen);
  const shortcutsOpen = useUIStore((s) => s.shortcutsOpen);
  const approval = useJarvisStore((s) => s.approval);

  const [panel, setPanel] = useState<SidePanel>('none');
  const viewport = useRef<HTMLDivElement>(null);
  const tab = active();

  useEffect(() => { bind(); }, [bind]);

  // A chromeless surface means: a real page, and nothing floating over it.
  const overlayOpen = paletteOpen || searchOpen || shortcutsOpen || Boolean(approval);
  const showsPage = Boolean(tab) && tab?.url !== 'about:blank' && !tab?.error && !overlayOpen;

  // Keep main's bounds in sync with the measured hole.
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;

    const report = () => {
      const rect = node.getBoundingClientRect();
      setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [setBounds, panel, tabs.length]);

  useEffect(() => {
    setVisible(showsPage);
    return () => setVisible(false);
  }, [showsPage, setVisible]);

  if (!tabs.length) {
    return (
      <Empty
        title="No hay ninguna pestaña abierta."
        action={<Button variant="solid" onClick={() => open('about:blank', workspaceId)}>Abrir una pestaña</Button>}
      />
    );
  }

  return (
    <div className="h-full flex min-h-0">
      <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-panel">
        {/* The hole. When a real page shows, this stays empty on purpose: the
            native view is composited exactly over these coordinates. */}
        <div ref={viewport} className="flex-1 min-h-0 relative">
          {!showsPage && (
            <div className="absolute inset-0 overflow-auto">
              {tab?.error ? <PageError tab={tab} /> : <StartPage />}
            </div>
          )}
        </div>

        <div className="h-8 shrink-0 hairline-t flex items-center gap-2 px-3 bg-void/60">
          <EngineBadge />
          <span className="text-2xs text-faint truncate flex-1 font-mono">{tab?.url ?? ''}</span>
          <Button variant="ghost" size="xs" data-authority-action onClick={() => { setJarvisOpen(true); submit('Analiza esta página'); }}>
            Analizar con JARVIS
          </Button>
          <PanelButton icon={<Clock className="h-3.5 w-3.5" />} label="Historial" on={panel === 'history'} onClick={() => setPanel(panel === 'history' ? 'none' : 'history')} />
          <PanelButton icon={<Bookmark className="h-3.5 w-3.5" />} label="Marcadores" on={panel === 'bookmarks'} onClick={() => setPanel(panel === 'bookmarks' ? 'none' : 'bookmarks')} />
          <PanelButton icon={<Download className="h-3.5 w-3.5" />} label="Descargas" on={panel === 'downloads'} onClick={() => setPanel(panel === 'downloads' ? 'none' : 'downloads')} />
        </div>
      </div>

      {panel !== 'none' && <SidePanelView panel={panel} onClose={() => setPanel('none')} />}
    </div>
  );
}

function EngineBadge() {
  return (
    <span
      className={cn(
        'text-2xs px-1.5 h-[17px] leading-[15px] rounded-xs border shrink-0',
        hasRealBrowser ? 'border-moss/35 text-moss' : 'border-hairline text-faint',
      )}
      title={hasRealBrowser ? 'Chromium alojado por el proceso principal' : 'Sin motor: la UI corre fuera de Electron'}
    >
      {hasRealBrowser ? 'Chromium' : 'Sin motor'}
    </span>
  );
}

function StartPage() {
  const { active, navigate, open } = useTabsStore();
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const searchEngine = useSettingsStore((s) => s.searchEngine);
  const [value, setValue] = useState('');
  const tab = active();

  function go() {
    const raw = value.trim();
    if (!raw) return;
    if (tab) navigate(tab.id, raw);
    else open(raw, workspaceId);
    setValue('');
  }

  return (
    <div className="h-full grid place-items-center px-8">
      <div className="w-full max-w-lg text-center">
        <Globe className="h-6 w-6 text-faint mx-auto mb-5" strokeWidth={1.3} />
        <div className="h-11 flex items-center gap-2.5 rounded-lg px-3.5 bg-raised border border-hairline focus-within:border-signal/45 transition-colors">
          <Search className="h-4 w-4 text-faint shrink-0" strokeWidth={1.6} />
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
            placeholder="Escribe una dirección o busca"
            spellCheck={false}
            className="flex-1 bg-transparent text-sm outline-none min-w-0 placeholder:text-faint"
          />
        </div>
        <p className="text-2xs text-faint mt-3">
          Búsquedas con {searchEngine}. Las direcciones se abren directamente.
        </p>
      </div>
    </div>
  );
}

function PageError({ tab }: { tab: { url: string; error?: { code: number; description: string } | null } }) {
  const { active, reload } = useTabsStore();
  const current = active();
  return (
    <div className="h-full grid place-items-center px-8">
      <div className="max-w-sm text-center">
        <AlertTriangle className="h-6 w-6 text-clay/80 mx-auto mb-4" strokeWidth={1.4} />
        <p className="text-sm text-ink">No se pudo cargar la página.</p>
        <p className="text-xs text-muted mt-2 font-mono break-all">{tab.url}</p>
        <p className="text-2xs text-faint mt-3">
          {tab.error?.description} ({tab.error?.code})
        </p>
        <Button variant="quiet" className="mt-5" onClick={() => current && reload(current.id)}>Reintentar</Button>
      </div>
    </div>
  );
}

function PanelButton({ icon, label, on, onClick }: { icon: ReactNode; label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        'h-[22px] px-1.5 rounded-xs grid place-items-center transition-colors',
        on ? 'text-ink bg-white/[0.07]' : 'text-faint hover:text-muted',
      )}
    >
      {icon}
    </button>
  );
}

function SidePanelView({ panel, onClose }: { panel: SidePanel; onClose: () => void }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([]);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);

  useEffect(() => {
    if (panel === 'history') void browserService.history().then(setHistory);
    if (panel === 'bookmarks') void browserService.bookmarks().then(setBookmarks);
    if (panel === 'downloads') void browserService.downloads().then(setDownloads);
  }, [panel]);

  useEffect(() => browserService.onDownloads(setDownloads), []);

  const { active, navigate, open } = useTabsStore();
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  function visit(url: string) {
    const tab = active();
    if (tab) navigate(tab.id, url);
    else open(url, workspaceId);
  }

  const title = panel === 'history' ? 'Historial' : panel === 'bookmarks' ? 'Marcadores' : 'Descargas';

  return (
    <aside className="w-[280px] shrink-0 hairline-l bg-void flex flex-col min-h-0">
      <div className="h-9 shrink-0 flex items-center justify-between px-3 hairline-b">
        <span className="text-2xs uppercase tracking-[0.09em] text-faint">{title}</span>
        <button onClick={onClose} className="text-faint hover:text-ink" aria-label="Cerrar panel">
          <PanelRightClose className="h-3.5 w-3.5" strokeWidth={1.6} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin p-2 space-y-0.5">
        {panel === 'history' && (history.length ? history.map((h) => (
          <button key={h.id} onClick={() => visit(h.url)} className="w-full text-left px-2 py-1.5 rounded-xs hover:bg-white/[0.04] group">
            <span className="block text-xs text-ink/85 truncate group-hover:text-ink">{h.title}</span>
            <span className="block text-2xs text-faint truncate">{ago(h.visitedAt)} · {h.url}</span>
          </button>
        )) : <EmptyLine text="Sin historial todavía." />)}

        {panel === 'bookmarks' && (bookmarks.length ? bookmarks.map((b) => (
          <button key={b.id} onClick={() => visit(b.url)} className="w-full text-left px-2 py-1.5 rounded-xs hover:bg-white/[0.04] group">
            <span className="block text-xs text-ink/85 truncate group-hover:text-ink">{b.title}</span>
            <span className="block text-2xs text-faint truncate">{b.folder} · {b.url}</span>
          </button>
        )) : <EmptyLine text="Sin marcadores." />)}

        {panel === 'downloads' && (downloads.length ? downloads.map((d) => (
          <div key={d.id} className="px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-xs text-ink/85 truncate">{d.filename}</span>
              <span className="text-2xs text-faint tnum shrink-0">{bytes(d.received)}</span>
            </div>
            <div className="h-[2px] mt-1.5 rounded-full bg-raised overflow-hidden">
              <span
                className={cn('block h-full rounded-full', d.state === 'completed' ? 'bg-moss' : d.state === 'in_progress' ? 'bg-signal' : 'bg-clay')}
                style={{ width: `${d.bytes ? Math.min(100, (d.received / d.bytes) * 100) : 0}%` }}
              />
            </div>
          </div>
        )) : <EmptyLine text="Sin descargas." />)}
      </div>

      <div className="h-8 shrink-0 hairline-t flex items-center gap-1.5 px-3">
        <ShieldCheck className="h-3 w-3 text-faint" strokeWidth={1.6} />
        <span className="text-2xs text-faint">Aislado por perfil</span>
      </div>
    </aside>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-2xs text-faint px-2 py-6 text-center">{text}</p>;
}
