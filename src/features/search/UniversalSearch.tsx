import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AppWindow, Bookmark, FileText, FolderTree, GitBranch, Globe, MessageSquare, Terminal } from 'lucide-react';
import { useUIStore } from '@/stores/useUIStore';
import { useWorkspaceStore } from '@/stores/useWorkspaceStore';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { localSearch } from '@/services/agent/localSearch';
import type { SearchHit } from '@/services/agent/localSearch';
import { mockBookmarks, mockHistory } from '@/mocks/browser';
import { ago } from '@/lib/format';
import { cn } from '@/lib/cn';

const CATEGORIES = ['Todo', 'Archivos', 'Carpetas', 'Aplicaciones', 'Proyectos', 'Conversaciones', 'Historial', 'Marcadores', 'Repositorios'] as const;
type Category = (typeof CATEGORIES)[number];

interface Row {
  id: string;
  category: Exclude<Category, 'Todo'>;
  title: string;
  detail: string;
  meta?: string;
  icon: typeof FileText;
  /** True when the row came from this machine rather than from mock data. */
  live: boolean;
}

const MOCK_CONVERSATIONS = [
  { id: 'c1', title: 'Arquitectura del agent core', detail: 'Vigilia · 42 mensajes', meta: 'hace 2 h' },
  { id: 'c2', title: 'Comparativa NVDA vs AMD', detail: 'Trading · 18 mensajes', meta: 'hace 1 d' },
  { id: 'c3', title: 'Configuración del servidor Reforger', detail: 'Arma Reforger · 27 mensajes', meta: 'hace 3 d' },
];

const MOCK_REPOS = [
  { id: 'r1', title: 'jarvis-desktop', detail: 'D:\\Projects\\jarvis-desktop · main', meta: '12 cambios' },
  { id: 'r2', title: 'vigilia-core', detail: 'D:\\Projects\\Vigilia · feat/agent-core', meta: '7 cambios' },
  { id: 'r3', title: 'quant-notebooks', detail: 'D:\\Projects\\Quant · research', meta: 'limpio' },
];

