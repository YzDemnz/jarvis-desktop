import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AppWindow, Braces, FileText, Globe, LineChart, PanelsTopLeft, Search, Sparkles, Terminal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ModuleId } from '@/types';
import { useUIStore } from '@/stores/useUIStore';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useTabsStore } from '@/stores/useTabsStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { searchUrl } from '@/services/browser';
import { localSearch } from '@/services/agent/localSearch';
import { useWorkspaceStore } from '@/stores/useWorkspaceStore';
import { useDevStore } from '@/stores/useDevStore';
import { allNodes } from '@/services/filesystem/MockFilesystemService';
import { mockQuotes } from '@/mocks/markets';
import { JarvisOrb } from '@/components/JarvisOrb';
import { cn } from '@/lib/cn';

type Group = 'Commands' | 'Apps' | 'Files' | 'Projects' | 'AI' | 'Browser' | 'Markets';

interface Result {
  id: string;
  group: Group;
  label: string;
  detail?: string;
  icon: LucideIcon;
  run: () => void;
}

const GROUP_ORDER: Group[] = ['AI', 'Commands', 'Markets', 'Projects', 'Files', 'Apps', 'Browser'];

const MOCK_APPS = [
  { name: 'Blender', path: 'C:\\Program Files\\Blender Foundation' },
  { name: 'Visual Studio Code', path: 'C:\\Users\\me\\AppData\\Local\\Programs' },
  { name: 'Arma Reforger', path: 'D:\\Steam\\steamapps\\common' },
  { name: 'Obsidian', path: 'C:\\Users\\me\\AppData\\Local\\Obsidian' },
  { name: 'PowerShell', path: 'C:\\Windows\\System32' },
];

const MODULE_COMMANDS: { id: ModuleId; label: string; icon: LucideIcon }[] = [
  { id: 'markets', label: 'Abrir Markets', icon: LineChart },
  { id: 'trading', label: 'Abrir Trading', icon: LineChart },
  { id: 'coding', label: 'Abrir Coding', icon: Braces },
  { id: 'files', label: 'Abrir Files', icon: FileText },
  { id: 'research', label: 'Abrir Research', icon: Sparkles },
  { id: 'browser', label: 'Abrir Browser', icon: Globe },
  { id: 'vault', label: 'Abrir Vault', icon: PanelsTopLeft },
  { id: 'storage', label: 'Abrir Storage', icon: PanelsTopLeft },
  { id: 'settings', label: 'Abrir Settings', icon: Terminal },
];

