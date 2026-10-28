import { useState } from 'react';
import { KeyRound, Lock, Search, ShieldCheck } from 'lucide-react';
import type { VaultEntry } from '@/types';
import { mockVaultEntries } from '@/mocks/vault';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ago } from '@/lib/format';
import { cn } from '@/lib/cn';

const CATEGORY_LABEL: Record<VaultEntry['category'], string> = {
  developer: 'Desarrollo', ai: 'IA', finance: 'Finanzas', personal: 'Personal', infrastructure: 'Infraestructura',
};

const STATUS = {
  active: { label: 'Activa', tone: 'moss' },
  rotate_soon: { label: 'Rotar pronto', tone: 'amber' },
  expired: { label: 'Caducada', tone: 'clay' },
} as const;

export function VaultView() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<VaultEntry | null>(mockVaultEntries[0]!);

  const entries = mockVaultEntries.filter(
    (e) => !query || e.name.toLowerCase().includes(query.toLowerCase()) || e.tags.some((t) => t.includes(query.toLowerCase())),
  );

  return (
    <div className="h-full flex min-h-0">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <header className="shrink-0 px-6 pt-5 pb-4 hairline-b">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl text-ink tracking-tight">Vault</h1>
              <p className="text-sm text-muted mt-0.5">
                Credenciales registradas. Los modelos nunca reciben el valor, sólo un identificador.
              </p>
            </div>
            <div className="ml-auto flex items-center gap-1.5 h-7 px-2 rounded bg-white/[0.035] border border-hairline focus-within:border-signal/45 transition-colors">
              <Search className="h-3.5 w-3.5 text-faint" strokeWidth={1.7} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar"
                className="bg-transparent text-xs outline-none w-36"
              />
            </div>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
          {entries.map((e) => {
            const s = STATUS[e.status];
            return (
              <button
                key={e.id}
                onClick={() => setSelected(e)}
                className={cn(
                  'w-full flex items-center gap-4 px-6 h-14 text-left hairline-b transition-colors',
                  selected?.id === e.id ? 'bg-signal/[0.06]' : 'hover:bg-white/[0.03]',
                )}
              >
                <span className="h-7 w-7 rounded grid place-items-center bg-white/[0.04] border border-hairline shrink-0">
                  <KeyRound className="h-3.5 w-3.5 text-faint" strokeWidth={1.7} />
                </span>
                <div className="min-w-0 w-48">
                  <div className="text-sm text-ink/90 truncate">{e.name}</div>
                  <div className="text-2xs text-faint font-mono truncate">{e.maskedIdentity}</div>
                </div>
                <Badge tone="muted" className="shrink-0">{CATEGORY_LABEL[e.category]}</Badge>
                <Badge tone={s.tone} className="shrink-0">{s.label}</Badge>
                <span className="ml-auto text-2xs text-faint shrink-0">{ago(e.lastUsed)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="w-[300px] shrink-0 hairline-l bg-graphite/60 flex flex-col min-h-0">
        {selected && (
          <>
            <div className="p-4 hairline-b">
              <div className="text-base text-ink">{selected.name}</div>
              <div className="text-2xs text-faint font-mono mt-1">{selected.handle}</div>
            </div>

            <dl className="p-4 space-y-2.5 text-xs">
              <div className="flex justify-between"><dt className="text-faint">Identidad</dt><dd className="font-mono text-ink/85">{selected.maskedIdentity}</dd></div>
              <div className="flex justify-between"><dt className="text-faint">Categoría</dt><dd className="text-ink/85">{CATEGORY_LABEL[selected.category]}</dd></div>
              <div className="flex justify-between"><dt className="text-faint">Último uso</dt><dd className="text-ink/85">{ago(selected.lastUsed)}</dd></div>
              <div className="flex justify-between"><dt className="text-faint">Estado</dt><dd className="text-ink/85">{STATUS[selected.status].label}</dd></div>
            </dl>

            <div className="px-4 pb-4">
              <div className="flex flex-wrap gap-1">
                {selected.tags.map((t) => <Badge key={t} tone="muted">{t}</Badge>)}
              </div>
            </div>

            <div className="mt-auto p-4 hairline-t space-y-3">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="h-3.5 w-3.5 text-moss mt-0.5 shrink-0" strokeWidth={1.7} />
                <p className="text-2xs text-muted leading-relaxed">
                  Un Credential Broker en el proceso principal resolverá el identificador contra DPAPI o TPM
                  e inyectará el valor directamente en la herramienta. El modelo sólo ve el identificador.
                </p>
              </div>
              <Button variant="quiet" className="w-full justify-center" disabled>
                <Lock className="h-3 w-3" strokeWidth={1.8} />
                Revelar valor
              </Button>
              <p className="text-2xs text-faint text-center">Disponible cuando exista el broker cifrado.</p>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
