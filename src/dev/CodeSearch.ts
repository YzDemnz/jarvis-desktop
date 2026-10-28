import type { SearchHit } from '@/types';
import type { FsPort } from './ports';
import type { ProjectIndexer } from './ProjectIndexer';
import { join } from './paths';
import { LARGE_FILE_BYTES } from './classify';
import { fromUtf8 } from './hash';

const MAX_LINE = 2000;

/** Nested quantifiers are the classic catastrophic-backtracking shape. */
export function unsafeRegex(pattern: string): string | null {
  if (pattern.length > 200) return 'El patrón es demasiado largo.';
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return 'Patrón con cuantificadores anidados (riesgo de bloqueo).';
  try { new RegExp(pattern); } catch { return 'Expresión regular inválida.'; }
  return null;
}

const DEF_PATTERNS = (s: string): RegExp[] => {
  const e = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    new RegExp(`\\b(function|class|interface|type|enum|const|let|var)\\s+${e}\\b`),
    new RegExp(`\\bexport\\s+(default\\s+)?(async\\s+)?(function|class|interface|type|enum|const)\\s+${e}\\b`),
    new RegExp(`\\bdef\\s+${e}\\s*\\(`), new RegExp(`\\bclass\\s+${e}\\b`),
    new RegExp(`\\bfn\\s+${e}\\b`), new RegExp(`\\b(struct|enum|trait|impl)\\s+${e}\\b`),
    new RegExp(`\\bfunc\\s+(\\([^)]*\\)\\s*)?${e}\\s*\\(`),
    new RegExp(`\\b(public|private|protected|internal|static)\\b[^=;(]*\\b${e}\\s*[({]`),
    new RegExp(`^\\s*(async\\s+)?${e}\\s*\\([^)]*\\)\\s*\\{`),
  ];
};

/**
 * Search over the index — never a fresh walk of the disk. Binary and secret
 * files are never searched, very large files are skipped, and results carry
 * file, line, column, a trimmed preview and a relevance score.
 */
export class CodeSearch {
  private cache = new Map<string, { mtimeMs: number; lines: string[] }>();

  constructor(private readonly fs: FsPort, private readonly indexer: ProjectIndexer) {}

  private searchable() {
    return this.indexer.list().filter((f) => !f.binary && !f.secret && f.size <= LARGE_FILE_BYTES);
  }

  private async lines(rel: string, mtimeMs: number): Promise<string[]> {
    const hit = this.cache.get(rel);
    if (hit && hit.mtimeMs === mtimeMs) return hit.lines;
    const text = fromUtf8(await this.fs.readFile(join(this.fs.flavor, this.indexer.root, ...rel.split('/'))));
    const lines = text.split(/\r?\n/);
    this.cache.set(rel, { mtimeMs, lines });
    if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value!);
    return lines;
  }

  searchFiles(query: string, limit = 30): SearchHit[] {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return this.indexer.list().map((f) => {
      const p = f.relativePath.toLowerCase();
      const name = p.split('/').pop()!;
      let score = 0;
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (name.includes(q)) score = 60;
      else if (p.includes(q)) score = 40;
      else {
        let i = 0;
        for (const ch of p) if (ch === q[i]) i++;
        if (i === q.length) score = 15;
      }
      return { f, score: score ? score - Math.min(10, p.split('/').length) : 0 };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
      .map(({ f, score }) => ({ file: f.relativePath, line: 0, column: 0, preview: f.relativePath, score, kind: 'file' as const }));
  }

  /**
   * Hits are capped per file and later hits in the same file score lower, so
   * one noisy file (a generated table, a log) cannot crowd out the others.
   */
  private async scan(test: (line: string) => number, kind: SearchHit['kind'], limit: number, scoreOf: (file: string, line: string) => number, perFile = 20): Promise<SearchHit[]> {
    const out: SearchHit[] = [];
    for (const f of this.searchable()) {
      let lines: string[];
      try { lines = await this.lines(f.relativePath, f.mtimeMs); } catch { continue; }
      let inFile = 0;
      for (let i = 0; i < lines.length && inFile < perFile; i++) {
        const line = lines[i]!.length > MAX_LINE ? lines[i]!.slice(0, MAX_LINE) : lines[i]!;
        const col = test(line);
        if (col < 0) continue;
        out.push({ file: f.relativePath, line: i + 1, column: col + 1, preview: line.trim().slice(0, 160), score: scoreOf(f.relativePath, line) - inFile * 0.25, kind });
        inFile++;
      }
      if (out.length >= limit * 20) break;
    }
    return out.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line).slice(0, limit);
  }

  async searchText(query: string, opts: { regex?: boolean; caseSensitive?: boolean; limit?: number } = {}): Promise<SearchHit[]> {
    if (!query) return [];
    const limit = Math.min(200, opts.limit ?? 50);
    let test: (line: string) => number;
    if (opts.regex) {
      const bad = unsafeRegex(query);
      if (bad) throw new Error(bad);
      const re = new RegExp(query, opts.caseSensitive ? '' : 'i');
      test = (line) => line.search(re);
    } else {
      const q = opts.caseSensitive ? query : query.toLowerCase();
      test = (line) => (opts.caseSensitive ? line : line.toLowerCase()).indexOf(q);
    }
    return this.scan(test, 'text', limit, (file) => (/(^|\/)(src|lib|app)\//.test(file) ? 10 : 5) - (/test|spec/.test(file) ? 2 : 0));
  }

  async findReferences(symbol: string, limit = 100): Promise<SearchHit[]> {
    if (!/^[A-Za-z_$][\w$]{0,120}$/.test(symbol)) throw new Error('Símbolo inválido.');
    const re = new RegExp(`(?<![\\w$])${symbol.replace(/\$/g, '\\$')}(?![\\w$])`);
    return this.scan((line) => line.search(re), 'reference', limit, (file) => (/(^|\/)src\//.test(file) ? 10 : 5));
  }

  async findDefinition(symbol: string): Promise<SearchHit[]> {
    if (!/^[A-Za-z_$][\w$]{0,120}$/.test(symbol)) throw new Error('Símbolo inválido.');
    const patterns = DEF_PATTERNS(symbol);
    // The column points at the symbol itself, where an editor should put the caret.
    return this.scan((line) => {
      for (const re of patterns) { const i = line.search(re); if (i >= 0) return line.indexOf(symbol, i); }
      return -1;
    }, 'definition', 20, (_f, line) => (/\bexport\b/.test(line) ? 20 : 10), 5);
  }

  forget(rel: string): void { this.cache.delete(rel); }
}
