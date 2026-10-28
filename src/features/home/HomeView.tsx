import type { AgentRun } from '@/types';
import { useState, useEffect } from 'react';
import type { ProviderDescriptor } from '@/fabric/types';
import { ArrowUpRight, GitBranch } from 'lucide-react';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useUIStore } from '@/stores/useUIStore';
import { useWorkspaceStore } from '@/stores/useWorkspaceStore';
import { mockProviders } from '@/mocks/providers';
import { mockQuotes } from '@/mocks/markets';
import { JarvisOrb, orbLabel } from '@/components/JarvisOrb';
import { Sparkline } from '@/components/ui/Sparkline';
import { Dot } from '@/components/ui/Badge';
import { ago, signed } from '@/lib/format';
import { cn } from '@/lib/cn';
import {WorkstationStatus} from './WorkstationStatus';

const SUGGESTIONS = ['Analiza NVIDIA', 'Busca config.json en mi PC', 'Revisa el proyecto Vigilia', 'Compara NVDA y AMD'];

const STATUS_TONE = {
  ready: 'moss', connected: 'moss', degraded: 'amber', offline: 'clay', unconfigured: 'muted',
} as const;

const STATUS_LABEL = {
  ready: 'Listo', connected: 'Conectado', degraded: 'Degradado', offline: 'Sin conexión', unconfigured: 'Sin configurar',
} as const;