export function CommandPalette() {
  const { paletteOpen, setPalette, setModule } = useUIStore();
  const submit = useJarvisStore((s) => s.submit);
  const setJarvisOpen = useUIStore((s) => s.setJarvisOpen);
  const openTab = useTabsStore((s) => s.open);
  const searchEngine = useSettingsStore((s) => s.searchEngine);
  const permission = useJarvisStore((s) => s.permission);
  const { workspaces, setActive, projects } = useWorkspaceStore();
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  const dev = useDevStore();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [machine, setMachine] = useState<{ apps: { name: string; path: string }[]; files: { name: string; path: string }[] }>({ apps: [], files: [] });

  // Real apps and files, debounced. Falls back to the mock list when the
  // broker refuses or the machine has nothing to offer.
  useEffect(() => {
    const text = query.trim();
    if (!paletteOpen || text.length < 2) {
      setMachine({ apps: [], files: [] });
      return;
    }
    let active = true;
    const handle = window.setTimeout(() => {
      void localSearch.query(text, permission).then((hits) => {
        if (!active) return;
        setMachine({
          apps: hits.filter((h) => h.source === 'apps').slice(0, 5).map((h) => ({ name: h.title, path: h.subtitle })),
          files: hits.filter((h) => h.source !== 'apps').slice(0, 5).map((h) => ({ name: h.title, path: h.subtitle })),
        });
      }).catch(() => { if (active) setMachine({ apps: [], files: [] }); });
    }, 200);
    return () => { active = false; window.clearTimeout(handle); };
  }, [query, paletteOpen, permission]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery('');
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Result[] = [];

    if (q.length > 2) {
      out.push({
        id: 'ai-ask',
        group: 'AI',
        label: `Pedir a JARVIS: ${query.trim()}`,
        detail: 'El router local elige el modelo',
        icon: Sparkles,
        run: () => { setJarvisOpen(true); submit(query.trim()); },
      });
    }

    for (const c of MODULE_COMMANDS) {
      if (!q || c.label.toLowerCase().includes(q) || c.id.includes(q)) {
        out.push({ id: `cmd-${c.id}`, group: 'Commands', label: c.label, icon: c.icon, run: () => setModule(c.id) });
      }
    }

    // Developer commands. Anything with an effect goes to JARVIS, i.e. through
    // the broker with its permissions and approvals; navigation stays local.
    const ask = (prompt: string) => { setJarvisOpen(true); submit(prompt); };
    const active = dev.project?.name ?? '';
    const devCommands: { id: string; label: string; keys: string; run: () => void; detail?: string }[] = [
      { id: 'dev-workspace', label: 'Abrir Coding Workspace', keys: 'open coding workspace abrir', run: () => setModule('coding') },
      { id: 'dev-tests', label: active ? `Ejecutar pruebas de ${active}` : 'Ejecutar pruebas', keys: 'run tests ejecutar pruebas test', run: () => ask(active ? `Ejecuta las pruebas del proyecto ${active}` : 'Ejecuta las pruebas del proyecto') },
      { id: 'dev-git', label: 'git status', keys: 'git status estado', run: () => ask('git status') },
      { id: 'dev-changes', label: 'Mostrar cambios de JARVIS', keys: 'show changes mostrar cambios review', run: () => { setModule('coding'); dev.setBottom('changes'); } },
      { id: 'dev-undo', label: 'Deshacer cambios de JARVIS', keys: 'undo jarvis changes deshacer', detail: 'Pasa por aprobación', run: () => ask('Deshaz el último cambio de JARVIS') },
      { id: 'dev-terminal', label: 'Abrir terminal', keys: 'open terminal abrir terminal', run: () => { setModule('coding'); dev.setBottom('terminal'); } },
    ];
    for (const c of devCommands) {
      if (!q || c.keys.includes(q) || c.label.toLowerCase().includes(q)) out.push({ id: c.id, group: 'Commands', label: c.label, ...(c.detail ? { detail: c.detail } : {}), icon: Terminal, run: c.run });
    }
    const symbol = query.trim().match(/^(?:find symbol|buscar s[ií]mbolo)\s+([A-Za-z_$][\w$]*)$/i)?.[1];
    if (symbol) out.push({ id: 'dev-symbol', group: 'Commands', label: `Buscar símbolo ${symbol}`, icon: Braces, run: () => ask(`find symbol ${symbol}`) });
    const fileQ = query.trim().match(/^(?:find file|buscar archivo)\s+(.+)$/i)?.[1]?.toLowerCase();
    if (fileQ) {
      for (const f of dev.files.filter((x) => x.relativePath.toLowerCase().includes(fileQ)).slice(0, 8)) {
        out.push({ id: `dev-file-${f.relativePath}`, group: 'Files', label: f.relativePath.split('/').pop()!, detail: f.relativePath, icon: FileText, run: () => { setModule('coding'); void dev.openFile(f.relativePath); } });
      }
    }
    const projQ = query.trim().match(/^(?:open project|abrir proyecto)\s*(.*)$/i);
    for (const p of dev.projects) {
      const needle = (projQ ? projQ[1]! : query.trim()).toLowerCase();
      if ((projQ && (!needle || p.name.toLowerCase().includes(needle))) || (!projQ && q && p.name.toLowerCase().includes(q))) {
        out.push({ id: `dev-proj-${p.id}`, group: 'Projects', label: `Abrir proyecto ${p.name}`, detail: p.rootPath, icon: Braces, run: () => { void dev.openProject(p.id).then((ok) => { if (ok) setModule('coding'); }); } });
      }
    }

    for (const w of workspaces) {
      if (q && w.name.toLowerCase().includes(q)) {
        out.push({
          id: `ws-${w.id}`, group: 'Projects', label: `Cambiar a ${w.name}`, detail: w.description,
          icon: PanelsTopLeft, run: () => setActive(w.id),
        });
      }
    }

    for (const p of projects) {
      if (!q || p.name.toLowerCase().includes(q)) {
        out.push({
          id: `proj-${p.id}`, group: 'Projects', label: p.name, detail: p.path,
          icon: Braces, run: () => setModule('coding'),
        });
      }
    }

    if (q) {
      const files = machine.files.length
        ? machine.files
        : allNodes.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 5).map((n) => ({ name: n.name, path: n.path }));
      for (const f of files) {
        out.push({
          id: `file-${f.path}`, group: 'Files', label: f.name, detail: f.path,
          icon: FileText, run: () => setModule('files'),
        });
      }

      const apps = machine.apps.length
        ? machine.apps
        : MOCK_APPS.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 4);
      for (const a of apps) {
        out.push({
          id: `app-${a.path}`, group: 'Apps', label: `Abrir ${a.name}`, detail: a.path,
          icon: AppWindow, run: () => { setJarvisOpen(true); submit(`Abre ${a.name}`); },
        });
      }

      for (const s of mockQuotes.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 4)) {
        out.push({
          id: `sym-${s.symbol}`, group: 'Markets', label: s.symbol, detail: s.name,
          icon: LineChart, run: () => setModule('markets'),
        });
      }

      out.push({
        id: 'browse',
        group: 'Browser',
        label: `Buscar "${query.trim()}" en la web`,
        icon: Search,
        run: () => { setModule('browser'); openTab(searchUrl(query.trim(), searchEngine), workspaceId); },
      });
    }

    // An explicit developer command ("find file x", "find symbol y", …) is what
    // the user typed on purpose: its results go before "Pedir a JARVIS".
    const explicitDev = /^(find file|buscar archivo|find symbol|buscar s[ií]mbolo|open project|abrir proyecto|run tests|git status|show changes|undo jarvis|open terminal|open coding)/i.test(query.trim());
    const rank = (r: Result) => (explicitDev && r.id.startsWith('dev-') ? -1 : GROUP_ORDER.indexOf(r.group));
    return out.sort((a, b) => rank(a) - rank(b));
  }, [machine, query, workspaces, projects, workspaceId, setModule, setActive, submit, setJarvisOpen, openTab, dev]);

  useEffect(() => { setIndex(0); }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  function choose(r: Result | undefined) {
    if (!r) return;
    r.run();
    setPalette(false);
  }

  // Groups are drawn in the order their first result appears in `results`, so
  // the highlighted row is always the one Enter runs.
  const grouped = [...new Set(results.map((r) => r.group))].map((g) => ({ group: g, items: results.filter((r) => r.group === g) }));

  return (
    <AnimatePresence>
      {paletteOpen && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-start justify-center pt-[14vh] bg-black/50 glass px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setPalette(false); }}
        >
          <motion.div
            initial={{ y: -10, scale: 0.99 }}
            data-authority-palette
            animate={{ y: 0, scale: 1 }}
            exit={{ y: -6, scale: 0.995 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-[600px] rounded-xl bg-panel border border-hairline shadow-2xl shadow-black/70 overflow-hidden"
          >
            <div className="flex items-center gap-2.5 px-3.5 h-12 hairline-b">
              <JarvisOrb state={query.trim() ? 'listening' : 'idle'} size={16} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
                  if (e.key === 'Enter') { e.preventDefault(); choose(results[index]); }
                }}
                placeholder="Busca, ordena o pregunta"
                spellCheck={false}
                className="flex-1 bg-transparent text-base outline-none placeholder:text-faint"
              />
              <kbd className="text-2xs text-faint border border-hairline rounded-xs px-1.5 h-5 leading-[17px]">Esc</kbd>
            </div>

            <div ref={listRef} className="max-h-[360px] overflow-y-auto scroll-thin py-1.5">
              {grouped.length === 0 && (
                <p className="px-3.5 py-6 text-sm text-faint text-center">
                  Escribe para buscar módulos, archivos, proyectos o símbolos. Tres palabras o más van a JARVIS.
                </p>
              )}

              {grouped.map(({ group, items }) => (
                <div key={group} className="mb-1 last:mb-0">
                  <div className="px-3.5 py-1 text-2xs text-faint">{group}</div>
                  {items.map((r) => {
                    const i = results.indexOf(r);
                    const Icon = r.icon;
                    const selected = i === index;
                    return (
                      <button
                        key={r.id}
                        data-authority-action={r.id !== 'ai-ask' ? true : undefined}
                        data-authority-palette-ask={r.id === 'ai-ask' ? true : undefined}
                        data-selected={selected}
                        onMouseMove={() => setIndex(i)}
                        onClick={() => choose(r)}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-3.5 h-8 text-left transition-colors',
                          selected ? 'bg-signal/[0.10]' : 'hover:bg-white/[0.03]',
                        )}
                      >
                        {selected && <span className="absolute left-0 h-5 w-[2px] rounded-full bg-signal" />}
                        <Icon className={cn('h-3.5 w-3.5 shrink-0', selected ? 'text-signal' : 'text-faint')} strokeWidth={1.7} />
                        <span className={cn('text-sm truncate', selected ? 'text-ink' : 'text-ink/80')}>{r.label}</span>
                        {r.detail && <span className="text-2xs text-faint truncate ml-auto pl-3 max-w-[45%]">{r.detail}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 px-3.5 h-8 hairline-t text-2xs text-faint">
              <span>↑↓ navegar</span>
              <span>↵ ejecutar</span>
              <span className="ml-auto">Alt + Espacio</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