export function UniversalSearch() {
  const { searchOpen, setSearch, setModule } = useUIStore();
  const projects = useWorkspaceStore((s) => s.projects);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('Todo');
  const inputRef = useRef<HTMLInputElement>(null);
  const permission = useJarvisStore((s) => s.permission);
  const [live, setLive] = useState<SearchHit[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (searchOpen) {
      setQuery('');
      setCategory('Todo');
      setLive([]);
      setNotice(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      localSearch.cancel();
    }
  }, [searchOpen]);

  // Real results come from the broker, debounced so a fast typist does not
  // launch a disk walk per keystroke.
  useEffect(() => {
    if (!searchOpen) return;
    const text = query.trim();
    if (text.length < 2) {
      setLive([]);
      setNotice(null);
      localSearch.cancel();
      return;
    }
    let active = true;
    setSearching(true);
    const handle = window.setTimeout(() => {
      void localSearch.query(text, permission)
        .then(async (hits) => {
          if (!active) return;
          setLive(hits);
          setNotice(hits.length ? null : await localSearch.explain(permission));
        })
        .catch(() => { if (active) setLive([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [query, searchOpen, permission]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const fromDisk: Row[] = live.map((hit) => ({
      id: hit.id,
      category: hit.source === 'apps' ? ('Aplicaciones' as const)
        : hit.source === 'folders' ? ('Carpetas' as const) : ('Archivos' as const),
      title: hit.title,
      detail: hit.subtitle,
      icon: hit.source === 'apps' ? AppWindow : hit.source === 'folders' ? FolderTree : FileText,
      live: true,
    }));

    const fromMocks: Row[] = [
      ...projects.map((p) => ({
        id: p.id, category: 'Proyectos' as const, title: p.name, detail: p.path,
        meta: ago(p.lastOpened), icon: Terminal, live: false,
      })),
      ...MOCK_CONVERSATIONS.map((c) => ({ ...c, category: 'Conversaciones' as const, icon: MessageSquare, live: false })),
      ...mockHistory.map((h) => ({
        id: h.id, category: 'Historial' as const, title: h.title, detail: h.url,
        meta: ago(h.visitedAt), icon: Globe, live: false,
      })),
      ...mockBookmarks.map((b) => ({
        id: b.id, category: 'Marcadores' as const, title: b.title, detail: b.url,
        meta: b.folder, icon: Bookmark, live: false,
      })),
      ...MOCK_REPOS.map((r) => ({ ...r, category: 'Repositorios' as const, icon: GitBranch, live: false })),
    ];

    return [...fromDisk, ...fromMocks]
      .filter((r) => (category === 'Todo' ? true : r.category === category))
      .filter((r) => r.live || !q || r.title.toLowerCase().includes(q) || r.detail.toLowerCase().includes(q))
      .slice(0, 80);
  }, [query, category, projects, live]);

  return (
    <AnimatePresence>
      {searchOpen && (
        <motion.div
          className="fixed inset-0 z-[75] flex items-start justify-center pt-[9vh] bg-black/55 glass px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSearch(false); }}
        >
          <motion.div
            initial={{ y: -8 }}
            animate={{ y: 0 }}
            className="w-full max-w-[760px] rounded-xl bg-panel border border-hairline shadow-2xl shadow-black/70 overflow-hidden flex flex-col max-h-[72vh]"
          >
            <div className="px-4 pt-3.5 pb-2 hairline-b">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Busca en todo el equipo"
                spellCheck={false}
                className="w-full bg-transparent text-lg outline-none placeholder:text-faint"
              />
              <div className="flex items-center gap-1 mt-2.5 overflow-x-auto scroll-thin">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={cn(
                      'h-6 px-2 rounded-xs text-2xs whitespace-nowrap transition-colors',
                      c === category ? 'bg-signal/12 text-signal border border-signal/25' : 'text-muted hover:text-ink hover:bg-white/[0.04] border border-transparent',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto scroll-thin py-1">
              {rows.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-faint">
                    {searching ? 'Buscando en el equipo…' : 'Nada coincide todavía. Prueba con otro término o cambia de categoría.'}
                  </p>
                  {notice && <p className="text-2xs text-amber mt-2">{notice}</p>}
                </div>
              ) : (
                rows.map((r) => {
                  const Icon = r.icon;
                  return (
                    <button
                      key={`${r.category}-${r.id}`}
                      onClick={() => {
                        setSearch(false);
                        if (r.category === 'Archivos' || r.category === 'Carpetas') setModule('files');
                        else if (r.category === 'Historial' || r.category === 'Marcadores') setModule('browser');
                        else if (r.category === 'Proyectos' || r.category === 'Repositorios') setModule('coding');
                      }}
                      className="w-full flex items-center gap-3 px-4 h-9 text-left hover:bg-white/[0.04] transition-colors"
                    >
                      <Icon className="h-3.5 w-3.5 text-faint shrink-0" strokeWidth={1.7} />
                      <span className="text-sm text-ink/90 truncate shrink-0 max-w-[30%]">{r.title}</span>
                      <span className="text-xs text-faint truncate flex-1">{r.detail}</span>
                      <span
                        className={cn(
                          'text-2xs px-1.5 h-[16px] leading-[14px] rounded-xs border shrink-0',
                          r.live ? 'border-moss/30 text-moss/90' : 'border-hairline text-faint',
                        )}
                        title={r.live ? 'Leído de este equipo' : 'Datos simulados'}
                      >
                        {r.live ? 'equipo' : 'mock'}
                      </span>
                      {r.meta && <span className="text-2xs text-faint tnum shrink-0">{r.meta}</span>}
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex items-center px-4 h-8 hairline-t text-2xs text-faint">
              <span className="tnum">{rows.length} resultados</span>
              <span className="ml-3 text-faint/80">{live.length} del equipo</span>
              <span className="ml-auto">Ctrl + Shift + F</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
