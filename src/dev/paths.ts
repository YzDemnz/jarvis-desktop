/**
 * Lexical path handling for both Windows and POSIX, without node:path, so the
 * same guards run in main and in the renderer harness. Canonicalisation
 * against the real disk (symlinks, junctions) happens in PathGuard.
 */
export type PathFlavor = 'win32' | 'posix';

export const sepOf = (f: PathFlavor) => (f === 'win32' ? '\\' : '/');

const WIN_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Characters and forms no legitimate project path needs. */
export function invalidReason(p: string, f: PathFlavor): string | null {
  if (!p || typeof p !== 'string') return 'Ruta vacía.';
  if (p.includes('\0')) return 'La ruta contiene un carácter nulo.';
  if (p.length > 4096) return 'Ruta demasiado larga.';
  if (f === 'win32') {
    if (/^\\\\[?.]\\/.test(p)) return 'Las rutas de dispositivo (\\\\?\\, \\\\.\\) no están permitidas.';
    if (/^\\\\|^\/\//.test(p)) return 'Las rutas de red (UNC) no están permitidas.';
    const body = p.replace(/^[a-zA-Z]:/, '');
    if (body.includes(':')) return 'Los flujos alternativos (archivo:flujo) no están permitidos.';
    for (const seg of body.split(/[\\/]/)) {
      if (!seg || seg === '.' || seg === '..') continue;
      if (WIN_DEVICE.test(seg)) return `«${seg}» es un nombre de dispositivo reservado de Windows.`;
      if (/[<>"|?*\x00-\x1f]/.test(seg)) return `«${seg}» contiene caracteres no válidos en Windows.`;
      if (/[. ]$/.test(seg)) return `«${seg}» termina en punto o espacio; Windows lo trataría como otra ruta.`;
    }
  }
  return null;
}

export function isAbsolute(p: string, f: PathFlavor): boolean {
  return f === 'win32' ? /^[a-zA-Z]:[\\/]/.test(p) : p.startsWith('/');
}

/** Resolves "." and ".." lexically. ".." never climbs above the root. */
export function normalize(p: string, f: PathFlavor): string {
  const sep = sepOf(f);
  let prefix = '';
  let rest = p;
  if (f === 'win32') {
    const m = p.match(/^([a-zA-Z]):/);
    if (m) { prefix = `${m[1]!.toUpperCase()}:`; rest = p.slice(2); }
  }
  const absolute = /^[\\/]/.test(rest);
  const out: string[] = [];
  for (const seg of rest.split(/[\\/]+/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (out.length) out.pop(); else if (!absolute) out.push('..'); continue; }
    out.push(seg);
  }
  const body = out.join(sep);
  return absolute ? `${prefix}${sep}${body}` : `${prefix}${body}` || '.';
}

export function join(f: PathFlavor, ...parts: string[]): string {
  return normalize(parts.filter(Boolean).join(sepOf(f)), f);
}

export function resolve(base: string, p: string, f: PathFlavor): string {
  return isAbsolute(p, f) ? normalize(p, f) : join(f, base, p);
}

export function dirname(p: string, f: PathFlavor): string {
  const n = normalize(p, f);
  const i = n.lastIndexOf(sepOf(f));
  if (i <= 0) return f === 'posix' ? '/' : n;
  if (f === 'win32' && i === 2) return n.slice(0, 3);
  return n.slice(0, i);
}

export function basename(p: string, f: PathFlavor): string {
  const n = normalize(p, f);
  return n.slice(n.lastIndexOf(sepOf(f)) + 1);
}

export function extname(p: string, f: PathFlavor): string {
  const b = basename(p, f);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i).toLowerCase() : '';
}

const cmp = (s: string, f: PathFlavor) => (f === 'win32' ? s.toLowerCase() : s);

/** True when target is root itself or strictly inside it. Case-insensitive on Windows. */
export function isWithin(root: string, target: string, f: PathFlavor): boolean {
  const r = cmp(normalize(root, f), f);
  const t = cmp(normalize(target, f), f);
  const sep = sepOf(f);
  if (t === r) return true;
  return t.startsWith(r.endsWith(sep) ? r : r + sep);
}

export function relative(root: string, target: string, f: PathFlavor): string {
  const r = normalize(root, f);
  const t = normalize(target, f);
  if (!isWithin(r, t, f)) return t;
  const rest = t.slice(r.length).replace(/^[\\/]+/, '');
  return rest.split(/[\\/]/).join('/') || '.';
}

/** Splits into [root, ...segments] for walking ancestors. */
export function ancestors(p: string, f: PathFlavor): string[] {
  const out: string[] = [];
  let cur = normalize(p, f);
  for (let i = 0; i < 256; i++) {
    out.push(cur);
    const parent = dirname(cur, f);
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}
