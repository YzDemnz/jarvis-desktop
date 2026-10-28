import { session } from 'electron';
import type { Session } from 'electron';

/**
 * A profile is a hard boundary: its own partition, therefore its own cookies,
 * localStorage, cache, service workers and logins. Nothing leaks across them.
 */
export type BrowserProfileId = 'personal' | 'work' | 'trading' | 'development';

export interface ProfileDefinition {
  id: BrowserProfileId;
  label: string;
  /** `persist:` prefix is what makes the storage survive a restart. */
  partition: string;
  accent: string;
  description: string;
}

export const PROFILES: ProfileDefinition[] = [
  {
    id: 'personal',
    label: 'Personal',
    partition: 'persist:jarvis-personal',
    accent: '#79A9FF',
    description: 'Navegación diaria y cuentas personales.',
  },
  {
    id: 'work',
    label: 'Work',
    partition: 'persist:jarvis-work',
    accent: '#A78BFA',
    description: 'Cuentas de trabajo, aisladas de las personales.',
  },
  {
    id: 'trading',
    label: 'Trading',
    partition: 'persist:jarvis-trading',
    accent: '#DC5F52',
    description: 'Brókers y terminales de mercado.',
  },
  {
    id: 'development',
    label: 'Development',
    partition: 'persist:jarvis-development',
    accent: '#3FB68B',
    description: 'Entornos locales, paneles y documentación.',
  },
];

export const DEFAULT_PROFILE: BrowserProfileId = 'personal';

const PROFILE_IDS = PROFILES.map((p) => p.id);

export function isProfileId(value: unknown): value is BrowserProfileId {
  return typeof value === 'string' && (PROFILE_IDS as string[]).includes(value);
}

export function profileDefinition(id: BrowserProfileId): ProfileDefinition {
  return PROFILES.find((p) => p.id === id) ?? PROFILES[0]!;
}

const sessions = new Map<BrowserProfileId, Session>();

/** Sessions are created lazily and only once per profile. */
export function sessionFor(id: BrowserProfileId): Session {
  const existing = sessions.get(id);
  if (existing) return existing;
  const created = session.fromPartition(profileDefinition(id).partition, { cache: true });
  sessions.set(id, created);
  return created;
}

export function eachLoadedSession(fn: (id: BrowserProfileId, s: Session) => void): void {
  sessions.forEach((s, id) => fn(id, s));
}
