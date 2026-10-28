import { motion } from 'framer-motion';
import type { AgentState } from '@/types';
import { cn } from '@/lib/cn';

interface Props {
  state: AgentState;
  size?: number;
  className?: string;
}

/**
 * The assistant's whole visual identity: a small aperture that changes
 * character rather than a face or a hologram. Each state gets its own
 * colour, ring behaviour and breathing rate.
 */
const PRESETS: Record<AgentState, { color: string; ring: number; period: number; spin: number; label: string }> = {
  idle:        { color: '#6E7B8C', ring: 0.22, period: 4.2, spin: 0,  label: 'En reposo' },
  listening:   { color: '#79A9FF', ring: 0.55, period: 1.6, spin: 0,  label: 'Escuchando' },
  thinking:    { color: '#79A9FF', ring: 0.42, period: 2.0, spin: 7,  label: 'Pensando' },
  searching:   { color: '#63C4C9', ring: 0.40, period: 1.5, spin: 4,  label: 'Buscando' },
  executing:   { color: '#3FB68B', ring: 0.48, period: 1.2, spin: 3,  label: 'Ejecutando' },
  controlling: { color: '#D8A13A', ring: 0.60, period: 0.9, spin: 2,  label: 'Controlando el equipo' },
  approval:    { color: '#D8A13A', ring: 0.75, period: 0.7, spin: 0,  label: 'Esperando aprobación' },
  error:       { color: '#DC5F52', ring: 0.70, period: 0.6, spin: 0,  label: 'Error' },
};

export function JarvisOrb({ state, size = 22, className }: Props) {
  const p = PRESETS[state];
  const r = size / 2;

  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`JARVIS: ${p.label}`}
    >
      {/* Outer halo — only really visible in the louder states */}
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{ background: p.color }}
        animate={{ opacity: [p.ring * 0.16, p.ring * 0.4, p.ring * 0.16], scale: [0.9, 1.35, 0.9] }}
        transition={{ duration: p.period, repeat: Infinity, ease: 'easeInOut' }}
      />

      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="relative">
        <circle cx={r} cy={r} r={r - 1} fill="none" stroke={p.color} strokeOpacity={0.32} strokeWidth={1} />

        {p.spin > 0 && (
          <motion.circle
            cx={r}
            cy={r}
            r={r - 1}
            fill="none"
            stroke={p.color}
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeDasharray={`${(2 * Math.PI * (r - 1)) / 4} ${2 * Math.PI * (r - 1)}`}
            style={{ transformOrigin: 'center' }}
            animate={{ rotate: 360 }}
            transition={{ duration: 8 / p.spin, repeat: Infinity, ease: 'linear' }}
          />
        )}

        <motion.circle
          cx={r}
          cy={r}
          r={r * 0.34}
          fill={p.color}
          animate={{ opacity: [0.75, 1, 0.75], r: [r * 0.3, r * 0.38, r * 0.3] }}
          transition={{ duration: p.period, repeat: Infinity, ease: 'easeInOut' }}
        />
      </svg>
    </span>
  );
}

export function orbLabel(state: AgentState): string {
  return PRESETS[state].label;
}

export function orbColor(state: AgentState): string {
  return PRESETS[state].color;
}
