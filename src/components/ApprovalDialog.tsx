import { AnimatePresence, motion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { toolRegistry } from '@/agent/registry';
import { Button } from './ui/Button';
import { cn } from '@/lib/cn';

const RISK_TONE: Record<string, string> = {
  SAFE: 'text-moss border-moss/30 bg-moss/10',
  SENSITIVE: 'text-amber border-amber/35 bg-amber/10',
  DESTRUCTIVE: 'text-clay border-clay/40 bg-clay/10',
  CRITICAL: 'text-halt border-halt/50 bg-halt/12',
};

export function ApprovalDialog() {
  const { approval, resolveApproval } = useJarvisStore();
  const tool = approval ? toolRegistry.get(approval.toolId) : undefined;

  return (
    <AnimatePresence>
      {approval && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/55 glass px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            initial={{ y: 8, scale: 0.985 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 6, scale: 0.99 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-[470px] rounded-xl bg-panel border border-hairline shadow-2xl shadow-black/70 overflow-hidden"
            role="alertdialog"
            aria-modal="true"
          >
            <div className="p-5">
              <div className="flex items-start gap-3">
                <span className="h-7 w-7 rounded grid place-items-center bg-amber/12 border border-amber/30 shrink-0">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber" strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base text-ink leading-snug">JARVIS quiere ejecutar</h2>
                  <p className="text-sm font-mono text-signal mt-1">{approval.toolId}</p>
                </div>
              </div>

              {approval.target && (
                <Field label="Objetivo" value={approval.target} mono />
              )}

              <div className="mt-3 flex items-center gap-2">
                <span className="text-2xs text-faint w-[62px] shrink-0">Riesgo</span>
                <span className={cn('text-2xs px-1.5 h-[18px] leading-[16px] rounded-xs border', RISK_TONE[approval.risk])}>
                  {approval.risk}
                </span>
                {tool && <span className="text-2xs text-faint">{tool.name}</span>}
              </div>

              <Field label="Motivo" value={approval.reason} />
              {approval.argsSummary !== '—' && <Field label="Argumentos" value={approval.argsSummary} mono />}
            </div>

            <div className="px-5 py-3 hairline-t bg-white/[0.015]">
              <div className="flex items-center gap-2">
                <span className="text-2xs text-faint mr-auto">Requiere nivel {approval.requiredPermission}</span>
                <Button size="md" variant="ghost" onClick={() => resolveApproval('deny')}>Denegar</Button>
                <Button size="md" variant="quiet" onClick={() => resolveApproval('allow_for_run')}>Permitir en esta tarea</Button>
                <Button size="md" variant="solid" onClick={() => resolveApproval('allow_once')}>Permitir una vez</Button>
              </div>
              <button
                onClick={() => resolveApproval('cancel_run')}
                className="mt-2 text-2xs text-faint hover:text-halt transition-colors"
              >
                Cancelar la tarea completa
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="mt-3 flex items-start gap-2">
      <span className="text-2xs text-faint w-[62px] shrink-0 pt-0.5">{label}</span>
      <span className={cn('text-xs text-ink/90 break-all min-w-0', mono && 'font-mono')}>{value}</span>
    </div>
  );
}
