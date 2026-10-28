import type { InputLimits } from '@/types';

export const DEFAULT_INPUT_LIMITS: InputLimits = {
  mouseActionsPerSecond: 8,
  keyEventsPerSecond: 40,
  maxTextLength: 2000,
  maxDragDurationMs: 5000,
  maxScrollAmount: 20,
  maxHotkeyKeys: 4,
};

/**
 * Sliding one-second window. A runaway agent that tries ten thousand clicks
 * gets refused at the ninth, not after the damage.
 */
export class SlidingWindowLimiter {
  private stamps: number[] = [];
  constructor(private limit: number, private readonly windowMs = 1000, private readonly now = () => Date.now()) {}

  setLimit(limit: number): void { this.limit = limit; }

  /** Consumes `cost` slots, or refuses without consuming any. */
  tryTake(cost = 1): boolean {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
    if (this.stamps.length + cost > this.limit) return false;
    for (let i = 0; i < cost; i++) this.stamps.push(t);
    return true;
  }

  reset(): void { this.stamps = []; }
}
