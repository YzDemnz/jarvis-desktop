import {createHash} from 'node:crypto';
import type {IndexedFile} from '../../src/types';
import type {ProposalInput, ProposedEdit} from '../../src/dev/coding';
import {selectProposalContext, type RawProposalFile, type SelectedProposalFile} from '../../src/dev/ProposalContext';
import {safeContextText} from '../../src/fabric/ContinuityState';
import {checkInput} from '../../src/dev/checkInputs';

/** Renderer content is a retrieval hint. Only fresh, guarded disk bytes enter a proposal. */
export async function readProposalContext(input: ProposalInput, source: {
  entries: IndexedFile[];
  read: (relative: string) => Promise<Uint8Array>;
  assert: () => void;
}) {
  const hints = new Map(input.context.files.map((f, i) => [f.path, {reason: f.reason, priority: 100 - i}]));
  const candidates = source.entries.filter(f => !f.secret && !f.binary &&
    (hints.has(f.relativePath) || /\.(?:[cm]?[jt]sx?|py|rs|go|cs|java|json)$/i.test(f.relativePath)))
    .sort((a, b) => Number(checkInput(a.relativePath)) - Number(checkInput(b.relativePath)) ||
      (hints.get(b.relativePath)?.priority ?? 0) - (hints.get(a.relativePath)?.priority ?? 0) || a.relativePath.localeCompare(b.relativePath));
  const files: RawProposalFile[] = [], omitted: {path: string; reason: string}[] = [];
  let total = 0, readAttempts = 0;
  for (const entry of candidates) {
    source.assert();
    const path = entry.relativePath;
    if (readAttempts >= 48) { omitted.push({path, reason: 'RAW_FILE_LIMIT'}); continue; }
    if (total >= 512 * 1024) { omitted.push({path, reason: 'RAW_BYTE_LIMIT'}); continue; }
    if (entry.size > 128 * 1024) { omitted.push({path, reason: 'RAW_FILE_TOO_LARGE'}); continue; }
    let bytes: Uint8Array;
    readAttempts++;
    try { bytes = await source.read(path); } catch { source.assert(); omitted.push({path, reason: 'PUBLIC_READ_DENIED'}); continue; }
    source.assert();
    total += bytes.length;
    if (bytes.length > 128 * 1024 || total > 512 * 1024) { omitted.push({path, reason: 'RAW_BYTE_LIMIT'}); continue; }
    let content: string;
    // Keep a BOM and exact CRLF; replacement characters must never manufacture edit anchors.
    try { content = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); }
    catch { omitted.push({path, reason: 'INVALID_UTF8'}); continue; }
    if (content.includes('\0') || safeContextText(content) !== content) { omitted.push({path, reason: 'REDACTED_OR_BINARY'}); continue; }
    const normalized = (value: string) => value.replace(/\\/g, '/').toLowerCase();
    const focusLines = input.context.errors.filter(e => e.file && e.line &&
      (normalized(e.file) === normalized(path) || normalized(e.file).endsWith('/'+normalized(path)))).map(e => e.line!);
    files.push({path, content, fullFileHash: createHash('sha256').update(bytes).digest('hex'),
      reason: hints.get(path)?.reason ?? 'main-selected public dependency candidate',
      priority: (hints.get(path)?.priority ?? 0) + (checkInput(path) ? -1000 : 0), focusLines});
  }
  const map = (input.context as ProposalInput['context'] & {repositoryMap?: {text?: string}}).repositoryMap?.text;
  const sources = files.filter(file => !checkInput(file.path));
  const sourceSelection = selectProposalContext(sources, {maxChars: 5000, maxBytes: 10000, maxFiles: 11,
    maxCharsPerFile: 4096, dependencyDepth: 1});
  // Full source outranks test boilerplate and check manifests. A reference remains exact and explicitly partial.
  const references = files.filter(file => checkInput(file.path) && /\.(?:[cm]?[jt]sx?|py|rs|go|cs|java)$/i.test(file.path));
  for (const file of files.filter(file => checkInput(file.path) && !references.includes(file))) omitted.push({path: file.path, reason: 'CHECK_METADATA_NOT_IN_PROMPT'});
  const referenceSelection = selectProposalContext(references, {maxChars: 900, maxBytes: 1800, maxFiles: 1,
    maxCharsPerFile: 700, windowLines: 8, dependencyDepth: 0});
  const advisoryMap = sourceSelection.files.length < sources.length && typeof map === 'string'
    ? safeContextText(map).slice(0, 400) : '';
  const selectedFiles = [...sourceSelection.files, ...referenceSelection.files];
  const text = [sourceSelection.text, referenceSelection.text ? 'Check reference (bounded; criteria remain unchanged):\n'+referenceSelection.text : '',
    advisoryMap ? 'Repository map (advisory):\n'+advisoryMap : ''].filter(Boolean).join('\n\n');
  const selected = {...sourceSelection, files: selectedFiles, selectedFiles: selectedFiles.length, candidateFiles: files.length,
    omitted: [...sourceSelection.omitted, ...referenceSelection.omitted], repositoryMap: advisoryMap,
    text, chars: text.length, bytes: Buffer.byteLength(text),
    budget: {...sourceSelection.budget, maxFiles: 12, maxChars: 6400, maxBytes: 14000, referenceMaxCharsPerFile: 700, referenceMaxFiles: 1}};
  const loaded = {selected, omitted, totalReadBytes: total};
  if (!selected.files.length) throw Object.assign(Error('PUBLIC_PROPOSAL_CONTEXT_EMPTY'), {contextMetadata: proposalContextMetadata(loaded)});
  return loaded;
}

