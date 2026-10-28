import { useEffect, useState } from 'react';
import { FolderGit2, FolderPlus, Trash2 } from 'lucide-react';
import { useDevStore } from '@/stores/useDevStore';
import { useUIStore } from '@/stores/useUIStore';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ago } from '@/lib/format';

/** Projects discovered inside the Project Roots the user authorised — no mocks. */
const TECH_LABEL: Record<string, string> = {
  node: 'Node.js', typescript: 'TypeScript', javascript: 'JavaScript', react: 'React', vite: 'Vite', electron: 'Electron',
  nextjs: 'Next.js', python: 'Python', rust: 'Rust', go: 'Go', dotnet: '.NET', java: 'Java', cmake: 'CMake', cpp: 'C/C++', tailwind: 'Tailwind',
};

export function ProjectsView() {
  const { roots, projects, loading, error, mode, refresh, addRoot, removeRoot, openProject, attach } = useDevStore();
  const setModule = useUIStore((s) => s.setModule);
  const setJarvisOpen = useUIStore((s) => s.setJarvisOpen);
  const submit = useJarvisStore((s) => s.submit);
  const [newRoot, setNewRoot] = useState('');

  useEffect(() => attach(), [attach]);
  useEffect(() => { void refresh(); }, [refresh, mode]);

  return (
    <div className="h-full overflow-y-auto scroll-thin" data-testid="projects-view">
      <div className="max-w-[960px] mx-auto px-8 py-10">
        <h1 className="text-xl text-ink tracking-tight mb-1">Proyectos</h1>
        <p className="text-sm text-muted mb-6">Proyectos locales dentro de tus Project Roots. JARVIS no busca fuera de ellos.</p>

        {mode === 'unavailable' ? (
          <div className="text-sm text-muted" data-testid="projects-unavailable">El descubrimiento de proyectos trabaja sobre tus carpetas locales y necesita la aplicación de escritorio.</div>
        ) : (
          <>
            <div className="mb-8" data-testid="project-roots">
              <div className="text-2xs uppercase tracking-wide text-faint mb-2">Project Roots</div>
              {roots.map((r) => (
                <div key={r.path} className="group flex items-center gap-2 h-8" data-testid="project-root">
                  <span className="font-mono text-xs text-ink/85">{r.path}</span>
                  <button type="button" className="opacity-0 group-hover:opacity-100 text-faint hover:text-clay" onClick={() => void removeRoot(r.path)} aria-label="Quitar root"><Trash2 className="h-3 w-3" /></button>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-2">
                <input data-testid="root-input" value={newRoot} onChange={(e) => setNewRoot(e.target.value)} placeholder="D:\\Projects"
                  className="h-8 w-[320px] px-2 rounded bg-raised border border-hairline text-xs font-mono text-ink outline-none" />
                <Button variant="quiet" onClick={() => { if (newRoot.trim()) void addRoot(newRoot.trim()).then(() => setNewRoot('')); }}>
                  <FolderPlus className="h-3 w-3 mr-1 inline" />Añadir root
                </Button>
              </div>
            </div>

            {error && <div className="mb-4 text-xs text-clay" data-testid="projects-error">{error}</div>}
            {loading && <div className="text-xs text-muted mb-3">Buscando proyectos…</div>}
            {!loading && !projects.length && <div className="text-xs text-muted" data-testid="projects-empty">No se encontraron proyectos en los roots autorizados.</div>}

            <div className="space-y-px">
              {projects.map((p) => (
                <div key={p.id} className="group flex items-center gap-4 min-h-14 py-2 px-3 -mx-3 rounded hover:bg-white/[0.03]" data-testid="project-row" data-name={p.name}>
                  <FolderGit2 className="h-4 w-4 shrink-0 text-signal/80" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink/90">{p.name} <span className="text-2xs text-muted ml-1">{p.type}</span></div>
                    <div className="text-2xs text-faint font-mono truncate">{p.rootPath}</div>
                    <div className="flex flex-wrap gap-1 mt-1" data-testid="project-tech">
                      {p.technologies.map((t) => <Badge key={t} tone="muted">{TECH_LABEL[t] ?? t}</Badge>)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right" data-testid="project-git">
                    {p.git.isRepo
                      ? <Badge tone={p.git.dirty ? 'amber' : 'neutral'}>{p.git.branch ?? 'git'}{p.git.dirty ? ` · ${p.git.changedFiles} sin confirmar` : ' · limpio'}</Badge>
                      : <span className="text-2xs text-faint">sin Git</span>}
                  </div>
                  <div className="shrink-0 w-28 text-right">
                    <div className="text-2xs text-muted" data-testid="project-index">{p.status === 'indexed' ? `${p.files ?? 0} archivos indexados` : p.status === 'indexing' ? 'indexando…' : 'sin indexar'}</div>
                    <div className="text-2xs text-faint">{p.lastOpened ? ago(p.lastOpened) : 'nunca abierto'}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="quiet" onClick={() => void openProject(p.id)}>Abrir</Button>
                    <Button variant="ghost" data-authority-action onClick={() => { setJarvisOpen(true); submit(`Revisa el proyecto ${p.name} sin modificarlo`); }}>Pedir a JARVIS</Button>
                    <Button variant="quiet" onClick={() => void openProject(p.id).then((ok) => { if (ok) setModule('coding'); })}>Coding Workspace</Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
