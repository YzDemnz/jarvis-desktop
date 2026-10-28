import { useEffect, useState } from 'react';

/** Re-renders on an interval. Used for live clocks and drifting mock prices. */
export function useTicker(ms = 1000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return tick;
}
