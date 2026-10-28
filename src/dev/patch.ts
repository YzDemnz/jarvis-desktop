import type { PatchOp, PatchResult } from '@/types';

export class PatchError extends Error {
  constructor(message: string) { super(message); this.name = 'PatchError'; }
}

interface Split { lines: string[]; eol: '\n' | '\r\n'; finalNewline: boolean }

export function splitLines(text: string): Split {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const finalNewline = text.endsWith('\n');
  const body = finalNewline ? text.slice(0, text.endsWith('\r\n') ? -2 : -1) : text;
  return { lines: body.length || finalNewline ? body.split(/\r?\n/) : [], eol, finalNewline };
}

function joinLines(s: Split): string {
  return s.lines.join(s.eol) + (s.finalNewline && s.lines.length ? s.eol : '');
}

function textLines(text: string): string[] {
  const t = text.endsWith('\r\n') ? text.slice(0, -2) : text.endsWith('\n') ? text.slice(0, -1) : text;
  return t.length ? t.split(/\r?\n/) : [''];
}

/**
 * Applies patch operations. Line operations are 1-based and applied bottom-up
 * so earlier ones do not shift later ones. Text edits must match exactly —
 * a patch based on a stale view fails loudly instead of landing in the wrong
 * place. The file's line endings are preserved.
 */
export function applyOps(text: string, ops: PatchOp[]): string {
  if (!ops.length) throw new PatchError('El parche no contiene operaciones.');
  let current = text;

  // Text edits first, each against the current text.
  for (const op of ops) {
    if (op.kind !== 'edit') continue;
    const { oldText, newText, nearLine } = op.edit;
    if (!oldText) throw new PatchError('Una edición necesita el texto exacto a sustituir.');
    const hits: number[] = [];
    for (let i = current.indexOf(oldText); i !== -1; i = current.indexOf(oldText, i + 1)) hits.push(i);
    if (!hits.length) throw new PatchError(`No se encontró el texto a sustituir: «${oldText.slice(0, 60)}».`);
    let at = hits[0]!;
    if (hits.length > 1) {
      if (!nearLine) throw new PatchError(`El texto a sustituir aparece ${hits.length} veces; indica nearLine.`);
      const lineOf = (idx: number) => current.slice(0, idx).split('\n').length;
      at = hits.reduce((best, h) => (Math.abs(lineOf(h) - nearLine) < Math.abs(lineOf(best) - nearLine) ? h : best), at);
    }
    current = current.slice(0, at) + newText + current.slice(at + oldText.length);
  }

  const lineOps = ops.filter((o): o is Exclude<PatchOp, { kind: 'edit' }> => o.kind !== 'edit');
  if (!lineOps.length) return current;
  const split = splitLines(current);
  const n = split.lines.length;
  const key = (o: typeof lineOps[number]) => (o.kind === 'insert' ? o.atLine : o.startLine);
  for (const op of [...lineOps].sort((a, b) => key(b) - key(a))) {
    if (op.kind === 'insert') {
      if (op.atLine < 1 || op.atLine > n + 1) throw new PatchError(`Línea de inserción fuera de rango: ${op.atLine}.`);
      split.lines.splice(op.atLine - 1, 0, ...textLines(op.text));
    } else {
      if (op.startLine < 1 || op.endLine < op.startLine || op.endLine > n) {
        throw new PatchError(`Rango fuera del archivo: ${op.startLine}-${op.endLine} (tiene ${n} líneas).`);
      }
      const count = op.endLine - op.startLine + 1;
      if (op.kind === 'delete') split.lines.splice(op.startLine - 1, count);
      else split.lines.splice(op.startLine - 1, count, ...textLines(op.text));
    }
  }
  if (!split.lines.length) split.finalNewline = false;
  return joinLines(split);
}

/* ------------------------------------------------------------------ */
/* Diff (Myers)                                                        */
/* ------------------------------------------------------------------ */

type Edit = { type: 'eq' | 'del' | 'ins'; line: string };

const MAX_D = 4000;

/** Myers O(ND) line diff. Very different inputs degrade to "replace all". */
export function diffLines(a: string[], b: string[]): Edit[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const head: Edit[] = a.slice(0, start).map((line) => ({ type: 'eq', line }));
  const tail: Edit[] = a.slice(endA).map((line) => ({ type: 'eq', line }));
  const A = a.slice(start, endA), B = b.slice(start, endB);
  const N = A.length, M = B.length, max = N + M;
  if (max === 0) return [...head, ...tail];

  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= Math.min(max, MAX_D); d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= N && y >= M) { found = true; break; }
    }
    if (found) break;
  }
  if (!found) {
    return [...head, ...A.map((line): Edit => ({ type: 'del', line })), ...B.map((line): Edit => ({ type: 'ins', line })), ...tail];
  }

  const mid: Edit[] = [];
  let x = N, y = M;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { mid.push({ type: 'eq', line: A[--x]! }); y--; }
    if (d > 0) {
      if (x === prevX) mid.push({ type: 'ins', line: B[--y]! });
      else mid.push({ type: 'del', line: A[--x]! });
    }
  }
  return [...head, ...mid.reverse(), ...tail];
}

