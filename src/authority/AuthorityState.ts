export type AccessMode = 'FULL' | 'RESTRICTED';
export type LinkScope = { kind: 'URL' | 'DOMAIN'; value: string };

const DESTINATIONS: Record<string, string> = { github: 'github.com', google: 'google.com', youtube: 'youtube.com', wikipedia: 'wikipedia.org', duckduckgo: 'duckduckgo.com' };
export function navigationUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
export function internalNavigation(raw: string): boolean {
  if (raw === 'about:blank') return true;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(raw).hostname); } catch { return false; }
}
/** Original user input only. URLs do not accidentally grant their whole domain. */
export function originalLinkScopes(text: string): LinkScope[] {
  let remaining = text.replace(/```[\s\S]*?```|^\s*>.*$/gm, ' ');
  const scopes: LinkScope[] = [];
  remaining = remaining.replace(/https?:\/\/[^\s<>"`]+/gi, token => {
    const normalized = navigationUrl(token.replace(/[),.;!?]+$/, ''));
    if (normalized) scopes.push({ kind: 'URL', value: normalized });
    return ' ';
  });
  for (const token of remaining.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,63}(?::\d{1,5})?(?:\/[^\s<>"`]*)?/gi) ?? []) {
    const target = navigationUrl(`https://${token.replace(/[),.;!?]+$/, '')}`);
    if (target) scopes.push(token.includes('/') ? { kind: 'URL', value: target } : { kind: 'DOMAIN', value: new URL(target).host });
  }
  for (const [name, host] of Object.entries(DESTINATIONS)) if (new RegExp(`\\b${name}\\b`, 'i').test(remaining)) {
    scopes.push({ kind: 'DOMAIN', value: host }, { kind: 'DOMAIN', value: `www.${host}` });
  }
  return scopes;
}
export function matchesLink(scopes: LinkScope[], raw: string): boolean {
  const normalized = navigationUrl(raw);
  if (!normalized) return raw === 'about:blank';
  if (internalNavigation(normalized)) return true;
  const host = new URL(normalized).host;
  return scopes.some(s => s.kind === 'URL' ? s.value === normalized : s.value === host);
}
export function originalStrongRequirement(text: string): boolean {
  const command = text.replace(/```[\s\S]*?```|^\s*>.*$/gm, ' ');
  return /(?:^|[.!?\n])\s*(?:requiere|exige|usa|usar|require|use|must use)\s+(?:solo\s+|only\s+)?(?:strong(?: isolation)?|aislamiento fuerte)\b/i.test(command);
}
export interface AuthorityRun { id: string; originalHash: string; source: 'USER_INPUT_GESTURE' | 'USER_UI_GESTURE'; strongRequired: boolean; links: LinkScope[]; stopped: boolean }
export class AuthorityState {
  private runs = new Map<string, AuthorityRun>();
  private epoch = 0;
  constructor(private mode: AccessMode = 'FULL') {}
  accessMode(): AccessMode { return this.mode; }
  /** Called only by the host's native user control; never from tool arguments. */
  userSetMode(mode: AccessMode): void {
    if (mode === this.mode) return;
    // Neither downgrade nor later upgrade can revive an old admission.
    this.liveRunIds().forEach(id => this.stop(id));
    this.mode = mode; this.epoch++;
  }
  revision(): number { return this.epoch; }
  admit(id: string, originalHash: string, originalText: string, source: AuthorityRun['source'] = 'USER_INPUT_GESTURE'): AuthorityRun {
    if (!id || id.length > 200 || this.runs.has(id)) throw new Error('AUTHORITY_RUN_ALREADY_EXISTS_OR_INVALID');
    const run: AuthorityRun = { id, originalHash, source, strongRequired: source === 'USER_INPUT_GESTURE' && originalStrongRequirement(originalText), links: source === 'USER_INPUT_GESTURE' ? originalLinkScopes(originalText) : [], stopped: false };
    this.runs.set(id, run); return structuredClone(run);
  }
  run(id: string): AuthorityRun | null { const run = this.runs.get(id); return run ? structuredClone(run) : null; }
  liveRunIds(): string[] { return [...this.runs.values()].filter(r => !r.stopped).map(r => r.id); }
  stop(id: string): void { const run = this.runs.get(id); if (run) run.stopped = true; }
  gate(id: string): void {
    const run = this.runs.get(id);
    if (!run) throw new Error('AUTHORITY_RUN_NOT_ADMITTED');
    if (run.stopped) throw new Error('AUTHORITY_RUN_STOPPED');
    // No production Strong backend is attested. Only this task fails closed.
    if (run.strongRequired) throw new Error('STRONG_REQUIRED_NO_ATTESTED_BACKEND');
  }
  grantLink(id: string, url: string): void { const run = this.runs.get(id); if (run) run.links.push({ kind: 'URL', value: url }); }
}
