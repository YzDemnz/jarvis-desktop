/// <reference types="vite/client" />
import type { JarvisBridge } from '../electron/preload';

declare global {
  interface Window {
    jarvis?: JarvisBridge;
  }
}

export {};
