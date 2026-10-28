import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight, File, Folder, Lock, Search } from 'lucide-react';
import type { IndexedFile } from '@/types';
import { cn } from '@/lib/cn';

const PER_DIR = 300;
const SEARCH_LIMIT = 200;

interface DirNode { dirs: string[]; files: IndexedFile[] }

/**
 * Lazy tree: the folder map is built once, but only expanded folders render,
 * each capped; search renders a flat, capped list. A 100k-file project never
 * puts 100k nodes in the DOM.
 */
export function ProjectExplorer({ files, activeRel, onOpen }: { files: IndexedFile[]; activeRel: string | null; onOpen: (rel: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(['']));
  const [query, setQuery] = useState('');

  const tree = useMemo(() => {
    const map = new Map<string, DirNode>();
    const node = (d: string) => { let n = map.get(d); if (!n) { n = { dirs: [], files: [] }; map.set(d, n); } return n; };
    node('');
    for (const f of files) {
      const parts = f.relativePath.split('/');
      let dir = '';
      for (let i = 0; i < parts.length - 1; i++) {
        const child = dir ? `${dir}/${parts[i]}` : parts[i]!;
        if (!map.has(child)) node(dir).dirs.push(child);
        node(child);
        dir = child;
      }
      node(dir).files.push(f);
    }
    for (const n of map.values()) { n.dirs.sort(); n.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)); }
    return map;
  }, [files]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return files.filter((f) => f.relativePath.toLowerCase().includes(q)).slice(0, SEARCH_LIMIT);
  }, [files, query]);

  const toggle = (d: string) => setOpen((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; });

  const fileRow = (f: IndexedFile, depth: number, label?: string) => (
    <button
      key={f.relativePath}
      type="button"
      data-testid="explorer-file"
      data-path={f.relativePath}
      onClick={() => onOpen(f.relativePath)}
      className={cn('w-full flex items-center gap-1.5 h-6 pr-2 text-left text-xs truncate hover:bg-white/[0.04]', activeRel === f.relativePath ? 'bg-white/[0.06] text-ink' : 'text-ink/75')}
      style={{ paddingLeft: 8 + depth * 12 }}
      title={f.relativePath}
    >
      {f.secret ? <Lock className="h-3 w-3 shrink-0 text-amber" /> : <File className="h-3 w-3 shrink-0 text-faint" />}
      <span className="truncate">{label ?? f.relativePath.split('/').pop()}</span>
    </button>
  );

  const renderDir = (dir: string, depth: number): ReactNode => {
    const n = tree.get(dir);
    if (!n) return null;
    const items = [...n.dirs.map((d) => ({ d })), ...n.files.map((f) => ({ f }))];
    const shown = items.slice(0, PER_DIR);
    return (
      <>
        {shown.map((it) => ('d' in it ? (
          <div key={it.d}>
            <button type="button" data-testid="explorer-folder" data-path={it.d} onClick={() => toggle(it.d)}
              className="w-full flex items-center gap-1 h-6 pr-2 text-left text-xs text-ink/75 hover:bg-white/[0.04]" style={{ paddingLeft: 4 + depth * 12 }}>
              <ChevronRight className={cn('h-3 w-3 shrink-0 text-faint transition-transform', open.has(it.d) && 'rotate-90')} />
              <Folder className="h-3 w-3 shrink-0 text-signal/70" />
              <span className="truncate">{it.d.split('/').pop()}</span>
            </button>
            {open.has(it.d) && renderDir(it.d, depth + 1)}
          </div>
        ) : fileRow(it.f, depth)))}
        {items.length > PER_DIR && <div className="text-2xs text-faint h-6 flex items-center" style={{ paddingLeft: 8 + depth * 12 }} data-testid="explorer-more">… {items.length - PER_DIR} más — usa la búsqueda</div>}
      </>
    );
  };

  return (
    <div className="h-full flex flex-col min-h-0" data-testid="project-explorer">
      <div className="h-8 shrink-0 flex items-center gap-1.5 px-2 border-b border-hairline">
        <Search className="h-3 w-3 text-faint shrink-0" />
        <input
          data-testid="explorer-search"
          className="flex-1 min-w-0 bg-transparent text-xs text-ink outline-none placeholder:text-faint"
          placeholder="Buscar archivo…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin py-1">
        {hits ? (
          hits.length ? hits.map((f) => fileRow(f, 0, f.relativePath)) : <div className="px-3 py-2 text-2xs text-muted" data-testid="explorer-no-results">Sin coincidencias.</div>
        ) : files.length ? renderDir('', 0) : <div className="px-3 py-2 text-2xs text-muted">Proyecto vacío.</div>}
        {hits && hits.length === SEARCH_LIMIT && <div className="px-3 py-1 text-2xs text-faint">Mostrando los primeros {SEARCH_LIMIT}.</div>}
      </div>
    </div>
  );
}
