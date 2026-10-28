import { setTimeout as delay } from 'node:timers/promises';

export async function waitForCursorStable(read: () => Promise<{ x: number; y: number }>,
  timeoutMs: number, samples: number, intervalMs: number, tolerancePx: number): Promise<{ x: number; y: number }> {
  if (timeoutMs <= 0 || samples < 2 || intervalMs <= 0 || tolerancePx < 0) throw new Error('CURSOR_STABILITY_ARGUMENT_INVALID');
  const until = Date.now() + timeoutMs;
  let prior = await read(); let consecutive = 1;
  const recent = [prior];
  while (Date.now() < until) {
    await delay(intervalMs);
    const current = await read();
    recent.push(current); if (recent.length > 12) recent.shift();
    if (Math.abs(current.x - prior.x) <= tolerancePx && Math.abs(current.y - prior.y) <= tolerancePx) consecutive++;
    else consecutive = 1;
    if (consecutive >= samples) return current;
    prior = current;
  }
  throw new Error(`CURSOR_STABILITY_TIMEOUT:${JSON.stringify(recent)}`);
}
