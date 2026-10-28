import { pathToFileURL } from 'node:url';

/** The shell is privileged by preload; it may only display its own app page. */
export function shellNavigationAllowed(url: string, appIndex: string, devUrl?: string): boolean {
  if (!devUrl) return url === pathToFileURL(appIndex).href;
  try { return new URL(url).origin === new URL(devUrl).origin; }
  catch { return false; }
}

/** OS protocol handlers and local files must never be reached from web popups. */
export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
