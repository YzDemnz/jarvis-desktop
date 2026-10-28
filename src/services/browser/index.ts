import type { BrowserService } from '@/types';
import { ElectronBrowserService } from './ElectronBrowserService';
import { MockBrowserService } from './MockBrowserService';

export { normalizeInput, titleFromUrl, searchUrl, originOf } from './omnibox';
export type { OmniboxKind, OmniboxResult } from './omnibox';

/**
 * One decision, made once: if the Electron bridge is present we drive real
 * Chromium; otherwise the UI runs against the mock. Nothing above this line
 * knows which one it got.
 */
function resolve(): { service: BrowserService; engine: 'chromium' | 'mock' } {
  const bridge = typeof window !== 'undefined' ? window.jarvis?.browser : undefined;
  if (bridge) return { service: new ElectronBrowserService(bridge), engine: 'chromium' };
  return { service: new MockBrowserService(), engine: 'mock' };
}

const resolved = resolve();

export const browserService: BrowserService = resolved.service;
export const browserEngine = resolved.engine;
export const hasRealBrowser = resolved.engine === 'chromium';
