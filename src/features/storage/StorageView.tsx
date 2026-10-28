import { Archive, Cloud, HardDrive, RefreshCw } from 'lucide-react';
import { mockArchiveCandidates, mockSyncTargets, mockVolumes } from '@/mocks/files';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Dot } from '@/components/ui/Badge';
import { ago, bytes } from '@/lib/format';
import { cn } from '@/lib/cn';

const ICONS = { local: HardDrive, cloud: Cloud, archive: Archive, sync: RefreshCw };

const SYNC_TONE = { synced: 'moss', syncing: 'signal', pending: 'amber', error: 'clay' } as const;
const SYNC_LABEL = { synced: 'Sincronizado', syncing: 'Sincronizando', pending: 'Pendiente', error: 'Error' } as const;

export function StorageView() {
  const savings = mockArchiveCandidates.reduce((a, c) => a + c.bytes, 0);

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-[980px] mx-auto px-8 py-10">
        <h1 className="text-xl text-ink tracking-tight mb-1">Storage</h1>
        <p className="text-sm text-muted mb-8">Dónde está todo y qué se puede recuperar.</p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
          {mockVolumes.map((v) => {
            const Icon = ICONS[v.kind];
            const pct = v.totalBytes ? (v.usedBytes / v.totalBytes) * 100 : null;
            return (
              <div key={v.id} className="surface rounded-lg p-3.5">
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="h-3.5 w-3.5 text-faint" strokeWidth={1.7} />
                  <span className="text-xs text-muted">{v.label}</span>
                  <Dot tone={v.status === 'healthy' ? 'moss' : v.status === 'syncing' ? 'signal' : 'amber'} className="ml-auto" />
                </div>
                <div className="text-[22px] tnum leading-none text-ink">{bytes(v.usedBytes)}</div>
                {v.totalBytes && (
                  <>
                    <div className="text-2xs text-faint mt-1 tnum">de {bytes(v.totalBytes)}</div>
                    <div className="h-[3px] rounded-full bg-white/[0.07] overflow-hidden mt-2.5">
                      <div
                        className={cn('h-full rounded-full', pct! > 85 ? 'bg-amber/70' : 'bg-signal/60')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3">
          <Panel
            title="Candidatos a archivar"
            meta={`${bytes(savings)} recuperables`}
            actions={<Button variant="quiet" disabled>Archivar selección</Button>}
          >
            <ul>
              {mockArchiveCandidates.map((c) => (
                <li key={c.id} className="flex items-center gap-4 px-3.5 h-12 hairline-b last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-ink/90 truncate">{c.name}</div>
                    <div className="text-2xs text-faint font-mono truncate">{c.path}</div>
                  </div>
                  <span className="text-2xs text-muted shrink-0 w-40 text-right">{c.reason}</span>
                  <span className="text-xs tnum text-ink/85 shrink-0 w-16 text-right">{bytes(c.bytes)}</span>
                </li>
              ))}
            </ul>
            <p className="px-3.5 py-2.5 text-2xs text-faint hairline-t">
              Nada se mueve ni se borra desde aquí. La lista es una propuesta hasta que exista el acceso real al disco.
            </p>
          </Panel>

          <Panel title="Sync Center">
            <ul>
              {mockSyncTargets.map((t) => (
                <li key={t.id} className="px-3.5 py-2.5 hairline-b last:border-0">
                  <div className="flex items-center gap-2">
                    <Dot tone={SYNC_TONE[t.status]} />
                    <span className="text-xs text-ink/90 truncate">{t.label}</span>
                    <span className="ml-auto text-2xs text-muted shrink-0">{SYNC_LABEL[t.status]}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 pl-3.5">
                    <span className="text-2xs text-faint">{ago(t.lastSync)}</span>
                    {t.pending > 0 && <span className="text-2xs text-faint tnum">{t.pending} pendientes</span>}
                    {t.error && <span className="text-2xs text-clay">{t.error}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
