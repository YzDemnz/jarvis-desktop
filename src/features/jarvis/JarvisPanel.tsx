import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, ChevronDown, Eraser, Minimize2, X } from 'lucide-react';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useUIStore } from '@/stores/useUIStore';
import { useTabsStore } from '@/stores/useTabsStore';
import { JarvisOrb, orbLabel } from '@/components/JarvisOrb';
import { MultiAIPanel } from '@/components/MultiAIPanel';
import { RoutingCard } from '@/components/RoutingCard';
import { PermissionControl } from '@/components/PermissionControl';
import { IconButton } from '@/components/ui/Button';
import { ActivityStream } from './ActivityStream';
import { StepList } from './StepList';
import { AuditPanel } from './AuditPanel';
import { modelLabel } from '@/services/ai/ModelRouter';
import { cn } from '@/lib/cn';

export function JarvisPanel() {
  const { jarvisOpen, jarvisWidth, setJarvisWidth, setJarvisOpen, setJarvisMinimized } = useUIStore();
  const { state, messages, events, lanes, routing, running, run, audit, submit, clearConversation, activityExpanded, setActivityExpanded } = useJarvisStore();

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, events.length, activityExpanded]);

  useEffect(() => {
    function move(e: MouseEvent) {
      if (!resizing.current) return;
      setJarvisWidth(window.innerWidth - e.clientX);
    }
    function up() {
      resizing.current = false;
      document.body.style.cursor = '';
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [setJarvisWidth]);

  if (!jarvisOpen) return null;

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const runningEvents = events.filter((e) => e.status === 'running' || e.status === 'awaiting_approval');

  return (
    <motion.aside
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      style={{ width: jarvisWidth }}
      className="relative shrink-0 flex flex-col bg-graphite hairline-l min-h-0"
    >
      <div
        onMouseDown={() => { resizing.current = true; document.body.style.cursor = 'col-resize'; }}
        className="absolute left-0 inset-y-0 w-1 -ml-0.5 cursor-col-resize z-20 hover:bg-signal/40 transition-colors"
      />

      <header className="h-11 shrink-0 flex items-center gap-2.5 px-3 hairline-b">
        <JarvisOrb state={state} size={18} />
        <div className="min-w-0">
          <div className="text-sm leading-none text-ink">JARVIS</div>
          <div className="text-2xs text-faint leading-none mt-1">{orbLabel(state)}</div>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <PermissionControl />
          <IconButton onClick={clearConversation} aria-label="Limpiar conversación">
            <Eraser className="h-3.5 w-3.5" strokeWidth={1.7} />
          </IconButton>
          <IconButton onClick={() => setJarvisMinimized(true)} aria-label="Minimizar">
            <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.7} />
          </IconButton>
          <IconButton onClick={() => setJarvisOpen(false)} aria-label="Cerrar panel">
            <X className="h-3.5 w-3.5" strokeWidth={1.7} />
          </IconButton>
        </div>
      </header>

      <ActiveTabContext />

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scroll-thin px-3 py-3 space-y-3.5">
        {messages.map((m) => (
          <Message key={m.id} role={m.role} content={m.content} modelId={m.modelId} sources={m.sources} />
        ))}

        {/* Live work sits under the conversation, not inside it. */}
        {(running || runningEvents.length > 0) && (
          <div className="space-y-2">
            {lanes.length > 0 && <MultiAIPanel lanes={lanes} />}
            {run?.steps.length ? <StepList steps={run.steps} /> : <ActivityStream events={events} limit={5} />}
          </div>
        )}

        {routing && (
          <div>
            <button
              onClick={() => setActivityExpanded(!activityExpanded)}
              className="w-full flex items-center gap-1.5 h-6 text-2xs text-faint hover:text-muted transition-colors"
            >
              <ChevronDown className={cn('h-3 w-3 transition-transform', activityExpanded && 'rotate-180')} strokeWidth={1.8} />
              Activity
              <span className="tnum ml-auto">{events.length}</span>
            </button>

            <AnimatePresence initial={false}>
              {activityExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden space-y-2 pt-1"
                >
                  <RoutingCard routing={routing} />
                  {lanes.length > 0 && !running && <MultiAIPanel lanes={lanes} />}
                  <ActivityStream events={events} showTime />
                  <AuditPanel entries={audit} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <footer className="shrink-0 p-2.5 hairline-t">
        <div className="rounded-md border border-hairline bg-white/[0.025] focus-within:border-signal/45 transition-colors">
          <textarea
            value={draft}
            rows={2}
            placeholder="Pide algo a JARVIS"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(draft);
                setDraft('');
              }
            }}
            className="w-full bg-transparent resize-none px-2.5 pt-2 text-sm outline-none scroll-thin"
          />
          <div className="flex items-center gap-2 px-2.5 pb-1.5">
            <span className="text-2xs text-faint truncate">
              {lastAssistant?.modelId ? modelLabel(lastAssistant.modelId) : 'El router local elige el modelo'}
            </span>
            <button
              onClick={() => { submit(draft); setDraft(''); }}
              disabled={!draft.trim() || running}
              className="ml-auto h-6 w-6 grid place-items-center rounded-xs bg-signal/15 border border-signal/30 text-signal disabled:opacity-30 hover:bg-signal/25 transition-colors"
              aria-label="Enviar"
            >
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>
      </footer>
    </motion.aside>
  );
}

