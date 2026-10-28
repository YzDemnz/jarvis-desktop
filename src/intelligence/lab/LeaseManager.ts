/** Lab-only reference counting. A release is idempotent; disposal is serialized. */
export class LeaseManager {
  private count = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopping: Promise<void> = Promise.resolve();
  private starting: Promise<void> | null = null;
  lastShutdownError: unknown = null;
  private closed = false;
  constructor(private readonly start: () => Promise<void>, private readonly stop: () => Promise<void>, private readonly graceMs = 250) {}
  get leases(): number { return this.count; }
  async acquire(): Promise<() => void> {
    if (this.closed) throw new Error('Lease manager disposed');
    clearTimeout(this.timer); this.count++;
    try {
      if (!this.starting) this.starting = this.stopping.then(() => this.start()).finally(() => { this.starting = null; });
      await this.starting;
    }
    catch (e) { this.count--; if (!this.count) await this.stop(); throw e; }
    let released = false;
    return () => {
      if (released) return; released = true; this.count--;
      if (!this.count && !this.closed) this.timer = setTimeout(() => {
        if (!this.count) this.stopping = this.stop().catch(error => { this.lastShutdownError = error; });
      }, this.graceMs);
    };
  }
  async dispose(): Promise<void> { this.closed = true; clearTimeout(this.timer); await this.starting; await this.stopping; await this.stop(); }
}
