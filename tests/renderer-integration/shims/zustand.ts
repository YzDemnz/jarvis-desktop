import { useSyncExternalStore } from 'react';

/**
 * Minimal stand-in for zustand, used ONLY by the renderer harness because the
 * real package cannot be installed in this container.
 *
 * It reproduces the library's contract, not the app's logic: every store in
 * src/stores runs unmodified on top of this. If the contract here drifts from
 * the real zustand, the harness would be testing a fiction — so it is kept
 * deliberately tiny and faithful: same call shapes, same selector semantics,
 * same getState/setState/subscribe surface.
 */
type Listener<T> = (state: T, prev: T) => void;

export interface StoreApi<T> {
  getState(): T;
  setState(partial: Partial<T> | ((s: T) => Partial<T>), replace?: boolean): void;
  subscribe(listener: Listener<T>): () => void;
}

export type StateCreator<T> = (
  set: StoreApi<T>['setState'],
  get: StoreApi<T>['getState'],
  api: StoreApi<T>,
) => T;

function createStore<T>(initializer: StateCreator<T>) {
  let state: T;
  const listeners = new Set<Listener<T>>();

  const setState: StoreApi<T>['setState'] = (partial, replace) => {
    const next = typeof partial === 'function' ? (partial as (s: T) => Partial<T>)(state) : partial;
    if (next === undefined || next === null) return;
    const prev = state;
    state = replace ? (next as T) : { ...state, ...next };
    if (state === prev) return;
    listeners.forEach((l) => l(state, prev));
  };

  const getState = () => state;
  const api: StoreApi<T> = { getState, setState, subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); } };
  state = initializer(setState, getState, api);
  return api;
}

export function create<T>(initializer?: StateCreator<T>) {
  if (!initializer) return (init: StateCreator<T>) => create<T>(init);
  const api = createStore<T>(initializer);

  const useBound = (selector?: (s: T) => unknown) =>
    useSyncExternalStore(
      (onChange) => api.subscribe(onChange),
      () => (selector ? selector(api.getState()) : api.getState()),
      () => (selector ? selector(api.getState()) : api.getState()),
    );

  return Object.assign(useBound, api);
}

export default create;
