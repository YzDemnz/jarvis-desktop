import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { selectProposalContext, type RawProposalFile } from '../../src/dev/ProposalContext';

let count = 0; const pass = (name: string) => { count++; console.log('PASS ' + name); };
const hash = (content: string) => createHash('sha256').update(content).digest('hex');
const raw = (path: string, content: string, extra: Partial<RawProposalFile> = {}): RawProposalFile => ({ path, content, fullFileHash: hash(content), ...extra });
const small = Array.from({ length: 8 }, (_, index) => raw(`src/module${index}.ts`, `export const value${index} = ${index};\n`));
const enough = selectProposalContext(small);
assert.equal(enough.selectedFiles, 8); assert.equal(enough.omitted.length, 0);
assert.ok(enough.chars <= enough.budget.maxChars); assert.equal(enough.chars, enough.text.length);
assert.equal(enough.bytes, Buffer.byteLength(enough.text));
pass('Default can admit more than six independent files and measures headers in the rendered text budget');

const original = Array.from({ length: 260 }, (_, index) => index === 199 ? 'export const compute = (a, b) => a - b;' : `// complete original line ${index + 1}: padding for real source`).join('\r\n');
const focused = selectProposalContext([raw('src/large.ts', original, { focusLines: [200], reason: 'test error', priority: 10 })]);
assert.equal(focused.selectedFiles, 1); const window = focused.files[0]!;
assert.equal(window.complete, false); assert.ok(window.startLine <= 200 && window.endLine >= 200);
assert.ok(original.includes(window.content)); assert.ok(window.content.includes('export const compute'));
assert.ok(window.content.includes('\r\n')); assert.ok(!window.content.includes('200: export'));
assert.equal(window.fullFileHash, hash(original)); assert.notEqual(window.fullFileHash, hash(window.content));
const lines = original.split('\r\n');
assert.equal(window.content, lines.slice(window.startLine - 1, window.endLine).join('\r\n') + (window.endLine < lines.length ? '\r\n' : ''));
pass('Large-file window is an exact contiguous CRLF substring around the failing line, retaining the full-file hash');

const source = raw('src/service.ts', 'import { format } from "./format.js";\nexport const invoice = (n) => format(n);\n', { priority: 10 });
const unrelated = Array.from({ length: 12 }, (_, index) => raw(`src/noise${index}.ts`, `export const unrelated${index} = ${index};`));
const dependency = raw('src/format.ts', 'export const format = (n) => n.toFixed(2);');
const chain = selectProposalContext([source, ...unrelated, dependency], { maxFiles: 2 });
assert.deepEqual(chain.files.map(file => file.path), ['src/service.ts', 'src/format.ts']);
assert.equal(chain.files[1]!.dependencyOf, 'src/service.ts'); assert.equal(chain.omitted.length, 12);
assert.ok(chain.omitted.every(item => item.reason === 'FILE_LIMIT'));
pass('Bounded relative dependency resolution selects JS-to-TS source before unrelated decoys');

const requireChain = selectProposalContext([
  raw('src/app.cjs', 'const { add } = require("../lib/math");\nimport("./optional");\nrequire("../../outside");\nrequire("vendor");', { priority: 10 }),
  raw('lib/math.js', 'exports.add = (a, b) => a + b;'),
], { maxFiles: 2 });
assert.deepEqual(requireChain.files.map(file => file.path), ['src/app.cjs', 'lib/math.js']);
assert.deepEqual(requireChain.unresolvedDependencies.map(item => item.reason), ['NOT_IN_RAW_INPUT', 'OUTSIDE_PROJECT']);
pass('Require/import hints resolve only admitted files and label unavailable or escaped relatives without reading disk');

const malformed = selectProposalContext([
  raw('../outside.ts', 'x'), raw('node_modules/dep.ts', 'x'), raw('.env', 'x'), raw('src/a.ts', 'x', { fullFileHash: 'not-sha256' }),
  raw('src/redacted.ts', '[redacted]', { redacted: true }), raw('src/truncated.ts', '42: return x;', { truncated: true }),
  raw('src/bad-flag.ts', 'x', { truncated: 'false' as unknown as boolean }),
]);
assert.equal(malformed.selectedFiles, 0);
assert.deepEqual(malformed.omitted.map(item => item.reason), ['INVALID_PATH', 'INVALID_PATH', 'INVALID_PATH', 'INVALID_FULL_FILE_HASH', 'REDACTED_INPUT', 'TRUNCATED_INPUT', 'INVALID_INPUT']);
pass('Escaped, vendor, secret, invalid-hash, redacted, annotated/truncated and malformed inputs are explicitly refused');

const baseline = selectProposalContext([raw('large.ts', original), ...small], { maxFiles: 3, maxCharsPerFile: 1600, maxChars: 5000, completeOnly: true, dependencyDepth: 0 });
assert.equal(baseline.selectedFiles, 3); assert.equal(baseline.omitted[0]?.reason, 'FULL_FILE_OVER_BUDGET');
const improved = selectProposalContext([raw('large.ts', original, { focusLines: [200] }), ...small], { maxFiles: 12 });
assert.ok(improved.files.some(file => file.path === 'large.ts')); assert.ok(improved.selectedFiles >= 6);
pass('Baseline and improved policies are configurable without changing the supplied source or criteria');

