import type { AdapterMap, ToolContext } from '../../src/agent/adapters/types';
import type { DevService } from '../../src/dev/DevService';
import type { FsPort } from '../../src/dev/ports';
import type { OpenProject } from '../../src/dev/ProjectService';
import type { SearchHit } from '../../src/types';
import type { CodeContext } from '../../src/dev/coding';
import { looksBinary } from '../../src/dev/classify';
import { isWithin, join } from '../../src/dev/paths';
import { safeContextText } from '../../src/fabric/ContinuityState';
import { SymbolMap, symbolContentHash, type SymbolFileInput, type SymbolLocation } from './SymbolMap';

const MAX_FILES = 48, MAX_BYTES = 1024 * 1024, MAX_FILE = 256 * 1024;
type Args = Record<string, unknown>;
interface ProjectSnapshot { map: SymbolMap; inputs: SymbolFileInput[]; revision: number; candidates: number; bytes: number; truncated: boolean }
const guardedContext = (ctx: ToolContext) => { ctx.token.throwIfCancelled(); if (ctx.signal.aborted) throw Error('SYMBOL_OPERATION_STOPPED'); };
const lexical = (hits: SearchHit[], reason: string) => hits.map(hit => ({ ...hit, source: 'LEXICAL' as const, limitation: reason }));

/** Main-only adapter enhancement. Never changes existing authorization/IPC channels. */
export class ProjectSymbols {
  private readonly cache = new Map<string, ProjectSnapshot>();
  constructor(private readonly dev: DevService, private readonly fs: FsPort) {}

