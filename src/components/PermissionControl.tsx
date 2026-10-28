import { useState } from 'react';
import { Eye, Hand } from 'lucide-react';
import type { PermissionLevel } from '@/types';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { cn } from '@/lib/cn';

const LEVELS: { id: PermissionLevel; icon: typeof Eye; label: string; blurb: string }[] = [
  { id: 'RESTRICTED', icon: Eye, label: 'RESTRICTED', blurb: 'Política conservadora' },
  { id: 'FULL', icon: Hand, label: 'FULL', blurb: 'Trabajo nativo con permisos normales de Windows' },
];

const TONE: Record<PermissionLevel, string> = {
  FULL: 'text-signal', RESTRICTED: 'text-muted',
  OBSERVE: 'text-muted',
  ASSIST: 'text-signal',
  CONTROL: 'text-amber',
  ADMIN: 'text-clay',
};

export function PermissionControl({ compact = false }: { compact?: boolean }) {
  const { permission, setPermission } = useJarvisStore();
  const [open, setOpen] = useState(false);
  const current = LEVELS.find((l) => l.id === permission) ?? LEVELS[0]!;
  const Icon = current.icon;

  return (
    <div className="relative">
      <button
        aria-label="Modo de acceso"
        onClick={() => window.jarvis?.authority ? void window.jarvis.authority.choose() : setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 h-6 px-1.5 rounded-xs hover:bg-white/[0.06] transition-colors',
          TONE[permission],
        )}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
        {!compact && <span className="text-2xs">{current.label}</span>}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-7 z-50 w-64 raised-surface rounded-md p-1 shadow-2xl shadow-black/60">
            {LEVELS.map((l) => {
              const LIcon = l.icon;
              return (
                <button
                  key={l.id}
                  onClick={() => { setPermission(l.id); setOpen(false); }}
                  className={cn(
                    'w-full flex items-start gap-2.5 p-2 rounded-xs text-left hover:bg-white/[0.06] transition-colors',
                    l.id === permission && 'bg-white/[0.05]',
                  )}
                >
                  <LIcon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', TONE[l.id])} strokeWidth={1.7} />
                  <span className="min-w-0">
                    <span className="block text-xs text-ink">{l.label}</span>
                    <span className="block text-2xs text-faint leading-snug">{l.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