const tight = selectProposalContext(small, { maxChars: 190, maxBytes: 760, repositoryMap: 'src/module0.ts exported value0\n'.repeat(20) });
assert.ok(tight.chars <= 190); assert.equal(tight.text.length, tight.chars);
assert.ok(tight.omitted.some(item => item.reason === 'TOTAL_CHAR_BUDGET'));
const byteBound = selectProposalContext([raw('unicode.ts', 'export const emoji = "' + '🧠'.repeat(20) + '";')], { maxChars: 1000, maxBytes: 170 });
assert.equal(byteBound.selectedFiles, 0); assert.equal(byteBound.omitted[0]?.reason, 'TOTAL_BYTE_BUDGET');
const zero = selectProposalContext(small, { maxChars: 0 }); assert.equal(zero.text, ''); assert.equal(zero.selectedFiles, 0);
pass('Total text/UTF-8 budgets include headers and emit distinct omissions, including a zero budget');

const mapped = selectProposalContext([small[0]!], { repositoryMap: 'module0.ts:1 export value0\nmodule1.ts:1 export value1', maxMapChars: 30 });
assert.equal(mapped.repositoryMap, 'module0.ts:1 export value0'); assert.ok(mapped.text.includes('Repository map'));
assert.ok(mapped.chars <= mapped.budget.maxChars);
const singleLong = selectProposalContext([raw('minified.ts', 'x'.repeat(5000))]);
assert.equal(singleLong.omitted[0]?.reason, 'FOCUS_LINE_OVER_BUDGET');
const duplicates = selectProposalContext([small[0]!, small[0]!]); assert.equal(duplicates.selectedFiles, 1); assert.equal(duplicates.omitted[0]?.reason, 'DUPLICATE_PATH');
pass('Repository map is advisory and bounded by whole lines; uneditable long lines and duplicate files stay explicit');

const cycle = [raw('a.ts', 'export { b } from "./b";'), raw('b.ts', 'export { a } from "./a";')];
const inputBefore = JSON.stringify(cycle), cyclic = selectProposalContext(cycle, { dependencyDepth: 3 });
assert.equal(cyclic.selectedFiles, 2); assert.equal(JSON.stringify(cycle), inputBefore);
assert.deepEqual(selectProposalContext(cycle, { dependencyDepth: 3 }), cyclic);
assert.throws(() => selectProposalContext(Array.from({ length: 2001 }, () => small[0]!)), /PROPOSAL_RAW_FILE_LIMIT/);
pass('Dependency cycles terminate deterministically, inputs remain unchanged and excessive candidate sets fail explicitly');

const unicodeSource = Array.from({ length: 90 }, (_, index) => index === 44 ? 'export const etiqueta = "café 🧠 e\u0301";' : `// línea ${index + 1} público ñ`).join('\r\n');
const unicodeWindow = selectProposalContext([raw('src/Espacios ñ/código útil.ts', unicodeSource, { focusLines: [45] })], { maxCharsPerFile: 140 }).files[0]!;
assert.ok(unicodeWindow); assert.ok(unicodeSource.includes(unicodeWindow.content));
assert.ok(unicodeWindow.content.includes('café 🧠 e\u0301')); assert.equal(unicodeWindow.fullFileHash, hash(unicodeSource));
assert.deepEqual(Buffer.from(unicodeWindow.content), Buffer.from(unicodeSource).subarray(Buffer.byteLength(unicodeSource.slice(0, unicodeSource.indexOf(unicodeWindow.content))), Buffer.byteLength(unicodeSource.slice(0, unicodeSource.indexOf(unicodeWindow.content))) + Buffer.byteLength(unicodeWindow.content)));
assert.equal(unicodeWindow.path, 'src/Espacios ñ/código útil.ts');
pass('Unicode paths, emoji and combining accents retain exact UTF-8 window bytes and the full-file hash');

const windowsAliases = ['src/math.ts:stream', 'src/CON.ts', 'src/COM1.js', 'src/math.ts.', 'src/math.ts ', 'src/.. /hidden.ts', '//server/share/module.ts', 'E:/module.ts'];
const refusedAliases = selectProposalContext(windowsAliases.map(file => raw(file, 'export const value = 1;')));
assert.equal(refusedAliases.selectedFiles, 0);
assert.equal(refusedAliases.omitted.length, windowsAliases.length);
assert.ok(refusedAliases.omitted.every(item => item.reason === 'INVALID_PATH'));
pass('Windows ADS, reserved devices, trailing aliases, UNC and drive-qualified paths are rejected before selection');

console.log(`PROPOSAL_CONTEXT_RESULT ${JSON.stringify({ passed: count, inference: 'NONE', filesystemEffects: 'NONE', baselineFiles: baseline.selectedFiles, improvedFiles: improved.selectedFiles, improvedChars: improved.chars })}`);
