import { app, screen } from 'electron';
import os from 'node:os';
import path from 'node:path';
import type { DisplayInfo, OSIdentity } from '../../src/types';

const UNAVAILABLE = 'No disponible';

/**
 * JARVIS has no account. Identity is the operating-system profile that launched
 * the app, read locally and never sent anywhere.
 *
 * Nothing here touches a Microsoft account, a SID, a serial or any unique
 * hardware id. A value that cannot be read cleanly stays "No disponible"
 * instead of being invented.
 */
export class OSIdentityService {
  identity(): OSIdentity {
    const info = safe(() => os.userInfo(), null);
    const home = info?.homedir ?? safe(() => os.homedir(), '') ?? '';

    return {
      displayName: this.displayName(info?.username ?? null),
      username: info?.username ?? UNAVAILABLE,
      computerName: safe(() => os.hostname(), UNAVAILABLE) || UNAVAILABLE,
      homeDirectory: home || UNAVAILABLE,
      userDataDirectory: this.userDataDirectory(),
      platform: process.platform,
      architecture: process.arch,
    };
  }

  /**
   * Per-OS-user by construction: Electron's userData already sits inside the
   * profile of whoever launched it, so two Windows users never see each
   * other's config, workspaces, history or browser sessions.
   */
  userDataDirectory(): string {
    const fromApp = safe(() => app.getPath('userData'), null);
    if (fromApp) return fromApp;
    const home = safe(() => os.homedir(), null);
    return home ? path.join(home, '.jarvis-desktop') : UNAVAILABLE;
  }

  /**
   * A friendly name without asking an online account for it. Windows does not
   * expose the full name through a clean cross-platform API, so the username is
   * tidied up rather than a display name being fabricated.
   */
  private displayName(username: string | null): string {
    if (!username) return UNAVAILABLE;
    const cleaned = username.includes('\\') ? username.split('\\').pop()! : username;
    const spaced = cleaned.replace(/[._-]+/g, ' ').trim();
    if (!spaced) return UNAVAILABLE;
    return spaced
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  displays(): DisplayInfo[] {
    const all = safe(() => screen.getAllDisplays?.() ?? [], []);
    const primaryId = safe(() => screen.getPrimaryDisplay?.()?.id ?? null, null);
    return (all as { id?: number; size?: { width: number; height: number }; scaleFactor?: number }[])
      .map((d, index) => ({
        id: String(d.id ?? index),
        width: d.size?.width ?? 0,
        height: d.size?.height ?? 0,
        scaleFactor: d.scaleFactor ?? 1,
        primary: primaryId !== null ? d.id === primaryId : index === 0,
      }));
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export const osIdentityService = new OSIdentityService();
export { UNAVAILABLE };