/** The journal gets scope/budget metadata, never the source, prompt or renderer text. */
export function proposalContextMetadata(loaded: Awaited<ReturnType<typeof readProposalContext>>) {
  const {selected} = loaded;
  return {
    selectedFiles: selected.files.map(file => ({path: safeContextText(file.path).slice(0, 500), chars: file.content.length,
      complete: file.complete, startLine: file.startLine, endLine: file.endLine, fullFileHash: file.fullFileHash,
      ...(file.dependencyOf ? {dependencyOf: safeContextText(file.dependencyOf).slice(0, 500)} : {})})),
    omittedFiles: [...loaded.omitted, ...selected.omitted].map(file => ({path: safeContextText(file.path).slice(0, 500), reason: file.reason})),
    unresolvedDependencies: selected.unresolvedDependencies.map(dependency => ({from: safeContextText(dependency.from).slice(0, 500),
      specifier: safeContextText(dependency.specifier).slice(0, 300), reason: dependency.reason})),
    contextBudget: {...selected.budget}, totalReadBytes: loaded.totalReadBytes,
  };
}

/** One atomic patch per file: repeated model groups share the same original snapshot hash. */
export function bindProposalToContext(edits: ProposedEdit[], files: SelectedProposalFile[]): ProposedEdit[] {
  const grouped = new Map<string, ProposedEdit>();
  for (const edit of edits) {
    const source = files.find(file => file.path === edit.path);
    if (!source || edit.ops.some(op => op.kind !== 'edit' || !op.edit.oldText || !source.content.includes(op.edit.oldText))) throw Error('PROPOSAL_OUTSIDE_PRESENTED_CONTEXT');
    if (edit.ops.some(op => op.kind === 'edit' && op.edit.nearLine !== undefined &&
      (!source.complete || !Number.isInteger(op.edit.nearLine) || op.edit.nearLine < source.startLine || op.edit.nearLine > source.endLine))) throw Error('PROPOSAL_LINE_HINT_OUTSIDE_COMPLETE_CONTEXT');
    const bound = grouped.get(edit.path) ?? {path: edit.path, ops: [], expectedHash: source.fullFileHash};
    bound.ops.push(...edit.ops); grouped.set(edit.path, bound);
  }
  return [...grouped.values()];
}
