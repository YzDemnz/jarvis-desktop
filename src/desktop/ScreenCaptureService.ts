import type { Bounds, ScreenCaptureResult } from '@/types';
import type { CaptureBytes, WindowsAutomationAdapter } from './adapter';
import { uid } from '@/lib/id';

interface Held { meta: ScreenCaptureResult; data: string }

/**
 * Captures live in memory only, with a short TTL, and are dropped the moment
 * they are consumed or expire. Nothing touches disk by default, and the image
 * itself never reaches the audit log — only its dimensions.
 */
export class ScreenCaptureService {
  private held = new Map<string, Held>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(private adapter: WindowsAutomationAdapter, private readonly ttlMs = 60_000, private readonly now = () => Date.now()) {}
  useAdapter(adapter: WindowsAutomationAdapter): void { this.adapter = adapter; }

  private hold(kind: ScreenCaptureResult['kind'], bytes: CaptureBytes): ScreenCaptureResult {
    this.sweep();
    const created = this.now();
    const meta: ScreenCaptureResult = {
      captureId: uid('cap'), kind, width: bytes.width, height: bytes.height,
      mimeType: 'image/png', createdAt: created, expiresAt: created + this.ttlMs,
    };
    this.held.set(meta.captureId, { meta, data: bytes.data });
    return meta;
  }

  async captureDisplay(monitor = 0) { return this.hold('display', await this.adapter.captureDisplay(monitor)); }
  async captureWindow(windowId: string) { return this.hold('window', await this.adapter.captureWindow(windowId)); }

  async captureRegion(bounds: Bounds) {
    if (bounds.width <= 0 || bounds.height <= 0 || bounds.width > 16384 || bounds.height > 16384) {
      throw new Error('Región de captura inválida.');
    }
    return this.hold('region', await this.adapter.captureRegion(bounds));
  }

  /** Hands the pixels to exactly one consumer and forgets them. */
  consume(captureId: string): string | null {
    this.sweep();
    const entry = this.held.get(captureId);
    if (!entry) return null;
    this.held.delete(captureId);
    return entry.data;
  }

  sweep(): number {
    const t = this.now();
    let removed = 0;
    for (const [id, entry] of this.held) {
      if (entry.meta.expiresAt <= t) { this.held.delete(id); removed += 1; }
    }
    return removed;
  }

  dispose(): void {
    this.held.clear();
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  heldCount(): number { return this.held.size; }
}
