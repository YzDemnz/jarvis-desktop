import { useState } from 'react';
import { FileText, Globe, Image as ImageIcon, Plus, Quote } from 'lucide-react';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useUIStore } from '@/stores/useUIStore';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ago } from '@/lib/format';
import { cn } from '@/lib/cn';

interface Source {
  id: string;
  kind: 'web' | 'pdf' | 'shot' | 'note';
  title: string;
  origin: string;
  added: number;
  cited: number;
}

const INVESTIGATIONS = [
  { id: 'i1', name: 'Cadena de suministro de GPU', sources: 9, updated: Date.now() - 3600_000 },
  { id: 'i2', name: 'Licencias de servidores Reforger', sources: 4, updated: Date.now() - 86_400_000 },
  { id: 'i3', name: 'Jurisprudencia de contratos marco', sources: 12, updated: Date.now() - 86_400_000 * 3 },
];

const SOURCES: Source[] = [
  { id: 's1', kind: 'web', title: 'Guía de capex de hiperescaladores', origin: 'reuters.com', added: Date.now() - 1800_000, cited: 3 },
  { id: 's2', kind: 'pdf', title: 'Informe trimestral 10-Q', origin: 'investor.nvidia.com', added: Date.now() - 5400_000, cited: 5 },
  { id: 's3', kind: 'web', title: 'Suministro de memoria HBM', origin: 'digitimes.com', added: Date.now() - 9000_000, cited: 2 },
  { id: 's4', kind: 'shot', title: 'Gráfico comparativo 1Y', origin: 'captura local', added: Date.now() - 12_600_000, cited: 1 },
  { id: 's5', kind: 'note', title: 'Hipótesis inicial', origin: 'nota propia', added: Date.now() - 86_400_000, cited: 0 },
];

const KIND_ICON = { web: Globe, pdf: FileText, shot: ImageIcon, note: Quote };

const NOTE = `La demanda de cómputo para entrenamiento sigue por encima de la oferta disponible. Los tres
principales compradores han elevado su guía de capex, lo que cubre aproximadamente los próximos
cuatro trimestres de producción comprometida.

El riesgo no está en la demanda sino en el marco regulatorio: hay una revisión de controles de
exportación en curso cuyo alcance todavía no es público.

Queda por contrastar si el suministro de memoria HBM es realmente un cuello de botella estructural
o un desajuste temporal.`;

export function ResearchView() {
  const [active, setActive] = useState(INVESTIGATIONS[0]!.id);
  const [note, setNote] = useState(NOTE);
  const submit = useJarvisStore((s) => s.submit);
  const setJarvisOpen = useUIStore((s) => s.setJarvisOpen);
  const investigation = INVESTIGATIONS.find((i) => i.id === active)!;

  return (
    <div className="h-full flex min-h-0">
      <aside className="w-[272px] shrink-0 hairline-r bg-graphite/60 flex flex-col min-h-0">
        <div className="px-3 py-2.5 hairline-b flex items-center gap-2">
          <span className="text-xs text-ink">Investigaciones</span>
          <Button size="xs" variant="ghost" className="ml-auto" aria-label="Nueva investigación">
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
          </Button>
        </div>

        <div className="py-1">
          {INVESTIGATIONS.map((i) => (
            <button
              key={i.id}
              onClick={() => setActive(i.id)}
              className={cn(
                'w-full px-3 py-2 text-left transition-colors',
                i.id === active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]',
              )}
            >
              <div className="text-xs text-ink/90 truncate">{i.name}</div>
              <div className="text-2xs text-faint mt-0.5">{i.sources} fuentes · {ago(i.updated)}</div>
            </button>
          ))}
        </div>

        <div className="hairline-t mt-1 pt-2 flex-1 min-h-0 overflow-y-auto scroll-thin">
          <div className="px-3 pb-1.5 text-2xs text-faint">Fuentes de {investigation.name.toLowerCase()}</div>
          {SOURCES.map((s) => {
            const Icon = KIND_ICON[s.kind];
            return (
              <div key={s.id} className="group flex items-start gap-2.5 px-3 py-2 hover:bg-white/[0.03] transition-colors">
                <Icon className="h-3.5 w-3.5 text-faint mt-0.5 shrink-0" strokeWidth={1.7} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink/85 leading-snug">{s.title}</div>
                  <div className="text-2xs text-faint truncate">{s.origin}</div>
                </div>
                {s.cited > 0 && <span className="text-2xs text-signal tnum shrink-0 mt-0.5">{s.cited}</span>}
              </div>
            );
          })}
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <header className="shrink-0 px-6 pt-5 pb-3 hairline-b flex items-center gap-3">
          <div>
            <h1 className="text-lg text-ink tracking-tight">{investigation.name}</h1>
            <p className="text-2xs text-faint mt-0.5">
              {investigation.sources} fuentes · actualizado {ago(investigation.updated)}
            </p>
          </div>
          <Badge tone="signal" className="ml-auto">{SOURCES.filter((s) => s.cited > 0).length} citadas</Badge>
          <Button
            variant="quiet"
            data-authority-action onClick={() => { setJarvisOpen(true); submit(`Busca fuentes nuevas sobre ${investigation.name}`); }}
          >
            Buscar más fuentes
          </Button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            spellCheck={false}
            className="w-full min-h-full bg-transparent resize-none px-6 py-6 text-base leading-[1.75] outline-none max-w-[72ch] scroll-thin"
          />
        </div>

        <footer className="shrink-0 h-8 flex items-center gap-4 px-6 hairline-t text-2xs text-faint">
          <span className="tnum">{note.split(/\s+/).filter(Boolean).length} palabras</span>
          <span>Guardado automático simulado</span>
        </footer>
      </div>
    </div>
  );
}