function Message({ role, content, modelId, sources }: {
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelId?: string;
  sources?: { title: string; url: string }[];
}) {
  if (role === 'system') {
    return <p className="text-2xs text-faint text-center py-1">{content}</p>;
  }

  if (role === 'user') {
    return (
      <div className="pl-6">
        <p className="text-sm text-ink/95 leading-relaxed rounded-md bg-white/[0.045] px-2.5 py-1.5">{content}</p>
      </div>
    );
  }

  return (
    <div className="pr-2">
      {content.split('\n\n').map((para, i) => (
        <p key={i} className="text-sm text-ink/85 leading-relaxed mb-2 last:mb-0">{para}</p>
      ))}

      {sources && sources.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="text-2xs text-muted hover:text-signal border border-hairline rounded-xs px-1.5 h-[17px] leading-[15px] transition-colors"
            >
              {s.title}
            </a>
          ))}
        </div>
      )}

      {modelId && <div className="text-2xs text-faint mt-1.5 font-mono">{modelLabel(modelId)}</div>}
    </div>
  );
}

/** Shown in place of the panel when JARVIS is minimised. */
export function JarvisDock() {
  const { jarvisMinimized, setJarvisMinimized } = useUIStore();
  const state = useJarvisStore((s) => s.state);
  const running = useJarvisStore((s) => s.running);

  if (!jarvisMinimized) return null;

  return (
    <motion.button
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      onClick={() => setJarvisMinimized(false)}
      className="fixed bottom-5 right-5 z-50 h-11 w-11 rounded-full bg-panel border border-hairline shadow-xl shadow-black/60 grid place-items-center hover:border-signal/40 transition-colors"
      aria-label="Abrir JARVIS"
    >
      <JarvisOrb state={state} size={22} />
      {running && <span className="absolute inset-0 rounded-full border border-signal/40 animate-ping" />}
    </motion.button>
  );
}

/**
 * What JARVIS can see of the browser right now: url, title, load state and the
 * tab id. Deliberately the whole surface for this stage — reading page content
 * goes through BrowserService.getPageText, and acting on a page is not enabled.
 */
function ActiveTabContext() {
  const module = useUIStore((s) => s.module);
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeId));
  const submit = useJarvisStore((s) => s.submit);

  if (!tab || module !== 'browser') return null;

  return (
    <div className="shrink-0 px-3 py-2 hairline-b bg-void/40">
      <div className="flex items-center gap-2">
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', tab.loading ? 'bg-signal animate-pulse' : 'bg-moss/70')} />
        <span className="text-2xs text-muted truncate flex-1 min-w-0">{tab.title}</span>
        <button
          data-authority-action onClick={() => submit(`Analiza la página abierta: ${tab.url}`)}
          className="text-2xs text-faint hover:text-signal transition-colors shrink-0"
        >
          Usar como contexto
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-2xs text-faint font-mono truncate flex-1 min-w-0">{tab.url}</span>
        <span className="text-2xs text-faint/70 font-mono shrink-0">{tab.id.slice(-6)}</span>
      </div>
    </div>
  );
}
