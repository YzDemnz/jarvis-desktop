import type { StateCreator } from './zustand';

interface PersistOptions<T> {
  name: string;
  partialize?: (state: T) => unknown;
  version?: number;
  storage?: unknown;
}

/**
 * Harness-only `persist`. Reads once on creation and writes on every change,
 * against the real localStorage of the Chromium page, so the stores exercise
 * the same rehydration path they do in production.
 */
export function persist<T>(config: StateCreator<T>, options: PersistOptions<T>): StateCreator<T> {
  return (set, get, api) => {
    const write = () => {
      try {
        const snapshot = options.partialize ? options.partialize(get()) : get();
        localStorage.setItem(options.name, JSON.stringify({ state: snapshot, version: options.version ?? 0 }));
      } catch {
        // A full or blocked storage must never break the store.
      }
    };

    const wrappedSet: typeof set = (partial, replace) => {
      set(partial, replace);
      write();
    };

    const initial = config(wrappedSet, get, api);

    let restored: Partial<T> = {};
    try {
      const raw = localStorage.getItem(options.name);
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: unknown };
        // Corrupt or foreign payloads are ignored rather than merged blindly.
        if (parsed && typeof parsed.state === 'object' && parsed.state !== null && !Array.isArray(parsed.state)) {
          restored = parsed.state as Partial<T>;
        }
      }
    } catch {
      restored = {};
    }

    return { ...initial, ...restored };
  };
}

export function createJSONStorage(getter: () => unknown): unknown {
  return getter();
}
