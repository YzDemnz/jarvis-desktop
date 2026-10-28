/**
 * When the user grabs the mouse or starts typing while JARVIS is driving, the
 * agent must yield at once — no fight over the cursor.
 *
 * Telling physical input from our own synthetic input reliably needs a
 * low-level hook in the native helper (LLMHF_INJECTED / LLKHF_INJECTED flags).
 * That source exists; it is not validated on real Windows. This interface is
 * what the rest of the app depends on, so the detection strategy can change
 * without touching the control flow.
 */
export interface HumanInputSource {
  /** Called with a human input event. Synthetic events must never reach it. */
  subscribe(listener: (event: HumanInputEvent) => void): () => void;
  start(): Promise<boolean>;
  stop(): void;
}

export interface HumanInputEvent {
  kind: 'mouse' | 'keyboard';
  at: number;
}

export class HumanOverrideDetector {
  private listeners = new Set<(e: HumanInputEvent) => void>();
  private unsubscribe: (() => void) | null = null;
  private armed = false;
  private lastSyntheticAt = 0;

  /**
   * Events within this window after our own input are ignored. This is a
   * backstop for sources that cannot flag injected input, not the primary
   * mechanism.
   */
  constructor(private source: HumanInputSource | null, private readonly graceMs = 60) {}

  useSource(source: HumanInputSource | null): void {
    this.disarm();
    this.source = source;
  }

  get supported(): boolean { return this.source !== null; }

  async arm(): Promise<boolean> {
    if (this.armed || !this.source) return this.armed;
    const ok = await this.source.start().catch(() => false);
    if (!ok) return false;
    this.unsubscribe = this.source.subscribe((event) => {
      if (event.at - this.lastSyntheticAt < this.graceMs) return;
      this.listeners.forEach((l) => l(event));
    });
    this.armed = true;
    return true;
  }

  disarm(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.source?.stop();
    this.armed = false;
  }

  /** Every synthetic input marks itself so it is never mistaken for the user. */
  markSynthetic(at = Date.now()): void {
    this.lastSyntheticAt = at;
  }

  onHumanInput(listener: (e: HumanInputEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

/** Test and harness source: emits whatever it is told to. */
export class ManualHumanInputSource implements HumanInputSource {
  private listeners = new Set<(e: HumanInputEvent) => void>();
  started = false;
  subscribe(listener: (e: HumanInputEvent) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  async start() { this.started = true; return true; }
  stop() { this.started = false; }
  emit(kind: HumanInputEvent['kind'], at = Date.now()) {
    if (!this.started) return;
    this.listeners.forEach((l) => l({ kind, at }));
  }
}
