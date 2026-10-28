import type { DevProject, IndexedFile, PatchOp, SearchHit, ToolResult, VerificationCheck, VerificationFailure } from '@/types';
import type { FsPort } from './ports';
import type { ProjectIndexer } from './ProjectIndexer';
import type { CodeSearch } from './CodeSearch';
import type { DelegateExecutor } from '@/agent/AgentRuntime';
import { join } from './paths';
import { fromUtf8 } from './hash';
import {checkInput} from './checkInputs';

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

export interface ContextFile { path: string; reason: string; content: string; truncated: boolean }
export interface CodeContext {
  project: { name: string; type: string; technologies: string[]; scripts: Record<string, string> };
  files: ContextFile[];
  matches: SearchHit[];
  errors: VerificationFailure['errors'];
  excluded: string[];
  bytes: number;
  approxTokens: number;
  /** Main-generated raw windows, ranges and full-file hashes. Never an authority source. */
  proposalText?: string;
}

export interface ContextLimits { maxBytes: number; maxFiles: number; maxBytesPerFile: number; windowLines: number }
export const DEFAULT_CONTEXT_LIMITS: ContextLimits = { maxBytes: 48 * 1024, maxFiles: 12, maxBytesPerFile: 12 * 1024, windowLines: 40 };

const STOP = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'que', 'en', 'y', 'por', 'para', 'con', 'un', 'una', 'mi', 'corrige', 'arregla', 'error', 'falla', 'the', 'fix', 'and', 'why', 'build', 'proyecto', 'encuentra']);
export const keywordsOf = (text: string): string[] =>
  [...new Set(text.split(/[^\p{L}\p{N}_$]+/u).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase())))].slice(0, 6);

/**
 * Chooses what the model sees — never the whole project. Priority: files named
 * in errors, recently changed files, search matches, then name matches; each
 * file trimmed to a window around the interesting lines; the total held under
 * a byte budget (~tokens/4). Secret and binary files are excluded by default:
 * the model can learn they exist, not what they contain.
 */
export class CodeContextBuilder {
  constructor(private readonly fs: FsPort, private readonly indexer: ProjectIndexer, private readonly search: CodeSearch, private readonly limits: ContextLimits = DEFAULT_CONTEXT_LIMITS) {}

