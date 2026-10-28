import type { SessionState } from '@/types';
import type { WindowsAutomationAdapter } from './adapter';

/**
 * Tracks whether the interactive desktop is usable. A locked session or the
 * secure desktop (UAC, Ctrl+Alt+Del) means JARVIS keeps its hands off — it can
 * still think, it cannot touch.
 */
export class SessionStateService {
  private state: SessionState = 'UNKNOWN';
  private listeners = new Set<(s: SessionState) => void>();

  constructor(private adapter: WindowsAutomationAdapter) {}

  useAdapter(adapter: WindowsAutomationAdapter): void { this.adapter = adapter; }

  async refresh(): Promise<SessionState> {
    let next: SessionState;
    try {
      next = await this.adapter.sessionState();
    } catch {
      next = 'UNKNOWN';
    }
    if (next !== this.state) {
      this.state = next;
      this.listeners.forEach((l) => l(next));
    }
    return next;
  }

  current(): SessionState { return this.state; }

  /** Interactive control needs a known, active, non-secure desktop. */
  allowsInteraction(state: SessionState = this.state): boolean {
    return state === 'ACTIVE';
  }

  describe(state: SessionState = this.state): string | null {
    switch (state) {
      case 'LOCKED': return 'Windows está bloqueado. JARVIS no controla el equipo con la sesión bloqueada.';
      case 'SECURE_DESKTOP': return 'Windows requiere tu aprobación. Resuelve el aviso de seguridad y JARVIS podrá continuar.';
      case 'UNKNOWN': return 'No se pudo confirmar el estado de la sesión de Windows.';
      default: return null;
    }
  }

  subscribe(listener: (s: SessionState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
