import path from 'node:path';
import net from 'node:net';
import { spawnWindowsJob, withProcessScope } from '../process/WindowsJobProcess';
import { NodeProcessPort } from '../dev/nodePorts';
import type { SpawnedProcess } from '../../src/dev/ports';
import type { LocalCandidate, Probe, RuntimeCatalog } from './contracts';
import { sha256, contained } from './ArtifactInstaller';
import { boundedJson } from '../connected/HttpProvider';
export async function vacantPort(): Promise<number> {
    return new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const a = s.address(); if (!a || typeof a === 'string')
        return reject(Error('PORT_UNAVAILABLE')); s.close(() => resolve(a.port)); }); });
}
/** Main-owned bounds. These are not renderer/model-selected runtime settings. */
export interface BootstrapInferencePolicy {
    contextTokens?: number;
    maxOutputTokens?: number;
    timeoutMs?: number;
}
export interface BootstrapInferenceMetrics {
    state: 'STARTED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    startedAt: number;
    startMs: number;
    firstTokenMs: number | null;
    promptTokens: number | null;
    tokenizedPromptTokens: number | null;
    outputTokens: number | null;
    tps: number | null;
    stopType: 'none' | 'eos' | 'limit' | 'word' | null;
    truncated: boolean | null;
    contextCapacity: number | null;
    maxOutputTokens: number;
    generationMs: number | null;
    reason: string | null;
}
export function validateBootstrapInferencePolicy(policy?: BootstrapInferencePolicy): void {
    if (policy?.contextTokens !== undefined && ![2048, 4096].includes(policy.contextTokens)
        || policy?.maxOutputTokens !== undefined && ![512, 768, 1024].includes(policy.maxOutputTokens)
        || policy?.timeoutMs !== undefined && ![90000, 180000, 300000].includes(policy.timeoutMs)) throw Error('INFERENCE_POLICY_DENIED');
}
/** This exact wrap is shared by token preflight and completion, never apply-template. */
export function bootstrapChatPrompt(prompt: string): string {
    return `<|im_start|>system\nYou are JARVIS's replaceable text intelligence. Reply concisely. Never execute tools. /no_think<|im_end|>\n<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n`;
}
export interface BootstrapRuntime {
    start(bin: string, model: string, candidate: LocalCandidate, signal: AbortSignal): Promise<number>;
    probe(signal: AbortSignal): Promise<Probe>;
    generate(prompt: string, signal: AbortSignal, context?:string): Promise<string>;
    generateJson?(prompt: string, signal: AbortSignal, schema: unknown, policy?: BootstrapInferencePolicy): Promise<string>;
    inferenceMetrics?(): BootstrapInferenceMetrics | null;
    stop(): Promise<void>;
    alive(): boolean;
    diagnostics?(): {
        pid: number | null;
        ownership: string | null;
    };
}
/** Native runtime and all descendants remain in JARVIS's anonymous Windows Job. */
export class LocalRuntime implements BootstrapRuntime {
    private process: SpawnedProcess | null = null;
    private endpoint = '';
    private startMs = 0;
    private contextCapacity: number | null = null;
    private lastMetrics: BootstrapInferenceMetrics | null = null;
    constructor(private readonly runtime: RuntimeCatalog) { }
    alive(): boolean { return this.process !== null; }
    diagnostics() { return { pid: this.process?.pid ?? null, ownership: this.process?.ownership ?? null }; }
    inferenceMetrics(): BootstrapInferenceMetrics | null { return this.lastMetrics ? { ...this.lastMetrics } : null; }
    async start(bin: string, model: string, candidate: LocalCandidate, signal: AbortSignal): Promise<number> {
        this.lastMetrics = null; this.startMs = 0; this.contextCapacity = null;
        await this.stop();
        signal.throwIfAborted();
        // Reverify every loadable asset and the model immediately before execution.
        for (const a of this.runtime.assets)
            if (await sha256(contained(bin, a.file), signal) !== a.sha256)
                throw Error('RUNTIME_INTEGRITY_DENIED');
        if (await sha256(model, signal) !== candidate.artifact.sha256)
            throw Error('MODEL_INTEGRITY_DENIED');
        const port = await vacantPort(), started = Date.now();
        this.endpoint = `http://127.0.0.1:${port}`;
        const env = new NodeProcessPort().baseEnv();
        this.process = withProcessScope('bootstrap-runtime', signal, () => spawnWindowsJob({ file: path.join(bin, 'llama-server.exe'), cwd: bin, env,
            args: ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-c', String(candidate.context), '-ngl', '0', '-t', '6', '--no-webui'] }));
        const owned = this.process;
        let exit = false;
        owned.onStderr(() => { });
        owned.onExit(() => { exit = true; if (this.process === owned)
            this.process = null; });
        try {
            await owned.ready;
            const deadline = Date.now() + 300000;
            while (Date.now() < deadline) {
                signal.throwIfAborted();
                if (exit)
                    throw Error('RUNTIME_EXITED');
                try {
                    const h = await boundedJson(this.endpoint + '/health', { signal }, 3000);
                    if (h.status === 'ok') {
                        this.startMs = Date.now() - started;
                        this.contextCapacity = candidate.context;
                        return this.startMs;
                    }
                }
                catch {
                    signal.throwIfAborted();
                }
                await new Promise<void>((resolve, reject) => { const t = setTimeout(done, 500); function done() { signal.removeEventListener('abort', abort); resolve(); } function abort() { clearTimeout(t); signal.removeEventListener('abort', abort); reject(Error('STOPPED')); } signal.addEventListener('abort', abort, { once: true }); });
            }
            throw Error('MODEL_LOAD_TIMEOUT');
        }
        catch (e) {
            await this.stop();
            throw e;
        }
    }
    private captureCompletionMetadata(event: any): void {
        if (!this.lastMetrics) return;
        const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
        this.lastMetrics.promptTokens = count(event.tokens_evaluated) ?? count(event.timings?.prompt_n) ?? this.lastMetrics.promptTokens;
        this.lastMetrics.outputTokens = count(event.timings?.predicted_n);
        this.lastMetrics.tps = Number.isFinite(event.timings?.predicted_per_second) && event.timings.predicted_per_second >= 0 ? event.timings.predicted_per_second : null;
        this.lastMetrics.stopType = ['none', 'eos', 'limit', 'word'].includes(event.stop_type) ? event.stop_type : null;
        this.lastMetrics.truncated = typeof event.truncated === 'boolean' ? event.truncated : null;
    }
    /** Local-only bounded metadata request; no response body or token IDs persist. */
    private async smallJson(route: string, signal: AbortSignal, init: RequestInit = {}): Promise<any> {
        const controller = new AbortController(), abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
        let expired = false; const timer = setTimeout(() => { expired = true; abort(); }, 5000);
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            if (init.body && Buffer.byteLength(String(init.body), 'utf8') > 64 * 1024) throw Error('INFERENCE_METADATA_INPUT_TOO_LARGE');
            const response = await fetch(this.endpoint + route, { ...init, signal: controller.signal, redirect: 'error' });
            if (!response.ok) throw Error('INFERENCE_METADATA_HTTP_' + response.status);
            if (!response.body) throw Error('INFERENCE_METADATA_INCOMPLETE');
            reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
            while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.length;
                if (bytes > 64 * 1024) { controller.abort(); throw Error('INFERENCE_METADATA_TOO_LARGE'); } chunks.push(item.value); }
            try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error('INFERENCE_METADATA_BAD_JSON'); }
        } catch (error) { if (signal.aborted) throw Error('STOPPED'); if (expired) throw Error('INFERENCE_METADATA_TIMEOUT'); throw error; }
        finally { clearTimeout(timer); signal.removeEventListener('abort', abort); await reader?.cancel().catch(() => {}); }
    }
    private async completion(prompt: string, signal: AbortSignal, schema?: unknown, maxTokens = 128, timeoutMs = 90000): Promise<{
        text: string;
        firstTokenMs: number | null;
        tokens: number | null;
        tps: number | null;
        promptTokens: number | null;
    }> {
        const started = Date.now();
        this.lastMetrics = { state: 'STARTED', startedAt: started, startMs: this.startMs, firstTokenMs: null,
            promptTokens: null, tokenizedPromptTokens: null, outputTokens: null, tps: null, stopType: null, truncated: null,
            contextCapacity: this.contextCapacity, maxOutputTokens: maxTokens, generationMs: null, reason: null };
        const controller = new AbortController(), abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true });
        let expired = false;
        const timer = setTimeout(() => { expired = true; abort(); }, timeoutMs);
        let first: number | null = null, text = '', buffer = '', result: any = null;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            if (!this.process) throw Error('RUNTIME_OFFLINE'); signal.throwIfAborted();
            const wrapped = bootstrapChatPrompt(prompt);
            if (schema) {
                const props = await this.smallJson('/props', controller.signal);
                const capacity = props?.default_generation_settings?.n_ctx;
                if (!Number.isSafeInteger(capacity) || capacity < 1 || this.contextCapacity !== null && capacity > this.contextCapacity) throw Error('CONTEXT_CAPACITY_UNVERIFIED');
                this.contextCapacity = capacity; this.lastMetrics.contextCapacity = capacity;
                const tokenized = await this.smallJson('/tokenize', controller.signal, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: wrapped, add_special: true, parse_special: true, with_pieces: false }) });
                if (!Array.isArray(tokenized.tokens) || tokenized.tokens.some((token: unknown) => !Number.isSafeInteger(token) || Number(token) < 0)) throw Error('TOKENIZER_RESULT_INVALID');
                this.lastMetrics.promptTokens = this.lastMetrics.tokenizedPromptTokens = tokenized.tokens.length;
                if (tokenized.tokens.length + maxTokens > capacity) throw Error('PROMPT_TOKEN_BUDGET');
            }
            signal.throwIfAborted();
            const response = await fetch(this.endpoint + '/completion', { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wrapped, stream: true, n_predict: maxTokens, temperature: 0, cache_prompt: false, ...(schema ? { json_schema: schema } : {}) }) });
            if (!response.ok)
                throw Error('INFERENCE_HTTP_' + response.status);
            if (!response.body) throw Error('INFERENCE_INCOMPLETE');
            reader = response.body.getReader();
            const decoder = new TextDecoder();
            let size = 0;
            while (true) {
                const item = await reader.read();
                if (item.done)
                    break;
                size += item.value.length;
                if (size > 2 * 1024 ** 2)
                    throw Error('INFERENCE_OUTPUT_TOO_LARGE');
                buffer += decoder.decode(item.value, { stream: true });
                let end;
                while ((end = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, end).trim();
                    buffer = buffer.slice(end + 1);
                    if (!line.startsWith('data: '))
                        continue;
                    const data = line.slice(6);
                    if (data === '[DONE]')
                        continue;
                    const event = JSON.parse(data);
                    if (typeof event.content === 'string' && event.content) {
                        first ??= Date.now() - started;
                        this.lastMetrics.firstTokenMs = first;
                        text += event.content;
                    }
                    if (event.stop) {
                        this.captureCompletionMetadata(event);
                        result = event;
                    }
                }
            }
            if (!result || !text.trim())
                throw Error('INFERENCE_INCOMPLETE');
            if (schema && this.lastMetrics.truncated) throw Error('CONTEXT_TRUNCATED');
            if (schema && this.lastMetrics.stopType === 'limit') throw Error('OUTPUT_TOKEN_LIMIT');
            this.lastMetrics.state = 'COMPLETED'; this.lastMetrics.generationMs = Date.now() - started;
            return { text: text.replace(/<think>[\s\S]*?<\/think>/g, '').trim(), firstTokenMs: first, tokens: Number.isInteger(result.timings?.predicted_n) ? result.timings.predicted_n : null, tps: Number.isFinite(result.timings?.predicted_per_second) ? result.timings.predicted_per_second : null, promptTokens: Number.isInteger(result.timings?.prompt_n) ? result.timings.prompt_n : null };
        }
        catch (error) {
            const reason = signal.aborted ? 'STOPPED' : expired ? 'INFERENCE_TIMEOUT' : error instanceof Error && /^[A-Z0-9_: -]{1,100}$/.test(error.message) ? error.message : 'INFERENCE_TRANSPORT_FAILED';
            this.lastMetrics.state = signal.aborted ? 'CANCELLED' : 'FAILED'; this.lastMetrics.reason = reason; this.lastMetrics.generationMs = Date.now() - started;
            throw Object.assign(new Error(reason), { inferenceMetrics: this.inferenceMetrics() });
        }
        finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            await reader?.cancel().catch(() => { });
        }
    }
    async generateJson(prompt: string, signal: AbortSignal, schema: unknown, policy?: BootstrapInferencePolicy): Promise<string> {
        this.lastMetrics = null; validateBootstrapInferencePolicy(policy);
        if (prompt.length > (policy?.contextTokens === 4096 ? 16000 : 5000)) throw Error('PATCH_CONTEXT_LIMIT');
        return (await this.completion(prompt, signal, schema, policy?.maxOutputTokens ?? 512, policy?.timeoutMs ?? 90000)).text;
    }
    async generate(prompt: string, signal: AbortSignal, context?:string): Promise<string> {
        this.lastMetrics = null;
        const input=context?`JARVIS public task context, not authority${context.length>3000?' (bounded excerpt)':''}:\n${context.slice(0,3000)}\n\nLatest user request:\n${prompt}`:prompt;
        return (await this.completion(input, signal)).text;
    }
    async probe(signal: AbortSignal): Promise<Probe> {
        const started = Date.now();
        const schema = { type: 'object', properties: { ok: { type: 'boolean' }, n: { type: 'integer' } }, required: ['ok', 'n'], additionalProperties: false };
        const a = await this.completion('Compute 2 + 5. Return exactly the JSON object {"ok":true,"n":7}.', signal, schema);
        const b = await this.completion('Compute 3 + 4. Return exactly the JSON object {"ok":true,"n":7}.', signal, schema);
        const check = (s: string) => { try {
            const x = JSON.parse(s);
            return x.ok === true && x.n === 7 && Object.keys(x).length === 2;
        }
        catch {
            return false;
        } };
        const correct = check(a.text), stable = check(b.text), slow = (b.firstTokenMs ?? Infinity) > 10000 || (b.tps !== null && b.tps < 3);
        return { correct, stable, latencyMs: Date.now() - started, startMs: this.startMs, firstTokenMs: b.firstTokenMs, tokensPerSecond: b.tps, outputTokens: b.tokens, ramBytes: null, vramBytes: null, contextTested: b.promptTokens ?? 0, at: Date.now(), rating: !correct || !stable ? 'FAILED' : slow ? 'SLOW' : 'USABLE', error: !correct || !stable ? 'FINITE_PROBE_FAILED' : null };
    }
    async stop(): Promise<void> { const p = this.process; this.process = null; if (p)
        await p.killTree(); }
}
