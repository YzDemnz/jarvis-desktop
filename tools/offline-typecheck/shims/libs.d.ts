declare module 'zustand' {
  export type StateCreator<T> = (
    set: (partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean) => void,
    get: () => T,
    api: any,
  ) => T;
  export interface UseBoundStore<T> {
    (): T;
    <U>(selector: (state: T) => U): U;
    getState(): T;
    setState(partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean): void;
    subscribe(listener: (state: T, prev: T) => void): () => void;
  }
  export function create<T>(): (initializer: StateCreator<T>) => UseBoundStore<T>;
  export function create<T>(initializer: StateCreator<T>): UseBoundStore<T>;
}
declare module 'zustand/middleware' {
  import type { StateCreator } from 'zustand';
  export function persist<T>(
    config: StateCreator<T>,
    options: { name: string; partialize?: (s: T) => any; version?: number; storage?: any },
  ): StateCreator<T>;
  export function createJSONStorage(getter: () => any): any;
}
declare module 'framer-motion' {
  import type { CommonDOMProps } from 'react';
  export interface MotionComponents {
    aside: (props: CommonDOMProps) => any;
    button: (props: CommonDOMProps) => any;
    circle: (props: CommonDOMProps) => any;
    div: (props: CommonDOMProps) => any;
    span: (props: CommonDOMProps) => any;
  }
  export const motion: MotionComponents;
  export const AnimatePresence: any;
  export const useReducedMotion: () => boolean;
  export type Variants = any;
  export type Transition = any;
}

declare module '*.css';
declare module '*.svg' { const src: string; export default src }
declare module '*.png' { const src: string; export default src }