  async snapshot(open: OpenProject, query: string, ctx: ToolContext, requested?: string, preferred: string[] = []): Promise<ProjectSnapshot> {
    guardedContext(ctx);
    const indexed = open.indexer.list(), words = safeContextText(query.slice(0, 256)).toLowerCase().match(/[\p{L}\p{N}_$]+/gu) ?? [];
    if (requested && !indexed.some(file => file.relativePath === requested)) throw Error('SYMBOL_FILE_NOT_INDEXED');
    const candidates = indexed.filter(file => !file.secret && !file.binary && file.size <= MAX_FILE && /\.(?:[cm]?[jt]sx?)$/i.test(file.relativePath))
      .sort((a, b) => Number(b.relativePath === requested) - Number(a.relativePath === requested)
        || Number(preferred.includes(b.relativePath)) - Number(preferred.includes(a.relativePath))
        || words.filter(word => b.relativePath.toLowerCase().includes(word)).length - words.filter(word => a.relativePath.toLowerCase().includes(word)).length
        || a.relativePath.localeCompare(b.relativePath));
    const inputs: SymbolFileInput[] = []; let bytes = 0;
    for (const entry of candidates) {
      if (inputs.length >= MAX_FILES) break;
      guardedContext(ctx);
      const absolute = join(this.fs.flavor, open.project.rootPath, ...entry.relativePath.split('/'));
      const permitted = await this.dev.guard.check(absolute, { write: false, base: open.project.rootPath });
      if (permitted.secret || !isWithin(open.project.rootPath, permitted.path, this.fs.flavor)) throw Error('SYMBOL_PROJECT_PATH_DENIED');
      guardedContext(ctx);
      const stat = await this.fs.stat(permitted.path);
      if (!stat.isFile || stat.size > MAX_FILE || bytes + stat.size > MAX_BYTES) continue;
      const raw = await this.fs.readFile(permitted.path); guardedContext(ctx);
      if (raw.length > MAX_FILE || bytes + raw.length > MAX_BYTES || looksBinary(raw)) continue;
      const content = new TextDecoder().decode(raw), sha256 = symbolContentHash(content);
      inputs.push({ file: entry.relativePath, content, sha256 }); bytes += raw.length;
    }
    guardedContext(ctx);
    const old = this.cache.get(open.project.id), hashes = Object.fromEntries(inputs.map(input => [input.file, input.sha256]));
    if (old?.revision === open.indexer.revision) {
      try { old.map.assertFresh(hashes); return { ...old, inputs, bytes, candidates: candidates.length, truncated: inputs.length < candidates.length }; } catch { /* Changed content invalidates even with equal mtime/size. */ }
    }
    const snapshot = { map: new SymbolMap(inputs), inputs, revision: open.indexer.revision, candidates: candidates.length, bytes, truncated: inputs.length < candidates.length };
    this.cache.set(open.project.id, snapshot);
    if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
    return snapshot;
  }
  private semantic(locations: SymbolLocation[], kind: SearchHit['kind'], snapshot: ProjectSnapshot) {
    return locations.map(location => ({ file: location.file, line: location.line, column: location.column, preview: safeContextText(snapshot.inputs.find(input => input.file === location.file)!.content.split(/\r?\n/)[location.line - 1] ?? '').trim().slice(0, 160), score: 20, kind,
      source: 'TYPESCRIPT_SYMBOL' as const, contentHash: location.sha256, snapshotHash: snapshot.map.snapshotHash, scope: 'BOUNDED_INDEXED_FILES', indexedRevision: snapshot.revision, selectedFiles: snapshot.inputs.length, truncated: snapshot.truncated }));
  }
  adapters(base: AdapterMap): AdapterMap {
    const result = { ...base };
    for (const [id, kind] of [['code.findDefinition', 'definition'], ['code.findReferences', 'reference']] as const) {
      result[id] = async (raw: never, ctx: ToolContext) => {
        const args = raw as Args, symbol = typeof args.symbol === 'string' ? args.symbol : '';
        if (!/^[A-Za-z_$][\w$]{0,120}$/.test(symbol)) throw Error('SYMBOL_NAME_INVALID');
        const requested = typeof args.file === 'string' ? args.file.replace(/\\/g, '/') : undefined;
        const open = await this.dev.projectFor(ctx.runId, args.project); guardedContext(ctx);
        const snapshot = await this.snapshot(open, symbol, ctx, requested);
        let definitions = snapshot.map.namedDefinitions(symbol), locations: SymbolLocation[] = [];
        if (requested && Number.isInteger(args.line) && Number.isInteger(args.column)) {
          const position = snapshot.map.position(requested, Number(args.line), Number(args.column));
          locations = kind === 'definition' ? snapshot.map.definitions(requested, position.offset, position.sha256) : snapshot.map.references(requested, position.offset, position.sha256);
        } else if (kind === 'definition') locations = definitions;
        else if (definitions.length === 1) {
          const definition = definitions[0]!; locations = snapshot.map.references(definition.file, definition.start, definition.sha256);
        }
        guardedContext(ctx);
        if (locations.length) return this.semantic(locations, kind, snapshot);
        const fallback = await base[id]!(raw, ctx); guardedContext(ctx);
        return lexical(fallback as SearchHit[], definitions.length > 1 ? 'AMBIGUOUS_NAME_REQUIRES_FILE_POSITION' : 'OUTSIDE_CLOSED_TYPESCRIPT_SNAPSHOT');
      };
    }
    result['code.context'] = async (raw: never, ctx: ToolContext) => {
      const args = raw as Args, open = await this.dev.projectFor(ctx.runId, args.project), indexed = open.indexer.list();
      const failures = Array.isArray(args.failures) ? args.failures.slice(0, 12) as { errors?: unknown[] }[] : [];
      const errors: CodeContext['errors'] = failures.flatMap(failure => Array.isArray(failure?.errors) ? failure.errors : []).slice(0, 40).flatMap(value => {
        if (!value || typeof value !== 'object') return [];
        const error = value as Record<string, unknown>; if (typeof error.message !== 'string') return [];
        return [{ message: safeContextText(error.message).slice(0, 400), ...(typeof error.file === 'string' ? { file: safeContextText(error.file).slice(0, 500) } : {}), ...(Number.isInteger(error.line) && Number(error.line) > 0 ? { line: Number(error.line) } : {}), ...(Number.isInteger(error.column) && Number(error.column) > 0 ? { column: Number(error.column) } : {}) }];
      });
      const known = (file: string) => indexed.find(entry => entry.relativePath === file.replace(/\\/g, '/') || file.replace(/\\/g, '/').endsWith('/' + entry.relativePath))?.relativePath;
      const preferred = [...new Set([...errors.map(error => error.file ? known(error.file) : undefined), ...(Array.isArray(args.recent) ? args.recent.slice(0, 20).filter((value): value is string => typeof value === 'string').map(known) : [])].filter((value): value is string => !!value))];
      const snapshot = await this.snapshot(open, String(args.query ?? ''), ctx, undefined, preferred);
      // Unsupported-language projects retain their pre-existing read path.
      // This is labelled lexical, never disguised as a full LSP capability.
      if (!snapshot.inputs.length) {
        const fallback = await base['code.context']!(raw, ctx) as CodeContext; guardedContext(ctx);
        for (const file of fallback.files) file.content = safeContextText(file.content);
        fallback.matches = lexical(fallback.matches, 'UNSUPPORTED_LANGUAGE_CONTEXT');
        return { ...fallback, repositoryMap: { source: 'LEXICAL', limitation: 'NO_TYPESCRIPT_FILES_SELECTED', text: '', chars: 0 } };
      }
      const repositoryMap = snapshot.map.repositoryMap(String(args.query ?? ''), 2400, 40);
      const context: CodeContext & { repositoryMap: Record<string, unknown> } = {
        project: { name: safeContextText(open.project.name), type: open.project.type, technologies: open.project.technologies, scripts: {} },
        files: [], matches: [], errors, excluded: indexed.filter(entry => entry.secret).slice(0, 100).map(entry => entry.relativePath), bytes: 0, approxTokens: 0,
        repositoryMap: { ...repositoryMap, source: 'TYPESCRIPT_SYMBOL', snapshotHash: snapshot.map.snapshotHash, indexedRevision: snapshot.revision, selectedFiles: snapshot.inputs.length, candidateFiles: snapshot.candidates, truncated: snapshot.truncated, compilerVersion: snapshot.map.compilerVersion },
      };
      const packageEntry = indexed.find(entry => entry.relativePath === 'package.json' && !entry.secret && entry.size <= MAX_FILE);
      if (packageEntry) {
        guardedContext(ctx);
        const permitted = await this.dev.guard.check('package.json', { write: false, base: open.project.rootPath });
        if (!permitted.secret && isWithin(open.project.rootPath, permitted.path, this.fs.flavor)) {
          const rawPackage = await this.fs.readFile(permitted.path); guardedContext(ctx);
          if (rawPackage.length <= MAX_FILE) try {
            const parsed = JSON.parse(new TextDecoder().decode(rawPackage)) as { scripts?: unknown };
            if (parsed.scripts && typeof parsed.scripts === 'object') context.project.scripts = Object.fromEntries(Object.entries(parsed.scripts).slice(0, 24).filter((entry): entry is [string, string] => typeof entry[1] === 'string').map(([name, value]) => [safeContextText(name).slice(0, 80), safeContextText(value).slice(0, 500)]));
          } catch { /* Malformed metadata grants no context/authority. */ }
        }
      }
      const contextInputs = [...snapshot.inputs];
      for (const preferredFile of preferred.slice(0, 12)) {
        if (contextInputs.some(input => input.file === preferredFile)) continue;
        const entry = indexed.find(file => file.relativePath === preferredFile);
        if (!entry || entry.secret || entry.binary || entry.size > MAX_FILE) continue;
        const permitted = await this.dev.guard.check(preferredFile, { write: false, base: open.project.rootPath });
        if (permitted.secret || !isWithin(open.project.rootPath, permitted.path, this.fs.flavor)) throw Error('SYMBOL_PROJECT_PATH_DENIED');
        const bytes = await this.fs.readFile(permitted.path); guardedContext(ctx);
        if (bytes.length > MAX_FILE || looksBinary(bytes)) continue;
        const content = new TextDecoder().decode(bytes);
        contextInputs.push({ file: preferredFile, content, sha256: symbolContentHash(content) });
      }
      const ordered = [...contextInputs].sort((a, b) => Number(preferred.includes(b.file)) - Number(preferred.includes(a.file)) || Number(repositoryMap.symbols.some(symbol => symbol.file === b.file)) - Number(repositoryMap.symbols.some(symbol => symbol.file === a.file)));
      for (const input of ordered) {
        if (context.files.length >= 12) break;
        const fileError = errors.find(error => error.file && known(error.file) === input.file), lines = input.content.split(/\r?\n/);
        const symbolLine = repositoryMap.symbols.find(symbol => symbol.file === input.file)?.line;
        const centre = fileError?.line ?? symbolLine ?? 1;
        let content = safeContextText(input.content), truncated = false;
        if (Buffer.byteLength(content) > 12 * 1024) {
          content = safeContextText(lines.slice(Math.max(0, centre - 41), Math.min(lines.length, centre + 40)).map((line, index) => `${Math.max(1, centre - 40) + index}: ${line}`).join('\n'));
          truncated = true;
        }
        if (Buffer.byteLength(content) > 12 * 1024) { content = Buffer.from(content).subarray(0, 12 * 1024).toString('utf8'); truncated = true; }
        const candidate = { path: input.file, reason: fileError ? 'aparece en un error' : preferred.includes(input.file) ? 'cambiado recientemente' : 'selección de símbolos TypeScript acotada', content, truncated };
        context.files.push(candidate);
        const size = () => Buffer.byteLength(JSON.stringify(context), 'utf8');
        if (size() > 48 * 1024 - 64) {
          const excess = size() - (48 * 1024 - 64); candidate.content = candidate.content.slice(0, Math.max(0, candidate.content.length - excess)); candidate.truncated = true;
          if (size() > 48 * 1024 - 64) context.files.pop();
        }
      }
      guardedContext(ctx);
      context.bytes = Buffer.byteLength(JSON.stringify(context)); context.approxTokens = Math.ceil(context.bytes / 4);
      if (Buffer.byteLength(JSON.stringify(context)) > 48 * 1024) throw Error('SYMBOL_CONTEXT_BUDGET');
      return context;
    };
    return result;
  }
}
