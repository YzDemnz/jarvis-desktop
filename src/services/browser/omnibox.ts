/**
 * Turns whatever the user typed into something navigable.
 * Lives in src/ so the renderer and the main process agree on the rules.
 */

export type OmniboxKind = 'url' | 'search' | 'command';

export interface OmniboxResult {
  kind: OmniboxKind;
  /** Ready to hand to loadURL when kind is 'url' or 'search'. */
  url: string;
  raw: string;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOCALHOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i;
const BARE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i;
const COMMAND_VERBS = /^(busca|analiza|abre|compara|encuentra|ejecuta|pregunta|resume|investiga|localiza)\b/i;

export const SEARCH_TEMPLATES: Record<string, string> = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  brave: 'https://search.brave.com/search?q=',
};

export function searchUrl(query: string, engine = 'duckduckgo'): string {
  const template = SEARCH_TEMPLATES[engine.toLowerCase()] ?? SEARCH_TEMPLATES.duckduckgo!;
  return template + encodeURIComponent(query);
}

/**
 * Order matters: an explicit scheme always wins, then anything that looks like
 * a host, then a verb that reads as an instruction, then plain search.
 */
export function normalizeInput(raw: string, engine = 'duckduckgo'): OmniboxResult {
  const value = raw.trim();
  if (!value) return { kind: 'search', url: searchUrl('', engine), raw };

  if (SCHEME.test(value) || /^(about|file|data):/i.test(value)) {
    return { kind: 'url', url: value, raw };
  }
  if (LOCALHOST.test(value)) {
    return { kind: 'url', url: `http://${value}`, raw };
  }
  if (!/\s/.test(value) && BARE_HOST.test(value)) {
    return { kind: 'url', url: `https://${value}`, raw };
  }

  const words = value.split(/\s+/).length;
  if (COMMAND_VERBS.test(value) || words > 3) {
    return { kind: 'command', url: searchUrl(value, engine), raw };
  }
  return { kind: 'search', url: searchUrl(value, engine), raw };
}

/** Short label for a URL, used before the real title arrives. */
export function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'about:') return 'Nueva pestaña';
    return parsed.hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