export interface Hunk {
  oldStart: number;
  newStart: number;
  oldLines: string[];
  newLines: string[];
  /** Unchanged lines around the change, used to find it again later. */
  before: string[];
  after: string[];
}

export function computeHunks(beforeText: string, afterText: string, context = 3): Hunk[] {
  const a = splitLines(beforeText).lines, b = splitLines(afterText).lines;
  const edits = diffLines(a, b);
  const hunks: Hunk[] = [];
  let ai = 0, bi = 0, i = 0;
  while (i < edits.length) {
    if (edits[i]!.type === 'eq') { ai++; bi++; i++; continue; }
    const h: Hunk = { oldStart: ai + 1, newStart: bi + 1, oldLines: [], newLines: [], before: a.slice(Math.max(0, ai - context), ai), after: [] };
    while (i < edits.length && edits[i]!.type !== 'eq') {
      const e = edits[i]!;
      if (e.type === 'del') { h.oldLines.push(e.line); ai++; } else { h.newLines.push(e.line); bi++; }
      i++;
    }
    h.after = a.slice(ai, ai + context);
    hunks.push(h);
  }
  return hunks;
}

/** Standard unified diff, for the Diff Viewer and review. */
export function unifiedDiff(beforeText: string, afterText: string, path: string, context = 3): string {
  if (beforeText === afterText) return '';
  const a = splitLines(beforeText).lines, b = splitLines(afterText).lines;
  const edits = diffLines(a, b);
  const out = [`--- a/${path}`, `+++ b/${path}`];
  let i = 0, ai = 0, bi = 0;
  while (i < edits.length) {
    if (edits[i]!.type === 'eq') { i++; ai++; bi++; continue; }
    // Collect a hunk: changes plus up to `context` eq lines around, merging close ones.
    const startI = Math.max(0, i - context);
    let j = i;
    let lastChange = i;
    while (j < edits.length) {
      if (edits[j]!.type !== 'eq') lastChange = j;
      else if (j - lastChange > context * 2) break;
      j++;
    }
    const endI = Math.min(edits.length, lastChange + context + 1);
    const lead = i - startI;
    let oldStart = ai - lead + 1, newStart = bi - lead + 1, oldCount = 0, newCount = 0;
    const body: string[] = [];
    for (let k = startI; k < endI; k++) {
      const e = edits[k]!;
      if (e.type === 'eq') { body.push(` ${e.line}`); oldCount++; newCount++; }
      else if (e.type === 'del') { body.push(`-${e.line}`); oldCount++; }
      else { body.push(`+${e.line}`); newCount++; }
    }
    if (oldCount === 0) oldStart -= 1;
    if (newCount === 0) newStart -= 1;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body);
    for (let k = i; k < endI; k++) { const t = edits[k]!.type; if (t !== 'ins') ai++; if (t !== 'del') bi++; }
    i = endI;
  }
  return out.join('\n') + '\n';
}

export function patchResult(before: string, after: string, path: string): PatchResult {
  const diff = unifiedDiff(before, after, path);
  const lines = diff.split('\n');
  return {
    before, after, diff,
    linesAdded: lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length,
    linesRemoved: lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length,
  };
}

/**
 * Undoes JARVIS's hunks on a file the user may have edited since. Each hunk is
 * located by its surrounding context and JARVIS's new lines; the user's other
 * edits are left alone. If any hunk cannot be located unambiguously, nothing is
 * written and null is returned — the caller reports a conflict.
 */
export function reverseHunks(currentText: string, hunks: Hunk[]): string | null {
  const split = splitLines(currentText);
  const lines = split.lines;
  for (const h of [...hunks].reverse()) {
    // Full context first; shrink it when the user edited a neighbouring line.
    // The needle must match exactly once, and is never empty.
    let at = -1;
    search:
    for (let total = h.before.length + h.after.length; total >= 0; total--) {
      for (let cb = Math.min(h.before.length, total); cb >= 0; cb--) {
        const ca = total - cb;
        if (ca > h.after.length) continue;
        const pre = h.before.slice(h.before.length - cb);
        const needle = [...pre, ...h.newLines, ...h.after.slice(0, ca)];
        if (!needle.length) continue;
        const matches: number[] = [];
        for (let i = 0; i + needle.length <= lines.length && matches.length < 2; i++) {
          let ok = true;
          for (let j = 0; j < needle.length; j++) if (lines[i + j] !== needle[j]) { ok = false; break; }
          if (ok) matches.push(i);
        }
        if (matches.length === 1) { at = matches[0]! + pre.length; break search; }
      }
    }
    if (at < 0) return null;
    lines.splice(at, h.newLines.length, ...h.oldLines);
  }
  split.lines = lines;
  return joinLines(split);
}