  async build(input: { project: DevProject; query: string; failures?: VerificationFailure[]; recent?: string[] }): Promise<CodeContext> {
    const errors = (input.failures ?? []).flatMap((f) => f.errors).slice(0, 40);
    // Error lines outrank search-match lines: a file named in an error is cut
    // around the error, never around unrelated mentions.
    const focus = new Map<string, { reason: string; errorLines: number[]; matchLines: number[] }>();
    const add = (path: string, reason: string, line?: number, isError = false) => {
      const cur = focus.get(path) ?? { reason, errorLines: [], matchLines: [] };
      if (line) (isError ? cur.errorLines : cur.matchLines).push(line);
      focus.set(path, cur);
    };
    const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');
    const known = (p: string) => this.indexer.list().find((f) => f.relativePath === norm(p) || norm(p).endsWith(`/${f.relativePath}`));
    for (const e of errors) { const f = e.file ? known(e.file) : undefined; if (f) add(f.relativePath, 'aparece en un error', e.line, true); }
    for (const r of input.recent ?? []) { const f = known(r); if (f) add(f.relativePath, 'cambiado recientemente'); }
    const matches: SearchHit[] = [];
    for (const kw of keywordsOf(input.query)) {
      const hits = [...(await this.search.findDefinition(kw).catch(() => [])), ...(await this.search.searchText(kw, { limit: 8 }).catch(() => []))];
      for (const h of hits) { matches.push(h); add(h.file, h.kind === 'definition' ? `define ${kw}` : `menciona ${kw}`, h.line); }
      for (const h of this.search.searchFiles(kw, 3)) add(h.file, `nombre coincide con ${kw}`);
    }

    // A failing test without a file/line in its output often names only the
    // test runner. On small projects, include nearby source candidates too;
    // otherwise a model sees just test.js and may try to edit the test itself.
    const indexed = this.indexer.list();
    if (focus.size < 3 && indexed.length <= 25) {
      const candidates = indexed
        .filter((f) => !f.secret && !f.binary && /\.(?:[cm]?[jt]sx?|py|rs|go|cs|java)$/i.test(f.relativePath))
        .sort((a, b) => Number(/(?:^|\/)(?:test|spec)[^/]*\./i.test(a.relativePath)) - Number(/(?:^|\/)(?:test|spec)[^/]*\./i.test(b.relativePath)) || a.relativePath.localeCompare(b.relativePath));
      for (const f of candidates.slice(0, 8)) if (!focus.has(f.relativePath)) add(f.relativePath, 'candidato de código fuente');
    }

    const excluded: string[] = [];
    const files: ContextFile[] = [];
    let bytes = 0;
    for (const [rel, info] of focus) {
      if (files.length >= this.limits.maxFiles || bytes >= this.limits.maxBytes) break;
      const entry: IndexedFile | undefined = this.indexer.get(rel);
      if (!entry) continue;
      if (entry.secret || entry.binary) { excluded.push(rel); continue; }
      let text: string;
      try { text = fromUtf8(await this.fs.readFile(join(this.fs.flavor, this.indexer.root, ...rel.split('/')))); } catch { continue; }
      let content = text, truncated = false;
      if (text.length > this.limits.maxBytesPerFile) {
        const lines = text.split('\n');
        const centres = (info.errorLines.length ? info.errorLines : info.matchLines.slice(0, 5)).slice(0, 8);
        if (!centres.length) centres.push(1);
        const keep = new Set<number>();
        for (const c of centres) for (let i = Math.max(1, c - this.limits.windowLines); i <= Math.min(lines.length, c + this.limits.windowLines); i++) keep.add(i);
        content = [...keep].sort((a, b) => a - b).map((n) => `${n}: ${lines[n - 1]}`).join('\n').slice(0, this.limits.maxBytesPerFile);
        truncated = true;
      }
      const room = this.limits.maxBytes - bytes;
      if (content.length > room) { content = content.slice(0, room); truncated = true; }
      files.push({ path: rel, reason: info.reason, content, truncated });
      bytes += content.length;
    }
    for (const f of this.indexer.list()) if (f.secret && !excluded.includes(f.relativePath)) excluded.push(f.relativePath);

    let scripts: Record<string, string> = {};
    try {
      const pkg = JSON.parse(fromUtf8(await this.fs.readFile(join(this.fs.flavor, this.indexer.root, 'package.json')))) as { scripts?: Record<string, string> };
      scripts = pkg.scripts ?? {};
    } catch { /* not a node project */ }
    return {
      project: { name: input.project.name, type: input.project.type, technologies: input.project.technologies, scripts },
      files, matches: matches.slice(0, 30), errors, excluded, bytes, approxTokens: Math.ceil(bytes / 4),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

/**
 * Which signals exist for this project — nothing is assumed. The order is the
 * cheap-to-expensive one: types, lint, build, tests.
 */
export function detectChecks(project: Pick<DevProject, 'technologies'>, scripts: Record<string, string>, available: (tool: string) => boolean): VerificationCheck[] {
  const checks: VerificationCheck[] = [];
  const t = new Set(project.technologies);
  if (t.has('node') && available('npm')) {
    const pick = (...names: string[]) => names.find((n) => scripts[n]);
    const tc = pick('typecheck', 'type-check', 'tsc', 'check-types');
    if (tc) checks.push({ id: 'typecheck', label: 'TypeScript', request: { executable: 'npm', args: ['run', tc] } });
    else if (t.has('typescript')) checks.push({ id: 'typecheck', label: 'TypeScript', request: { executable: 'npx', args: ['--no-install', 'tsc', '--noEmit'] } });
    const lint = pick('lint');
    if (lint) checks.push({ id: 'lint', label: 'Lint', request: { executable: 'npm', args: ['run', lint] } });
    const build = pick('build');
    if (build) checks.push({ id: 'build', label: 'Build', request: { executable: 'npm', args: ['run', build] } });
    if (scripts.test && !/no test specified/.test(scripts.test)) checks.push({ id: 'test', label: 'Pruebas', request: { executable: 'npm', args: ['test'] } });
  }
  const py = available('python3') ? 'python3' : available('python') ? 'python' : null;
  if (t.has('python') && py) {
    checks.push({ id: 'compile', label: 'Sintaxis Python', request: { executable: py, args: ['-m', 'compileall', '-q', '.'] } });
    checks.push({ id: 'test', label: 'Pruebas (pytest)', request: { executable: py, args: ['-m', 'pytest', '-q'] } });
  }
  if (t.has('rust') && available('cargo')) checks.push({ id: 'check', label: 'cargo check', request: { executable: 'cargo', args: ['check'] } }, { id: 'test', label: 'cargo test', request: { executable: 'cargo', args: ['test'] } });
  if (t.has('go') && available('go')) checks.push({ id: 'build', label: 'go build', request: { executable: 'go', args: ['build', './...'] } }, { id: 'test', label: 'go test', request: { executable: 'go', args: ['test', './...'] } });
  if (t.has('dotnet') && available('dotnet')) checks.push({ id: 'build', label: 'dotnet build', request: { executable: 'dotnet', args: ['build'] } });
  return checks;
}

/** Extracts actionable errors: tsc, "file:line:col", Python tracebacks, test summaries. */
export function parseFailures(check: string, exitCode: number | null, output: string): VerificationFailure {
  const errors: VerificationFailure['errors'] = [];
  const seen = new Set<string>();
  const push = (e: VerificationFailure['errors'][number]) => { const k = JSON.stringify(e); if (!seen.has(k) && errors.length < 50) { seen.add(k); errors.push(e); } };
  for (const line of output.split('\n')) {
    let m = line.match(/^\s*([^\s(][^(]*?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+:.*)$/);
    if (m) { push({ file: m[1]!.trim(), line: +m[2]!, column: +m[3]!, message: m[5]!.trim() }); continue; }
    m = line.match(/^\s*([\w./\\-]+\.[a-z]{1,5}):(\d+):(\d+)\s*[-:]\s*(error\b.*|.*[Ee]rror.*)$/);
    if (m) { push({ file: m[1]!, line: +m[2]!, column: +m[3]!, message: m[4]!.trim() }); continue; }
    m = line.match(/^\s*File "([^"]+)", line (\d+)/);
    if (m) { push({ file: m[1]!, line: +m[2]!, message: 'Traceback de Python' }); continue; }
    m = line.match(/^\s*at\s+.*?\((.+?\.(?:[cm]?[jt]sx?|py|rs|go|cs|java)):(\d+):(\d+)\)\s*$/);
    if (m) { push({file: m[1]!, line: +m[2]!, column: +m[3]!, message: 'Punto del fallo en el stack del runner'}); continue; }
    m = line.match(/^\s*(✗|✖|×|FAIL|not ok)\s+(.+)$/);
    if (m) push({ message: m[2]!.trim().slice(0, 200) });
  }
  const lines = output.trim().split('\n');
  return { check, exitCode, errors, excerpt: lines.slice(-25).join('\n').slice(-3000) };
}

/* ------------------------------------------------------------------ */
/* Proposals                                                           */
/* ------------------------------------------------------------------ */

export interface ProposedEdit { path: string; ops: PatchOp[]; expectedHash?: string }
export interface ProposalInput { goal: string; context: CodeContext; failures: VerificationFailure[]; attempt: number }

/** Where patches come from. The proposer never writes: the loop applies them through the broker. */
export interface PatchProposer {
  identity?: () => {providerId: string; model: string | null} | null;
  readonly available: boolean;
  propose(input: ProposalInput): Promise<{ edits: ProposedEdit[]; rationale: string } | null>;
}

/** No model configured: the loop still understands and verifies, but proposes nothing. */
export const noProposer: PatchProposer = { available: false, propose: async () => null };

/** Deterministic proposals for tests and the harness. */
export class ScriptedProposer implements PatchProposer {
  readonly available = true;
  calls = 0;
  constructor(private readonly script: (input: ProposalInput) => { edits: ProposedEdit[]; rationale: string } | null) {}
  async propose(input: ProposalInput) { this.calls++; return this.script(input); }
}

/**
 * Asks a model (local, through LocalAIManager) for edits as strict JSON and
 * validates them: relative paths only, known operation kinds, bounded sizes.
 * Anything else is discarded rather than "repaired".
 */
export class ModelPatchProposer implements PatchProposer {
  readonly available = true;
  constructor(private readonly complete: (prompt: string) => Promise<string>) {}

  async propose(input: ProposalInput) {
    const prompt = [
      input.context.proposalText
        ? 'Devuelve SOLO JSON: {"rationale":"explicación breve","edits":[{"path":"ruta relativa","ops":[{"kind":"edit","edit":{"oldText":"texto exacto mostrado","newText":"reemplazo mínimo"}}]}]}. Usa únicamente kind=edit y archivos mostrados. Conserva los contratos de productores y consumidores relacionados. La explicación debe ser breve; dedica la respuesta a los cambios necesarios.'
        : 'Eres el módulo de parches de JARVIS. Devuelve SOLO JSON: {"rationale": string, "edits": [{"path": string, "ops": [{"kind":"edit","edit":{"oldText":string,"newText":string,"nearLine"?:number}} | {"kind":"replace","startLine":n,"endLine":n,"text":string} | {"kind":"insert","atLine":n,"text":string} | {"kind":"delete","startLine":n,"endLine":n}]}]}.',
      'Rutas relativas al proyecto. Corrige el código fuente, no cambies las pruebas para esconder un fallo. Prefiere kind=edit con oldText copiado EXACTAMENTE de un archivo mostrado y newText mínimo. Si usas líneas, startLine/endLine deben existir en ese archivo. No inventes archivos ni líneas.',
      ...(input.context.proposalText ? ['No devuelvas archivos completos. Usa oldText único de sólo las líneas necesarias y reemplazos pequeños; rationale de una frase. Sólo para archivos complete, edit.nearLine opcional desambigua coincidencias.'] : []),
      `Objetivo: ${input.goal}`, `Intento: ${input.attempt}`,
      `Errores:\n${input.failures.map((f) => `[${f.check}] ${f.excerpt}`).join('\n').slice(0, 6000)}`,
      `Archivos:\n${input.context.proposalText ?? input.context.files.map((f) => `=== ${f.path} (${f.reason})\n${f.content}`).join('\n')}`,
    ].join('\n\n');
    return parseProposal(await this.complete(prompt));
  }
}

export function parseProposal(raw: string): { edits: ProposedEdit[]; rationale: string } | null {
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  let data: unknown;
  try { data = JSON.parse(json); } catch { return null; }
  const d = data as { rationale?: unknown; edits?: unknown };
  if (!Array.isArray(d.edits) || d.edits.length === 0 || d.edits.length > 20) return null;
  const edits: ProposedEdit[] = [];
  for (const e of d.edits as { path?: unknown; ops?: unknown }[]) {
    if (typeof e.path !== 'string' || /^([a-zA-Z]:|[\\/])/.test(e.path) || e.path.includes('..') || !Array.isArray(e.ops) || !e.ops.length) return null;
    for (const op of e.ops as PatchOp[]) {
      const ok = (op.kind === 'edit' && typeof op.edit?.oldText === 'string' && typeof op.edit?.newText === 'string' && op.edit.oldText.length + op.edit.newText.length < 20000)
        || (op.kind === 'replace' && Number.isInteger(op.startLine) && Number.isInteger(op.endLine) && typeof op.text === 'string')
        || (op.kind === 'insert' && Number.isInteger(op.atLine) && typeof op.text === 'string')
        || (op.kind === 'delete' && Number.isInteger(op.startLine) && Number.isInteger(op.endLine));
      if (!ok) return null;
    }
    edits.push({ path: e.path, ops: e.ops as PatchOp[] });
  }
  return { edits, rationale: typeof d.rationale === 'string' ? d.rationale.slice(0, 500) : '' };
}

/* ------------------------------------------------------------------ */
/* The loop                                                            */
/* ------------------------------------------------------------------ */

/** Manifests and lockfiles: "don't change dependencies" means none of these. */
export const DEPENDENCY_FILES = /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|pyproject\.toml|Pipfile(\.lock)?|poetry\.lock|Cargo\.(toml|lock)|go\.(mod|sum)|[^/]+\.csproj|packages\.config|pom\.xml|build\.gradle(\.kts)?)$/i;

export interface CodingOutcome {
  identity?: {providerId: string; model: string | null};
  proof?: {operationId: string; state: string; scope: string};
  status: 'verified' | 'unverified' | 'failed' | 'no_proposal' | 'no_checks';
  skipped: string[];
  iterations: number;
  changed: string[];
  stillFailing: string[];
  lastError: string | null;
  checks: string[];
}

const data = <T>(r: ToolResult): T => r.data as T;

/**
 * UNDERSTAND → CHANGE → VERIFY, with a hard ceiling on repair iterations.
 * Every action is a tool call through the broker (visible sub-step, permission,
 * approval, pause, STOP, audit). A successful write is not success: only the
 * project's own checks passing is. After maxRepairIterations it stops and
 * reports what changed, what still fails and the last error — it does not keep
 * editing at random.
 */
export function createCodingDelegate(opts: { proposer: () => PatchProposer; maxRepairIterations?: number }): DelegateExecutor {
  return async ({ args, prompt, callTool, note, token }) => {
    const a = (args ?? {}) as { project?: string; goal?: string; maxRepairIterations?: number; constraints?: { noDependencies?: boolean; noCheckChanges?: boolean } };
    const noDeps = a.constraints?.noDependencies === true;
    const goal = a.goal ?? prompt;
    const max = Math.max(1, Math.min(10, a.maxRepairIterations ?? opts.maxRepairIterations ?? 3));
    const outcome: CodingOutcome = { status: 'unverified', skipped: [], iterations: 0, changed: [], stillFailing: [], lastError: null, checks: [] };
    const finish = (ok: boolean, summary: string) => ({ ok, summary, data: outcome });
    const certify = async () => {
      const r = await callTool('project.verify', {}, 'Comprobando recibos main y archivos actuales');
      const proof = r.data as CodingOutcome['proof'];
      if (r.ok && proof && typeof proof.state === 'string') outcome.proof = proof;
      return r.ok && proof?.state === 'VERIFIED';
    };

    // UNDERSTAND
    const opened = await callTool('project.open', { project: a.project ?? goal }, 'Abriendo e indexando el proyecto');
    if (!opened.ok) return finish(false, `No pude abrir el proyecto: ${opened.error}`);
    const project = data<DevProject>(opened);
    await callTool('git.status', { project: project.id }, 'Revisando el estado de Git');
    const checksRes = await callTool('project.checks', { project: project.id }, 'Buscando cómo verificar el proyecto');
    const checks = checksRes.ok ? data<VerificationCheck[]>(checksRes) : [];
    outcome.checks = checks.map((c) => c.label);

    const verify = async (label: string): Promise<VerificationFailure[]> => {
      const failures: VerificationFailure[] = [];
      for (const check of checks) {
        token.throwIfCancelled();
        const r = await callTool('terminal.execute', { project: project.id, ...check.request, verification: check.id }, `${label}: ${check.label}`);
        const res = r.data as { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean } | undefined;
        if (!r.ok || !res || res.exitCode !== 0) {
          failures.push(parseFailures(check.id, res?.exitCode ?? null, res ? `${res.stdout}\n${res.stderr}` : r.error ?? ''));
          if (check.id === 'typecheck' || check.id === 'build' || check.id === 'compile' || check.id === 'check') break; // later checks would fail for the same reason
        }
      }
      return failures;
    };

    if (!checks.length) note('Este proyecto no tiene señales de verificación disponibles (sin typecheck, lint, build ni pruebas).');
    let failures = checks.length ? await verify('Verificando') : [];
    if (checks.length && !failures.length && !/(cambia|modifica|añade|agrega|renombra|refactor|implementa|add|change|rename)/i.test(goal)) {
      outcome.status = await certify() ? 'verified' : 'unverified';
      return finish(true, `Comprobaciones ${outcome.status === 'verified' ? 'verificadas por main' : 'pasadas sin recibo main suficiente'}: ${outcome.checks.join(', ')}. No hice cambios.`);
    }

    const proposer = opts.proposer();
    for (let attempt = 1; attempt <= max; attempt++) {
      token.throwIfCancelled();
      outcome.iterations = attempt;
      const ctxRes = await callTool('code.context', { project: project.id, query: goal, failures, recent: outcome.changed }, `Reuniendo contexto (intento ${attempt})`);
      if (!proposer.available) { outcome.status = 'no_proposal'; break; }
      const proposal = await proposer.propose({ goal, context: data<CodeContext>(ctxRes), failures, attempt });
      token.throwIfCancelled();
      const identity = proposer.identity?.(); if (identity) outcome.identity = identity;
      if (!proposal || !proposal.edits.length) { outcome.status = 'no_proposal'; break; }
      note(proposal.rationale || `Propuesta de ${proposal.edits.length} cambio(s).`);

      // CHANGE — constraints from the request are enforced here, not trusted to the model.
      const rejectedPatches: VerificationFailure[] = [];
      const rejected = (path: string, reason: string) => rejectedPatches.push({check: 'patch', exitCode: null,
        errors: [{file: path, message: reason.slice(0, 650)}], excerpt: `${path}: ${reason}`.slice(0, 900)});
      for (const edit of proposal.edits) {
        if (a.constraints?.noCheckChanges && checkInput(edit.path)) { note(`Omito ${edit.path}: pediste no cambiar las pruebas ni sus inputs.`); outcome.skipped.push(edit.path); rejected(edit.path, 'USER_CONSTRAINT: no cambiar pruebas ni sus inputs'); continue; }
        if (noDeps && DEPENDENCY_FILES.test(edit.path)) { note(`Omito ${edit.path}: pediste no cambiar dependencias.`); outcome.skipped.push(edit.path); rejected(edit.path, 'USER_CONSTRAINT: no cambiar dependencias'); continue; }
        const read = await callTool('file.read', { project: project.id, path: edit.path }, `Leyendo ${edit.path}`);
        if (!read.ok) { rejected(edit.path, read.error ?? 'FILE_READ_DENIED'); continue; }
        const patched = await callTool('file.patch', { project: project.id, path: edit.path, ops: edit.ops,
          ...(edit.expectedHash ? {expectedHash: edit.expectedHash} : {}) }, `Aplicando parche a ${edit.path}`);
        if (patched.ok && !outcome.changed.includes(edit.path)) outcome.changed.push(edit.path);
        if (!patched.ok) rejected(edit.path, patched.error ?? 'PATCH_REJECTED');
      }

      // VERIFY
      if (!checks.length) { outcome.status = 'no_checks'; break; }
      failures = await verify(`Verificando (intento ${attempt})`);
      if (!failures.length) { outcome.status = await certify() ? 'verified' : 'unverified'; break; }
      // The next proposal must see why an edit failed, including no-op/anchor/hash conflicts.
      failures.push(...rejectedPatches.slice(0, 4));
      outcome.status = 'failed';
    }

    outcome.stillFailing = failures.map((f) => f.check);
    outcome.lastError = failures.at(-1)?.errors[0]?.message ?? failures.at(-1)?.excerpt.split('\n').filter(Boolean).at(-1) ?? null;
    await callTool('changes.review', {}, 'Resumiendo los cambios');

    switch (outcome.status) {
      case 'verified':
        return finish(true, `Verificado por main: ${outcome.checks.join(', ')} pasan en el snapshot comprobado, con entradas de checks sin cambios, tras ${outcome.iterations} intento(s). Cambié: ${outcome.changed.join(', ') || 'nada'}. No demuestra corrección universal.`);
      case 'unverified':
        return finish(true, `Comprobaciones pasan tras ${outcome.iterations} intento(s): ${outcome.checks.join(', ')}, pero falta un recibo main vigente del mismo snapshot. Cambié: ${outcome.changed.join(', ') || 'nada'}. Resultado no verificado.`);
      case 'no_checks':
        return finish(true, `Apliqué cambios en ${outcome.changed.join(', ')}, pero el proyecto no tiene cómo verificarlos: no están comprobados.`);
      case 'no_proposal':
        return finish(false, proposer.available
          ? `No encontré un cambio que proponer. Sigue fallando: ${outcome.stillFailing.join(', ') || '—'}. Último error: ${outcome.lastError ?? '—'}`
          : `Analicé el proyecto${failures.length ? ` y fallan: ${outcome.stillFailing.join(', ')}. Último error: ${outcome.lastError ?? '—'}` : ''}. No hay un modelo configurado para proponer cambios.`);
      default:
        return finish(false, `Me detuve tras ${outcome.iterations} intentos (límite ${max}). Cambié: ${outcome.changed.join(', ') || 'nada'}. Sigue fallando: ${outcome.stillFailing.join(', ')}. Último error: ${outcome.lastError ?? '—'}`);
    }
  };
}
