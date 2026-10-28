import { useEffect, useState } from 'react';
import { FolderGit2, GitBranch, Play, Sparkles, Undo2, X } from 'lucide-react';
import { useDevStore } from '@/stores/useDevStore';
import type { EditorTab } from '@/stores/useDevStore';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useUIStore } from '@/stores/useUIStore';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { languageOf } from '@/dev/classify';
import { ProjectExplorer } from './ProjectExplorer';
import { DiffViewer } from './DiffViewer';
import { TerminalPanel } from './TerminalPanel';
import { ReviewChanges } from './ReviewChanges';
import { codeEditorAdapter } from './editor/CodeEditorAdapter';
import { basicCodeEditorAdapter } from './editor/BasicCodeEditor';
import { cn } from '@/lib/cn';

function Tab({ tab, active }: { tab: EditorTab; active: boolean }) {
  const { setActiveTab, closeTab } = useDevStore();
  const [confirm, setConfirm] = useState(false);
  const dirty = tab.content !== tab.saved;
  return (
    <div className={cn('group h-8 flex items-center gap-1.5 pl-3 pr-1.5 border-r border-hairline text-xs shrink-0', active ? 'bg-panel text-ink' : 'text-muted hover:text-ink')}
      data-testid="editor-tab" data-path={tab.rel} data-dirty={dirty ? 'yes' : 'no'} data-active={active ? 'yes' : 'no'}>
      <button type="button" onClick={() => setActiveTab(tab.rel)} className="truncate max-w-[180px]">{tab.rel.split('/').pop()}</button>
      {dirty && <span className="text-amber" data-testid="tab-modified" title="Sin guardar">●</span>}
      {confirm ? (
        <span className="flex items-center gap-1">
          <button type="button" className="text-2xs text-clay" data-testid="tab-discard" onClick={() => closeTab(tab.rel)}>Descartar</button>
          <button type="button" className="text-2xs text-muted" onClick={() => setConfirm(false)}>No</button>
        </span>
      ) : (
        <button type="button" data-testid="tab-close" className="h-5 w-5 grid place-items-center rounded hover:bg-white/[0.06]"
          onClick={() => (dirty ? setConfirm(true) : closeTab(tab.rel))} aria-label="Cerrar">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function EditorArea() {
  const { tabs, activeTab, diff, closeDiff, editTab, saveTab, reloadTab, showTabDiff, setCursor, revertFile } = useDevStore();
  const tab = tabs.find((t) => t.rel === activeTab) ?? null;
  const Editor = codeEditorAdapter(basicCodeEditorAdapter).Component;

  if (diff) {
    return (
      <ErrorBoundary label="Diff">
        <DiffViewer before={diff.before} after={diff.after} title={diff.title} onClose={closeDiff}
          actions={diff.runId ? <button type="button" className="text-2xs text-clay mr-2" data-testid="diff-revert-file" onClick={() => void revertFile(diff.runId!, diff.path).then(closeDiff)}>Revertir archivo</button> : null} />
      </ErrorBoundary>
    );
  }
  if (!tab) return <div className="h-full grid place-items-center text-xs text-muted" data-testid="editor-empty">Abre un archivo desde el explorador.</div>;

  const dirty = tab.content !== tab.saved;
  const readOnly = tab.binary || tab.secret || tab.truncated;
  return (
    <div className="h-full flex flex-col min-h-0">
      {tab.conflict && (
        <div className="shrink-0 flex items-center gap-3 px-3 py-2 bg-amber/10 text-amber text-2xs" data-testid="editor-conflict">
          <span className="flex-1">El archivo cambió en disco desde que lo abriste. No se sobrescribió.</span>
          <button type="button" className="underline" onClick={() => showTabDiff(tab.rel)}>Ver mis cambios</button>
          <button type="button" className="underline" data-testid="editor-reload" onClick={() => void reloadTab(tab.rel)}>Recargar desde disco</button>
        </div>
      )}
      {tab.error && !tab.conflict && <div className="shrink-0 px-3 py-2 bg-clay/10 text-clay text-2xs" data-testid="editor-error">{tab.error}</div>}
      {readOnly && (
        <div className="shrink-0 px-3 py-1.5 text-2xs text-muted border-b border-hairline" data-testid="editor-readonly">
          {tab.binary ? 'Archivo binario: no se muestra como texto.' : tab.secret ? 'Archivo de secretos: valores redactados, sólo lectura aquí.' : 'Archivo grande: se muestra un rango, sólo lectura.'}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <ErrorBoundary label="Editor">
          <Editor value={tab.content} language={languageOf('.' + (tab.rel.split('.').pop() ?? ''))} readOnly={readOnly}
            onChange={(v) => editTab(tab.rel, v)} onSave={() => void saveTab(tab.rel)} onCursor={(l, c) => setCursor(tab.rel, l, c)} />
        </ErrorBoundary>
      </div>
      <div className="h-6 shrink-0 flex items-center gap-3 px-3 border-t border-hairline text-2xs text-faint font-mono" data-testid="editor-status">
        <span data-testid="editor-cursor">Ln {tab.cursor.line}, Col {tab.cursor.column}</span>
        <span>{languageOf('.' + (tab.rel.split('.').pop() ?? '')) ?? 'texto'}</span>
        <span>{codeEditorAdapter(basicCodeEditorAdapter).label}</span>
        <div className="flex-1" />
        {dirty && <button type="button" className="text-signal" data-testid="editor-diff" onClick={() => showTabDiff(tab.rel)}>Ver cambios</button>}
        <button type="button" className={cn(dirty ? 'text-signal' : 'text-faint')} disabled={!dirty || readOnly} data-testid="editor-save" onClick={() => void saveTab(tab.rel)}>Guardar (Ctrl+S)</button>
      </div>
    </div>
  );
}

function ProjectPicker() {
  const { projects, openProject, mode, loading } = useDevStore();
  const setModule = useUIStore((s) => s.setModule);
  if (mode === 'unavailable') {
    return <div className="h-full grid place-items-center text-sm text-muted px-8 text-center" data-testid="dev-unavailable">El agente de desarrollo trabaja sobre tus carpetas locales y necesita la aplicación de escritorio.</div>;
  }
  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-[640px] mx-auto px-8 py-10">
        <h1 className="text-lg text-ink mb-1">Coding Workspace</h1>
        <p className="text-sm text-muted mb-6">Elige un proyecto de tus Project Roots.</p>
        {loading && <div className="text-xs text-muted">Buscando proyectos…</div>}
        {projects.map((p) => (
          <button key={p.id} type="button" data-testid="picker-project" onClick={() => void openProject(p.id)}
            className="w-full text-left flex items-center gap-3 h-11 px-3 -mx-3 rounded hover:bg-white/[0.04]">
            <FolderGit2 className="h-4 w-4 text-signal/80" />
            <span className="text-sm text-ink/90">{p.name}</span>
            <span className="text-2xs text-faint font-mono truncate">{p.rootPath}</span>
          </button>
        ))}
        {!loading && !projects.length && (
          <div className="text-xs text-muted">No hay proyectos. <button type="button" className="text-signal" onClick={() => setModule('projects')}>Añade un Project Root</button>.</div>
        )}
      </div>
    </div>
  );
}

/**
 * Explorer · Editor/Diff · Terminal/Changes. The JARVIS panel is the app's own
 * panel: coding runs show there with their UNDERSTAND/CHANGE/VERIFY steps.
 */
export function CodingView() {
  const { project, files, tabs, activeTab, error, bottom, setBottom, openFile, undoLast, refresh, attach, projects, closeDiff } = useDevStore();
  const submit = useJarvisStore((s) => s.submit);
  const setJarvisOpen = useUIStore((s) => s.setJarvisOpen);

  useEffect(() => attach(), [attach]);
  useEffect(() => { if (!projects.length) void refresh(); }, [projects.length, refresh]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDiff(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeDiff]);

  const dismiss = () => useDevStore.setState({ error: null });

  if (!project) {
    return (
      <div className="h-full flex flex-col" data-testid="coding-workspace" data-state="picker">
        {error && <div className="px-4 py-2 text-2xs text-clay bg-clay/10" data-testid="dev-error">{error} <button type="button" className="underline ml-2" onClick={dismiss}>Cerrar</button></div>}
        <div className="flex-1 min-h-0"><ProjectPicker /></div>
      </div>
    );
  }

  const ask = (prompt: string) => { setJarvisOpen(true); submit(prompt); };
  return (
    <div className="h-full flex flex-col min-h-0" data-testid="coding-workspace" data-state="open" data-project={project.name}>
      <div className="h-10 shrink-0 flex items-center gap-3 px-3 border-b border-hairline">
        <FolderGit2 className="h-4 w-4 text-signal/80" />
        <span className="text-sm text-ink" data-testid="workspace-project">{project.name}</span>
        <span className="text-2xs text-faint font-mono truncate hidden lg:inline">{project.rootPath}</span>
        {project.git.isRepo && (
          <Badge tone={project.git.dirty ? 'amber' : 'neutral'}>
            <GitBranch className="h-3 w-3 inline mr-1" />{project.git.branch ?? 'git'}{project.git.dirty ? ` · ${project.git.changedFiles} sin confirmar` : ''}
          </Badge>
        )}
        <span className="text-2xs text-muted">{files.length} archivos</span>
        <div className="flex-1" />
        <Button variant="quiet" data-authority-action onClick={() => ask(`Ejecuta las pruebas del proyecto ${project.name}`)}><Play className="h-3 w-3 mr-1 inline" />Pruebas</Button>
        <Button variant="quiet" onClick={() => setBottom('changes')}>Revisar cambios</Button>
        <Button variant="quiet" onClick={() => void undoLast().then(() => setBottom('changes'))}><Undo2 className="h-3 w-3 mr-1 inline" />Deshacer</Button>
        <Button variant="ghost" data-authority-action onClick={() => ask(`Revisa el proyecto ${project.name} sin modificarlo`)}><Sparkles className="h-3 w-3 mr-1 inline" />Pedir a JARVIS</Button>
      </div>
      {error && <div className="shrink-0 px-4 py-2 text-2xs text-clay bg-clay/10" data-testid="dev-error">{error} <button type="button" className="underline ml-2" onClick={dismiss}>Cerrar</button></div>}
      <div className="flex-1 min-h-0 flex">
        <div className="w-[240px] shrink-0 border-r border-hairline min-h-0">
          <ErrorBoundary label="Explorador">
            <ProjectExplorer files={files} activeRel={activeTab} onOpen={(rel) => void openFile(rel)} />
          </ErrorBoundary>
        </div>
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="h-8 shrink-0 flex overflow-x-auto scroll-thin border-b border-hairline" data-testid="editor-tabs">
            {tabs.map((t) => <Tab key={t.rel} tab={t} active={t.rel === activeTab} />)}
          </div>
          <div className="flex-1 min-h-0"><EditorArea /></div>
          <div className="h-[240px] shrink-0 border-t border-hairline flex flex-col min-h-0">
            <div className="h-8 shrink-0 flex items-center gap-1 px-2 border-b border-hairline">
              {(['terminal', 'changes'] as const).map((b) => (
                <button key={b} type="button" data-testid={`bottom-${b}`} onClick={() => setBottom(b)}
                  className={cn('h-6 px-2 rounded text-2xs', bottom === b ? 'bg-white/[0.06] text-ink' : 'text-muted')}>
                  {b === 'terminal' ? 'Terminal' : 'Review Changes'}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0">
              <ErrorBoundary label={bottom === 'terminal' ? 'Terminal' : 'Review Changes'}>
                {bottom === 'terminal' ? <TerminalPanel /> : <ReviewChanges />}
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