export function HomeView() {
  const { submit, state, runs } = useJarvisStore();
  const { setJarvisOpen, setModule } = useUIStore();
  const { workspaces, activeId, projectsFor } = useWorkspaceStore();
  const workspace = workspaces.find((w) => w.id === activeId)!;
  const projects = projectsFor();
  const [draft, setDraft] = useState('');
  const [nativeProviders,setNativeProviders]=useState<ProviderDescriptor[]|null>(window.jarvis?.bootstrap?[]:null);
  useEffect(()=>{if(!window.jarvis?.bootstrap)return;let disposed=false;const refresh=()=>window.jarvis!.connected.snapshot().then(s=>{if(!disposed)setNativeProviders(s.providers);}).catch(()=>{});void window.jarvis.connected.refresh().then(()=>refresh());const timer=setInterval(()=>void refresh(),5000);return()=>{disposed=true;clearInterval(timer);};},[]);

  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';

  function send(text: string) {
    if (!text.trim()) return;
    setJarvisOpen(true);
    submit(text.trim());
    setDraft('');
  }

  const movers = mockQuotes.filter((q) => ['NVDA', 'AMD', 'BTC', 'SPX'].includes(q.symbol));

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-[820px] mx-auto px-8 py-14">
        {/* The orb is the hero — everything else stays quiet around it. */}
        <div className="flex items-center gap-3 mb-10">
          <JarvisOrb state={state} size={30} />
          <div>
            <div className="text-sm text-ink/90 leading-none">JARVIS</div>
            <div className="text-2xs text-faint leading-none mt-1.5">{orbLabel(state)} · {workspace.name}</div>
          </div>
        </div>

        <h1 className="text-[30px] leading-tight tracking-[-0.015em] text-ink/95 mb-1">{greeting}.</h1>
        <p className="text-base text-muted mb-7">¿En qué estamos trabajando?</p>

        <div className="rounded-lg border border-hairline bg-panel/70 focus-within:border-signal/45 transition-colors">
          <textarea
            data-authority-home-input
            value={draft}
            rows={3}
            placeholder="Pide algo a JARVIS o escribe una orden"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); }
            }}
            className="w-full bg-transparent resize-none px-4 pt-3.5 text-base outline-none scroll-thin"
          />
          <div className="flex items-center gap-2 px-4 pb-3">
            <span className="text-2xs text-faint">Enter para enviar</span>
            <button
              data-authority-home-send
              onClick={() => send(draft)}
              disabled={!draft.trim()}
              className="ml-auto h-7 px-3 rounded text-xs bg-signal/15 border border-signal/30 text-signal disabled:opacity-30 hover:bg-signal/25 transition-colors"
            >
              Enviar
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              data-authority-action
              onClick={() => send(s)}
              className="h-6 px-2.5 rounded-xs border border-hairline text-2xs text-muted hover:text-ink hover:border-signal/35 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>

        <WorkstationStatus />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-9 mt-14">
          <section>
            <h2 className="text-xs text-faint mb-2.5">Recientes</h2>
            <div className="space-y-px">
              {projects.slice(0, 4).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setModule('coding')}
                  className="group w-full flex items-center gap-2.5 h-8 px-2 -mx-2 rounded-xs hover:bg-white/[0.035] transition-colors text-left"
                >
                  <GitBranch className="h-3.5 w-3.5 text-faint shrink-0" strokeWidth={1.7} />
                  <span className="text-sm text-ink/85 truncate">{p.name}</span>
                  {p.dirtyFiles > 0 && <span className="text-2xs text-amber tnum shrink-0">{p.dirtyFiles}</span>}
                  <span className="ml-auto text-2xs text-faint shrink-0">{ago(p.lastOpened)}</span>
                  <ArrowUpRight className="h-3 w-3 text-faint opacity-0 group-hover:opacity-100 transition-opacity shrink-0" strokeWidth={1.8} />
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xs text-faint mb-2.5">Sistema</h2>
            <div className="space-y-px">
              {(nativeProviders?[...nativeProviders]:[]).sort((a,b)=>(a.id==='bootstrap-local'?-1:b.id==='bootstrap-local'?1:0)).slice(0,6).map(p=><div key={p.id} className="flex items-center gap-2.5 h-8 px-2 -mx-2"><Dot tone={p.state==='AVAILABLE'&&p.surface?.verification==='INFERENCE_OBSERVED'?'moss':p.state==='AUTH_REQUIRED'?'muted':'amber'}/><span className="text-sm text-ink/85 truncate">{p.label}</span><span className="ml-auto text-2xs text-faint">{p.state==='AVAILABLE'?(p.surface?.verification==='INFERENCE_OBSERVED'?'Verificada':'Detectada'):p.state==='AUTH_REQUIRED'?'Login / clave':p.state==='DETECTED'?'Detectada':p.state==='CONNECTED'?'Sin verificar':p.state}</span></div>)}
              {nativeProviders===null&&mockProviders.map((p) => (
                <div key={p.id} className="flex items-center gap-2.5 h-8 px-2 -mx-2">
                  <Dot tone={STATUS_TONE[p.status]} />
                  <span className="text-sm text-ink/85">{p.label}</span>
                  {p.latencyMs && <span className="text-2xs text-faint tnum">{p.latencyMs} ms</span>}
                  <span className="ml-auto text-2xs text-muted">{STATUS_LABEL[p.status]}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xs text-faint mb-2.5">Mercados</h2>
            <div className="space-y-px">
              {movers.map((q) => {
                const up = q.change >= 0;
                return (
                  <button
                    key={q.symbol}
                    onClick={() => setModule('markets')}
                    className="w-full flex items-center gap-3 h-8 px-2 -mx-2 rounded-xs hover:bg-white/[0.035] transition-colors"
                  >
                    <span className="text-sm text-ink/85 w-12 text-left">{q.symbol}</span>
                    <Sparkline values={q.spark} color={up ? '#3FB68B' : '#DC5F52'} width={64} height={16} />
                    <span className={cn('ml-auto text-xs tnum', up ? 'text-moss' : 'text-clay')}>
                      {signed(q.changePercent)}%
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="text-xs text-faint mb-2.5">Actividad</h2>
            {runs.length === 0 ? (
              <p className="text-sm text-faint leading-relaxed">
                Todavía no has pedido nada en esta sesión. Prueba con una de las sugerencias de arriba.
              </p>
            ) : (
              <div className="space-y-px">
                {runs.slice(0, 4).map((t: AgentRun) => (
                  <div key={t.id} className="flex items-center gap-2.5 h-8 px-2 -mx-2">
                    <Dot tone={t.status === 'completed' ? 'moss' : t.status === 'cancelled' ? 'muted' : 'signal'} />
                    <span className="text-sm text-ink/80 truncate">{t.prompt}</span>
                    <span className="ml-auto text-2xs text-faint shrink-0">{ago(t.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
