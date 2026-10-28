import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive, ChevronRight, File, FileCode, FileText, Folder, FolderOpen, Image as ImageIcon, Search,
} from 'lucide-react';
import type { FileKind, FileNode } from '@/types';
import { mockTree } from '@/mocks/files';
import { allNodes, childrenOf } from '@/services/filesystem/MockFilesystemService';
import { localFilesystem } from '@/services/filesystem/LocalFilesystem';
import { hasRealAgent } from '@/services/agent/runtime';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useUIStore } from '@/stores/useUIStore';
import { Button } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { ago, bytes } from '@/lib/format';
import { cn } from '@/lib/cn';

const ICONS: Record<FileKind, typeof File> = {
  folder: Folder, code: FileCode, document: FileText, image: ImageIcon, archive: Archive, data: FileCode, binary: File,
};

const MOCK_ROOT = 'D:\\Projects';

function splitPath(value: string): string[] {
  return value.split(/[\\/]+/).filter(Boolean);
}

export function FilesView() {
  const [path, setPath] = useState(MOCK_ROOT);
  const [selected, setSelected] = useState<FileNode | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set([MOCK_ROOT]));
  const [roots, setRoots] = useState<FileNode[]>(mockTree);
  const [rows, setRows] = useState<FileNode[]>(() => childrenOf(MOCK_ROOT));
  const [childCache, setChildCache] = useState<Record<string, FileNode[]>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const submit = useJarvisStore((s) => s.submit);
  const setJarvisOpen = useUIStore((s) => s.setJarvisOpen);
  const permission = useJarvisStore((s) => s.permission);
  const [preview,setPreview]=useState<import('../../../electron/agent/FileSystemService').TextRead|null>(null);
  const [reading,setReading]=useState(false);const previewEpoch=useRef(0);
  useEffect(()=>{previewEpoch.current++;setPreview(null);setReading(false);},[selected?.path,permission]);

  // Real drives when the main process is there; the mock tree otherwise. Both
  // paths go through the broker, so the permission level applies either way.
  useEffect(() => {
    if (!hasRealAgent) return;
    setChildCache({});
    let active = true;
    void localFilesystem.drives(permission).then((drives) => {
      if (!active || !drives.length) return;
      setRoots(drives);
      const first = drives[0];
      if (first) {
        setPath(first.path);
        setExpanded(new Set([first.path]));
      }
    });
    return () => { active = false; };
  }, [permission]);

  const loadChildren = useCallback(async (target: string): Promise<FileNode[]> => {
    if (!hasRealAgent) return childrenOf(target);
    const cached = childCache[target];
    if (cached) return cached;
    const entries = await localFilesystem.list(target, permission);
    setChildCache((prev) => ({ ...prev, [target]: entries }));
    return entries;
  }, [childCache, permission]);

  // Listing and searching are async against the disk, so the table is state.
  useEffect(() => {
    let active = true;
    const text = query.trim();

    if (!hasRealAgent) {
      setRows(text ? allNodes.filter((n) => n.name.toLowerCase().includes(text.toLowerCase())) : childrenOf(path));
      setNotice(null);
      return;
    }

    setLoading(true);
    setNotice(null);
    const handle = window.setTimeout(() => {
      const work = text.length >= 2
        ? localFilesystem.search(text, permission)
        : localFilesystem.list(path, permission);
      void work
        .then(async (entries) => {
          if (!active) return;
          setRows(entries);
          if(text.length>=2){
            const report=await window.jarvis?.agent.fsSearchStatus?.();
            if(active&&report?.truncated)setNotice('Búsqueda parcial: '+report.directories+' carpetas revisadas. Elige una carpeta o una consulta más específica para continuar.');
          }
          if (!entries.length) {
            setNotice(text.length >= 2
              ? 'Sin coincidencias en la parte revisada. Prueba una carpeta o consulta más específica.'
              : 'Carpeta vacía o sin permiso de lectura.');
          }
        })
        .catch(() => { if (active) { setRows([]); setNotice('No se pudo leer esta ruta.'); } })
        .finally(() => { if (active) setLoading(false); });
    }, text ? 220 : 0);

    return () => { active = false; window.clearTimeout(handle); };
  }, [path, query, permission]);

  const crumbs = splitPath(path);

  function toggle(p: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else { next.add(p); void loadChildren(p); }
      return next;
    });
  }

  return (
    <div className="h-full flex min-h-0">
      <aside className="w-[220px] shrink-0 hairline-r bg-graphite/60 overflow-y-auto scroll-thin py-2">
        <Tree nodes={hasRealAgent ? roots.map((r) => ({ ...r, children: childCache[r.path] ?? [] })) : mockTree} depth={0} expanded={expanded} onToggle={toggle} current={path} onOpen={(p) => { setPath(p); setQuery(''); }} childCache={childCache} />
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <header className="shrink-0 flex items-center gap-3 px-4 h-10 hairline-b">
          <nav className="flex items-center gap-1 min-w-0">
            {crumbs.map((c, i) => (
              <span key={c} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight className="h-3 w-3 text-faint shrink-0" strokeWidth={1.8} />}
                <button
                  onClick={() => { setPath(crumbs.slice(0, i + 1).join('\\')); setQuery(''); }}
                  className={cn('text-xs truncate transition-colors', i === crumbs.length - 1 ? 'text-ink' : 'text-faint hover:text-ink')}
                >
                  {c}
                </button>
              </span>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5 h-7 px-2 rounded bg-white/[0.035] border border-hairline focus-within:border-signal/45 transition-colors">
            <Search className="h-3.5 w-3.5 text-faint" strokeWidth={1.7} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar en el equipo"
              spellCheck={false}
              className="bg-transparent text-xs outline-none w-44"
            />
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
          {loading && rows.length === 0 ? (
            <Empty title="Leyendo el disco…" />
          ) : rows.length === 0 ? (
            <Empty
              title={notice ?? 'Esta carpeta está vacía.'}
              action={query ? <Button variant="quiet" onClick={() => setQuery('')}>Limpiar la búsqueda</Button> : undefined}
            />
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-graphite z-10">
                <tr className="text-2xs text-faint">
                  <th className="text-left font-normal px-4 py-2">Nombre</th>
                  <th className="text-right font-normal px-3 w-24">Tamaño</th>
                  <th className="text-right font-normal px-4 w-32">Modificado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => {
                  const Icon = ICONS[n.kind];
                  return (
                    <tr
                      key={n.id}
                      onClick={() => setSelected(n)}
                      onDoubleClick={() => { if (n.kind === 'folder') { setPath(n.path); setQuery(''); } }}
                      className={cn(
                        'cursor-default transition-colors hairline-b',
                        selected?.id === n.id ? 'bg-signal/[0.08]' : 'hover:bg-white/[0.03]',
                      )}
                    >
                      <td className="px-4 py-[7px]">
                        <span className="flex items-center gap-2.5">
                          <Icon className={cn('h-3.5 w-3.5 shrink-0', n.kind === 'folder' ? 'text-signal/70' : 'text-faint')} strokeWidth={1.7} />
                          <span className="text-ink/90 truncate">{n.name}</span>
                          {query && <span className="text-2xs text-faint truncate ml-2">{n.path}</span>}
                        </span>
                      </td>
                      <td className="text-right px-3 tnum text-faint">{n.kind === 'folder' ? '—' : bytes(n.bytes)}</td>
                      <td className="text-right px-4 text-faint">{ago(n.modified)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Preview */}
      <aside className="w-[260px] shrink-0 hairline-l bg-graphite/60 flex flex-col min-h-0">
        {selected ? (
          <>
            <div className="p-4 hairline-b">
              <div className="text-sm text-ink break-all leading-snug">{selected.name}</div>
              <div className="text-2xs text-faint mt-1 break-all font-mono">{selected.path}</div>
            </div>

            <dl className="p-4 space-y-2.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-faint">Tipo</dt>
                <dd className="text-ink/85">{selected.kind}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-faint">Tamaño</dt>
                <dd className="text-ink/85 tnum">{selected.kind === 'folder' ? '—' : bytes(selected.bytes)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-faint">Modificado</dt>
                <dd className="text-ink/85">{ago(selected.modified)}</dd>
              </div>
            </dl>

            <div className="p-3 mt-auto space-y-1.5 hairline-t">
              {hasRealAgent&&selected.kind!=='folder'&&<Button variant="quiet" disabled={reading} onClick={async()=>{
                const epoch=++previewEpoch.current;setReading(true);
                try {const result=await localFilesystem.readText(selected.path,permission);if(epoch===previewEpoch.current){setPreview(result);if(!result)setNotice('No se pudo leer este archivo como texto.');}}
                finally {if(epoch===previewEpoch.current)setReading(false);}
              }}>Leer texto local</Button>}
              {preview&&<pre data-testid="local-file-preview" className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{preview.text}{preview.truncated?'\n[Fragmento acotado]':''}</pre>}
              <Button
                variant="quiet"
                className="w-full justify-start"
                data-authority-action onClick={() => { setJarvisOpen(true); submit('Lee el archivo "'+selected.path+'"'); }}
              >
                Leer con JARVIS
              </Button>
              <Button
                variant="quiet"
                className="w-full justify-start"
                data-authority-action onClick={() => { setJarvisOpen(true); submit(`Busca archivos parecidos a ${selected.name}`); }}
              >
                Buscar parecidos
              </Button>
              <p className="text-2xs text-faint leading-snug pt-1">
                Mover, renombrar y eliminar llegan cuando el proceso principal exponga el sistema de archivos.
              </p>
            </div>
          </>
        ) : (
          <Empty title="Selecciona un archivo para ver sus detalles y las acciones que JARVIS puede ofrecerte." />
        )}
      </aside>
    </div>
  );
}

function Tree({ nodes, depth, expanded, onToggle, current, onOpen, childCache }: {
  nodes: FileNode[];
  depth: number;
  expanded: Set<string>;
  onToggle: (p: string) => void;
  current: string;
  onOpen: (p: string) => void;
  /** Children fetched lazily from disk, keyed by path. */
  childCache: Record<string, FileNode[]>;
}) {
  return (
    <>
      {nodes.filter((n) => n.kind === 'folder').map((n) => {
        const isOpen = expanded.has(n.path);
        return (
          <div key={n.id}>
            <button
              onClick={() => { onToggle(n.path); onOpen(n.path); }}
              style={{ paddingLeft: 8 + depth * 12 }}
              className={cn(
                'w-full flex items-center gap-1.5 h-7 pr-2 text-left transition-colors',
                current === n.path ? 'bg-white/[0.06] text-ink' : 'text-muted hover:text-ink hover:bg-white/[0.03]',
              )}
            >
              <ChevronRight className={cn('h-3 w-3 shrink-0 text-faint transition-transform', isOpen && 'rotate-90')} strokeWidth={1.8} />
              {isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-signal/70" strokeWidth={1.7} /> : <Folder className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={1.7} />}
              <span className="text-xs truncate">{n.name}</span>
            </button>
            {isOpen && (childCache[n.path]?.length || n.children?.length) ? (
              <Tree
                nodes={childCache[n.path] ?? n.children ?? []}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                current={current}
                onOpen={onOpen}
                childCache={childCache}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}
