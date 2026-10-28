/**
 * A small .gitignore matcher: enough for the patterns real projects use
 * (dir/, *.ext, /anchored, **\/x, !negation). Paths are relative with "/".
 */
export class IgnoreMatcher {
  private rules: { re: RegExp; negate: boolean; dirOnly: boolean }[] = [];

  add(text: string): void {
    for (const raw of text.split(/\r?\n/)) {
      let line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const negate = line.startsWith('!');
      if (negate) line = line.slice(1);
      const dirOnly = line.endsWith('/');
      if (dirOnly) line = line.slice(0, -1);
      const anchored = line.startsWith('/') || line.slice(0, -1).includes('/');
      line = line.replace(/^\//, '');
      const body = line.split('**').map((part) => part.split('*').map((s) => s.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('[^/]*')).join('.*');
      const re = new RegExp(anchored ? `^${body}(/.*)?$` : `(^|/)${body}(/.*)?$`);
      this.rules.push({ re, negate, dirOnly });
    }
  }

  ignores(relPath: string, isDir: boolean): boolean {
    let ignored = false;
    for (const r of this.rules) {
      if (r.dirOnly && !isDir && !r.re.test(relPath.split('/').slice(0, -1).join('/'))) continue;
      if (r.re.test(relPath)) ignored = !r.negate;
    }
    return ignored;
  }
}
