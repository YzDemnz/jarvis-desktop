import { AnimatePresence, motion } from 'framer-motion';
import { Octagon } from 'lucide-react';
import { useJarvisStore } from '@/stores/useJarvisStore';

/**
 * Appears only while something is actually running, so it can never be
 * mistaken for ordinary chrome — and can never be missed when it matters.
 */
export function StopAgentButton() {
  const { running, state, stop } = useJarvisStore();
  const visible = running || state === 'controlling' || state === 'executing' || state === 'approval';

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: 'auto' }}
          exit={{ opacity: 0, width: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          onClick={stop}
          data-testid="stop-agent"
          aria-label="Detener agente"
          className="h-7 px-2.5 mr-1 flex items-center gap-1.5 rounded border border-halt/45 bg-halt/15 text-halt hover:bg-halt/25 transition-colors overflow-hidden whitespace-nowrap"
        >
          <Octagon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span className="text-xs font-medium">Detener</span>
          <kbd className="text-2xs opacity-70 border border-halt/35 rounded-xs px-1">Esc Esc</kbd>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
