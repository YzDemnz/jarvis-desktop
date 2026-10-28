/**
 * Cancellation token backed by a real AbortController, so adapters that speak
 * fetch/streams can pass `signal` straight through and adapters that cannot be
 * interrupted mid-flight can at least check `cancelled` at their boundaries.
 *
 * STOP AGENT aborts the token. Everything downstream is expected to either
 * observe the signal or refuse to start.
 */
export class CancellationToken {
  private readonly controller = new AbortController();
  private readonly callbacks = new Set<() => void>();
  private reasonText: string | null = null;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get cancelled(): boolean {
    return this.controller.signal.aborted;
  }

  get reason(): string | null {
    return this.reasonText;
  }

  cancel(reason = 'Cancelado por el usuario'): void {
    if (this.cancelled) return;
    this.reasonText = reason;
    this.controller.abort(reason);
    this.callbacks.forEach((cb) => {
      try {
        cb();
      } catch {
        // A misbehaving listener must not stop the rest from being notified.
      }
    });
    this.callbacks.clear();
  }

  onCancel(cb: () => void): () => void {
    if (this.cancelled) {
      cb();
      return () => {};
    }
    this.callbacks.add(cb);
    return () => { this.callbacks.delete(cb); };
  }

  /** Call at every await boundary inside a run. */
  throwIfCancelled(): void {
    if (this.cancelled) throw new CancelledError(this.reasonText ?? 'Cancelado');
  }
}

export class CancelledError extends Error {
  readonly cancelled = true;
  constructor(message = 'Cancelado') {
    super(message);
    this.name = 'CancelledError';
  }
}

export function isCancelledError(error: unknown): boolean {
  return error instanceof CancelledError || (error as { name?: string })?.name === 'AbortError';
}
