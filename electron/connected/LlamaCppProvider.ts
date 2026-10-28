import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnWindowsJob, withProcessScope } from '../process/WindowsJobProcess';
import { safeContextText } from '../../src/fabric/ContinuityState';
import { usageRecord } from './HttpProvider';
import type { IntelligenceRequest, IntelligenceResponse } from '../../src/fabric/types';

export const LLAMA_RELEASE = 'b6500';
export const LLAMA_ARCHIVE_HASH = '73e00267e852e666a6fce2c3fb7a2603dd1934a37259f3f45c2c1b6983fa605a';
export const LLAMA_MODEL = 'qwen2.5:3b-instruct';
const MODEL_HASH = '5ee4f07cdb9beadbbb293e85803c569b01bd37ed059d2715faa7bb405f31caa6';
const verifiedHashes = new Map<string, { stamp: string; digest: string }>();
const hashFile = async (file: string, signal?: AbortSignal) => {
  if (signal?.aborted) throw Error('LLAMA_INTEGRITY_CHECK_STOPPED');
  const st = fs.statSync(file), stamp = `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
  const cached = verifiedHashes.get(file); if (cached?.stamp === stamp) return cached.digest;
  const h = createHash('sha256'), stream = fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 });
  const abort = () => stream.destroy(Error('LLAMA_INTEGRITY_CHECK_STOPPED'));
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  try { for await (const b of stream) h.update(b); const digest = h.digest('hex'); verifiedHashes.set(file, { stamp, digest }); return digest; }
  finally { signal?.removeEventListener('abort', abort); stream.destroy(); }
};
export function llamaDirectory() {
  const root = process.env.JARVIS_RUNTIME_ROOT;
  if (root && !path.isAbsolute(root)) throw Error('LLAMA_RUNTIME_ROOT_MUST_BE_ABSOLUTE');
  return path.join(root ?? path.join(process.env.LOCALAPPDATA ?? '', 'JARVIS', 'runtimes'), 'llama-cpp', LLAMA_RELEASE);
}
function manifestFile(base: string) { const cache = path.join(base, 'qwen-runtime-cache.json'); return fs.existsSync(cache) ? cache : path.join(base, 'qwen-runtime.json'); }
export function discoveredLlamaRuntime() {
  const base = llamaDirectory();
  const raw = JSON.parse(fs.readFileSync(manifestFile(base), 'utf8'));
  if (raw.release !== LLAMA_RELEASE || raw.model?.id !== LLAMA_MODEL || raw.model.sha256 !== MODEL_HASH
    || !fs.existsSync(path.join(base, 'bin/llama-cli.exe')) || !fs.existsSync(raw.model.file)) throw Error('LLAMA_NOT_PROVISIONED');
  return LLAMA_MODEL;
}
/** Explicit provision only. No model downloads, network, tools, session owner or credential inheritance. */
export async function verifiedLlamaRuntime(signal?: AbortSignal) {
  const base = llamaDirectory(), bin = path.join(base, 'bin');
  const raw = JSON.parse(fs.readFileSync(manifestFile(base), 'utf8'));
  if (raw.version !== 1 || raw.release !== LLAMA_RELEASE || raw.archiveSHA256 !== LLAMA_ARCHIVE_HASH
    || raw.model?.id !== LLAMA_MODEL || raw.model.sha256 !== MODEL_HASH || !/^[a-z]:[\\/]/i.test(raw.model.file)
    || !Array.isArray(raw.assets) || raw.assets.length > 100) throw Error('LLAMA_MANIFEST_DENIED');
  if (createHash('sha256').update(JSON.stringify(raw.assets)).digest('hex') !== '10163b75ef088f2de2f6535e318637ba09062d97caa2b2a3ba9ce615d0f0853c') throw Error('LLAMA_ASSET_CATALOG_CHANGED');
  if (await hashFile(path.join(base, 'official.zip'), signal) !== LLAMA_ARCHIVE_HASH) throw Error('LLAMA_ARCHIVE_CHANGED');
  // All DLLs/launchers are verified, not only the small dispatcher executable.
  for (const a of raw.assets) {
    if (typeof a.file !== 'string' || path.basename(a.file) !== a.file || !/^[a-f0-9]{64}$/.test(a.sha256)
      || await hashFile(path.join(bin, a.file), signal) !== a.sha256) throw Error('LLAMA_ASSET_CHANGED');
  }
  const exe = path.join(bin, 'llama-cli.exe'), sha256 = await hashFile(exe, signal);
  if (!raw.assets.some((a: { file: string; sha256: string }) => a.file === 'llama-cli.exe' && a.sha256 === sha256)
    || await hashFile(raw.model.file, signal) !== MODEL_HASH) throw Error('LLAMA_MODEL_OR_BINARY_CHANGED');
  return { exe, bin, modelFile: raw.model.file as string, binarySHA256: sha256, modelSHA256: MODEL_HASH };
}
export function llamaPrompt(request: IntelligenceRequest) {
  // This pinned non-reasoning Qwen2.5 GGUF uses ChatML. User/context cannot close
  // the template delimiters and smuggle a replacement system message.
  const clean = (s: string) => safeContextText(s).replace(/<\|[^>]*\|>/g, '[template delimiter removed]');
  return '<|im_start|>system\n' + clean(request.context ?? 'You are an assistant. Return only the requested public result.')
    + '<|im_end|>\n<|im_start|>user\n' + clean(request.prompt) + '<|im_end|>\n<|im_start|>assistant\n';
}
export function llamaEnvironment(bin: string) {
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].flatMap(k => process.env[k] ? [[k, process.env[k]!]] : []));
  env.PATH = bin + ';' + path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  return env;
}
export async function executeLlama(request: IntelligenceRequest, operationId: string, model: string, guard: () => void): Promise<IntelligenceResponse> {
  guard(); if (model !== LLAMA_MODEL) throw Error('LLAMA_MODEL_NOT_PROVISIONED');
  const runtime = await verifiedLlamaRuntime(request.signal); guard();
  const prompt = llamaPrompt(request);
  // Never inherit account/API/provider variables, user config, hooks or proxies.
  const env = llamaEnvironment(runtime.bin);
  const proc = withProcessScope(operationId, request.signal, () => spawnWindowsJob({ file: runtime.exe, cwd: runtime.bin, env,
    args: ['-m', runtime.modelFile, '-p', prompt, '-n', '256', '-c', '8192', '-t', '4', '-ngl', '0', '--temp', '0', '--seed', '1', '--no-conversation', '--no-display-prompt', '--simple-io', '--no-warmup'] }), guard);
  let text = '', overflow = false;
  proc.onStdout(s => { if (text.length + s.length > 24000) { overflow = true; void proc.killTree(); } else text += s; });
  // stderr (model metadata/performance/errors) is intentionally never persisted.
  const exit = new Promise<number | null>(resolve => proc.onExit(code => resolve(code)));
  try {
    await proc.ready; const code = await exit; guard();
    if (code !== 0 || overflow || !text.trim()) throw Error('LLAMA_INFERENCE_FAILED_' + code + '_' + text.length);
    const publicText = safeContextText(text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\|[^>]*\|>/g, '').replace(/\s*\[end of text\]\s*$/, '').trim());
    if (!publicText || /<think>/i.test(publicText)) throw Error('LLAMA_PUBLIC_RESULT_REQUIRED');
    return { text: publicText, model: LLAMA_MODEL, usage: [usageRecord('llama-cpp-local', LLAMA_MODEL, request.taskId, null, null)],
      provenance: { transport: 'LLAMA_CPP_CLI', runtimeRelease: LLAMA_RELEASE, binarySHA256: runtime.binarySHA256, modelSHA256: runtime.modelSHA256,
        transmittedInputSHA256: createHash('sha256').update(prompt).digest('hex'), ownership: 'WINDOWS_JOB', tools: 'NONE' } };
  } finally { await proc.killTree(); }
}
