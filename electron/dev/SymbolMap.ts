import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { DEFAULT_IGNORED_DIRS, isSecretFile } from '../../src/dev/classify';
import { safeContextText } from '../../src/fabric/ContinuityState';

export interface SymbolFileInput { file: string; content: string; sha256: string }
export interface SymbolLocation { file: string; start: number; end: number; line: number; column: number; sha256: string }
export interface SymbolOutline extends SymbolLocation { name: string; kind: string; exported: boolean }
export const symbolContentHash = (text: string): string => createHash('sha256').update(text).digest('hex');
const ROOT = '/jarvis-owned-project';
const normalize = (file: string) => file.replace(/\\/g, '/');

/**
 * A bounded TypeScript snapshot of explicitly supplied project files, never a
 * disk crawler or executable compiler/plugin. Scope-aware definitions and
 * references refer only to this closed input set; external types/configuration
 * are deliberately unavailable. The existing project index remains owner.
 */
export class SymbolMap {
  readonly snapshotHash: string;
  readonly compilerVersion = ts.version;
  private readonly files = new Map<string, SymbolFileInput>();
  private readonly program: ts.Program;
  private readonly checker: ts.TypeChecker;
  private readonly outline: SymbolOutline[] = [];

  constructor(inputs: SymbolFileInput[]) {
    if (inputs.length > 128) throw Error('SYMBOL_FILE_BUDGET');
    let bytes = 0;
    for (const input of inputs) {
      const file = normalize(input.file);
      if (!file || /[\x00-\x1f\x7f]/.test(file) || safeContextText(file) !== file || path.posix.isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.split('/').some(s => !s || s === '.' || s === '..')
        || file.split('/').some(s => DEFAULT_IGNORED_DIRS.has(s)) || isSecretFile(path.posix.basename(file))) throw Error('SYMBOL_FILE_DENIED');
      if (!/\.(?:[cm]?[jt]sx?)$/i.test(file)) throw Error('SYMBOL_LANGUAGE_UNSUPPORTED');
      const length = Buffer.byteLength(input.content, 'utf8'); bytes += length;
      if (length > 256 * 1024 || bytes > 2 * 1024 * 1024) throw Error('SYMBOL_CONTENT_BUDGET');
      if (!/^[a-f0-9]{64}$/.test(input.sha256) || symbolContentHash(input.content) !== input.sha256) throw Error('SYMBOL_INPUT_HASH_MISMATCH');
      if (this.files.has(file)) throw Error('SYMBOL_DUPLICATE_FILE');
      this.files.set(file, { ...input, file });
    }
    const absolute = (file: string) => ROOT + '/' + file;
    const inputFor = (file: string) => normalize(file).startsWith(ROOT + '/') ? this.files.get(normalize(file).slice(ROOT.length + 1)) : undefined;
    const host: ts.CompilerHost = {
      getSourceFile: (file, languageVersion) => {
        const input = inputFor(file);
        return input ? ts.createSourceFile(file, input.content, languageVersion, true) : undefined;
      },
      getDefaultLibFileName: () => ROOT + '/unavailable-lib.d.ts', writeFile: () => { throw Error('SYMBOL_EMIT_FORBIDDEN'); },
      getCurrentDirectory: () => ROOT, getDirectories: () => [],
      getCanonicalFileName: file => file, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
      fileExists: file => !!inputFor(file), readFile: file => inputFor(file)?.content,
      resolveModuleNames: (names, containingFile) => names.map(name => {
        if (!name.startsWith('./') && !name.startsWith('../')) return undefined;
        const candidate = path.posix.resolve(path.posix.dirname(containingFile), name);
        if (!candidate.startsWith(ROOT + '/')) return undefined;
        for (const suffix of ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']) {
          const resolvedFileName = candidate + suffix;
          if (inputFor(resolvedFileName)) return { resolvedFileName, isExternalLibraryImport: false };
        }
        return undefined;
      }),
    };
    this.program = ts.createProgram([...this.files.keys()].map(absolute), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, noEmit: true, noLib: true, allowJs: true, checkJs: false, skipLibCheck: true }, host);
    this.checker = this.program.getTypeChecker();
    this.snapshotHash = symbolContentHash(JSON.stringify([...this.files].sort(([a], [b]) => a.localeCompare(b)).map(([file, input]) => ({ file, sha256: input.sha256 }))));
    for (const source of this.program.getSourceFiles()) for (const statement of source.statements) {
      const exported = ts.canHaveModifiers(statement) && !!ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
      if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) {
        if (statement.name) this.addOutline(statement.name, ts.SyntaxKind[statement.kind]!, exported);
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) this.addOutline(declaration.name, 'VariableDeclaration', exported);
      }
    }
  }

  private location(node: ts.Node): SymbolLocation {
    const source = node.getSourceFile(), file = source.fileName.slice(ROOT.length + 1), start = node.getStart(source), end = node.getEnd();
    const position = source.getLineAndCharacterOfPosition(start);
    return { file, start, end, line: position.line + 1, column: position.character + 1, sha256: this.files.get(file)!.sha256 };
  }
  private addOutline(name: ts.Identifier, kind: string, exported: boolean): void {
    if (safeContextText(name.text) !== name.text) return;
    this.outline.push({ ...this.location(name), name: name.text, kind, exported });
  }
  /** Caller provides the current index hashes; a changed/added/deleted file invalidates the whole semantic snapshot. */
  assertFresh(current: Record<string, string>): void {
    if (Object.keys(current).length !== this.files.size || [...this.files].some(([file, input]) => current[file] !== input.sha256)) throw Error('SYMBOL_SNAPSHOT_STALE');
  }
  private symbolAt(file: string, offset: number, expectedHash: string): ts.Symbol | null {
    file = normalize(file);
    const input = this.files.get(file);
    if (!input || input.sha256 !== expectedHash) throw Error('SYMBOL_SNAPSHOT_STALE');
    if (!Number.isInteger(offset) || offset < 0 || offset >= input.content.length) throw Error('SYMBOL_POSITION_INVALID');
    const source = this.program.getSourceFile(ROOT + '/' + file)!;
    let found: ts.Symbol | null = null;
    const visit = (node: ts.Node) => {
      if (offset < node.getStart(source) || offset >= node.getEnd()) return;
      if (ts.isIdentifier(node)) found = this.canonical(this.checker.getSymbolAtLocation(node)) ?? null;
      else ts.forEachChild(node, visit);
    };
    visit(source); return found;
  }
  private canonical(symbol: ts.Symbol | undefined): ts.Symbol | undefined {
    return symbol && symbol.flags & ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(symbol) : symbol;
  }
  definitions(file: string, offset: number, expectedHash: string): SymbolLocation[] {
    const symbol = this.symbolAt(file, offset, expectedHash);
    return (symbol?.getDeclarations() ?? []).filter(node => this.files.has(node.getSourceFile().fileName.slice(ROOT.length + 1)))
      .slice(0, 30).map(node => this.location('name' in node && (node as ts.NamedDeclaration).name ? (node as ts.NamedDeclaration).name! : node));
  }
  namedDefinitions(name: string, limit = 30): SymbolLocation[] {
    if (!/^[A-Za-z_$][\w$]{0,120}$/.test(name)) throw Error('SYMBOL_NAME_INVALID');
    return this.outline.filter(symbol => symbol.name === name).slice(0, Math.max(1, Math.min(30, limit)));
  }
  position(file: string, line: number, column: number): { offset: number; sha256: string } {
    const input = this.files.get(normalize(file)); if (!input) throw Error('SYMBOL_FILE_NOT_SELECTED');
    const source = this.program.getSourceFile(ROOT + '/' + normalize(file))!;
    if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) throw Error('SYMBOL_POSITION_INVALID');
    const starts = source.getLineStarts(); if (line > starts.length) throw Error('SYMBOL_POSITION_INVALID');
    const offset = starts[line - 1]! + column - 1;
    if (offset >= (starts[line] ?? input.content.length)) throw Error('SYMBOL_POSITION_INVALID');
    return { offset, sha256: input.sha256 };
  }
  references(file: string, offset: number, expectedHash: string, limit = 100): SymbolLocation[] {
    const symbol = this.symbolAt(file, offset, expectedHash); if (!symbol) return [];
    const result: SymbolLocation[] = [], ceiling = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 100;
    const visit = (node: ts.Node) => {
      if (result.length >= ceiling) return;
      if (ts.isIdentifier(node) && this.canonical(this.checker.getSymbolAtLocation(node)) === symbol) result.push(this.location(node));
      ts.forEachChild(node, visit);
    };
    for (const source of this.program.getSourceFiles()) visit(source);
    return result;
  }
  repositoryMap(query: string, maxChars = 2400, maxSymbols = 40): { symbols: SymbolOutline[]; text: string; chars: number; omitted: number; source: 'TYPESCRIPT_CLOSED_SNAPSHOT' } {
    const budget = Number.isFinite(maxChars) ? Math.max(0, Math.min(8000, Math.floor(maxChars))) : 2400, count = Number.isFinite(maxSymbols) ? Math.max(0, Math.min(100, Math.floor(maxSymbols))) : 40;
    const words = safeContextText(query.slice(0, 256)).toLowerCase().match(/[\p{L}\p{N}_$]+/gu)?.slice(0, 12) ?? [];
    const ranked = [...this.outline].sort((a, b) => words.filter(w => b.name.toLowerCase().includes(w)).length - words.filter(w => a.name.toLowerCase().includes(w)).length || Number(b.exported) - Number(a.exported) || a.file.localeCompare(b.file) || a.line - b.line);
    const symbols: SymbolOutline[] = [], lines: string[] = [];
    for (const symbol of ranked) {
      if (symbols.length >= count) break;
      const line = safeContextText(`${symbol.file}:${symbol.line}:${symbol.column} ${symbol.exported ? 'export ' : ''}${symbol.kind} ${symbol.name}`);
      if (lines.join('\n').length + (lines.length ? 1 : 0) + line.length > budget) continue;
      symbols.push(symbol); lines.push(line);
    }
    const text = lines.join('\n');
    return { symbols, text, chars: text.length, omitted: ranked.length - symbols.length, source: 'TYPESCRIPT_CLOSED_SNAPSHOT' };
  }
}
