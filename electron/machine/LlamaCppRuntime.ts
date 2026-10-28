import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { InstalledModel, LocalRuntimeCapabilities, RuntimeDetection } from '../../src/types';
import type { LocalAIRuntime } from '../../src/machine/localai/types';

export interface LlamaCppOptions { executable?: string | null; modelDirectory?: string | null; port?: number; fetcher?: typeof fetch; }
export interface LlamaCppProbe { installed: boolean; executable: string | null; version: string | null; backends: string[]; gpuAvailable: boolean | null; }

/** Only a server started by this instance may be stopped by this instance. */
export class LlamaCppRuntime implements LocalAIRuntime {
  readonly id = 'llamacpp' as const;
  readonly name = 'llama.cpp';
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly logLines: string[] = [];
  private readonly port: number;
  private readonly fetcher: typeof fetch;
  private readonly executable: string | null;

  constructor(private readonly options: LlamaCppOptions = {}) {
    this.port = options.port ?? 18080;
    this.fetcher = options.fetcher ?? fetch;
    this.executable = options.executable ?? process.env.JARVIS_LLAMA_CPP_SERVER ?? this.findOnPath();
  }
  private findOnPath(): string | null {
    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = spawnSync(command, ['llama-server'], { encoding: 'utf8', timeout: 2000, windowsHide: true });
    const candidate = result.status === 0 ? result.stdout.split(/\r?\n/)[0]?.trim() : null;
    return candidate && fs.existsSync(candidate) ? candidate : null;
  }
  capabilities(): LocalRuntimeCapabilities {
    // GPU support depends on the exact executable build; do not infer it from vendor.
    return { structuredOutput: true, streaming: true, embeddings: false, acceleration: ['cpu'] };
  }
  probe(): LlamaCppProbe {
    if (!this.executable || !fs.existsSync(this.executable)) return { installed: false, executable: null, version: null, backends: [], gpuAvailable: null };
    const result = spawnSync(this.executable, ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    const backends = [...output.matchAll(/\b(CPU|Vulkan|CUDA|HIP|ROCm|Metal)\b/gi)].map((m) => (m[1] ?? '').toUpperCase()).filter(Boolean);
    const unique = [...new Set(backends)];
    return { installed: true, executable: this.executable, version: output.split(/\r?\n/)[0]?.slice(0, 160) || null,
      backends: unique, gpuAvailable: unique.some((b) => b !== 'CPU') || (unique.length ? false : null) };
  }
  async getVersion(): Promise<string | null> { return this.probe().version; }
  private get endpoint(): string { return `http://127.0.0.1:${this.port}`; }
  async health(signal?: AbortSignal): Promise<{ online: boolean; version: string | null; error: string | null }> {
    try {
      const response = await this.request('/health', { method: 'GET' }, signal, 3000);
      if (!response.ok) return { online: false, version: await this.getVersion(), error: `HTTP ${response.status}` };
      return { online: true, version: await this.getVersion(), error: null };
    } catch (error) { return { online: false, version: await this.getVersion(), error: error instanceof Error ? error.message : String(error) }; }
  }
  async detect(signal?: AbortSignal): Promise<RuntimeDetection> {
    const probe = this.probe();
    const base: RuntimeDetection = { runtimeId: this.id, name: this.name, detected: probe.installed,
      status: probe.installed ? 'OFFLINE' : 'NOT_CONFIGURED', endpoint: probe.installed ? this.endpoint : null,
      version: probe.version, models: [], capabilities: this.capabilities(), error: null, checkedAt: Date.now() };
    if (!probe.installed) return base;
    const health = await this.health(signal);
    const models = await this.listModels(signal);
    return { ...base, status: health.online ? (models.length ? 'READY' : 'NO_MODELS') : 'OFFLINE',
      models, error: health.error };
  }
  async listModels(signal?: AbortSignal): Promise<InstalledModel[]> {
    try {
      const response = await this.request('/v1/models', { method: 'GET' }, signal, 3000);
      if (!response.ok) return [];
      const value = await response.json() as { data?: { id?: string }[] };
      return (value.data ?? []).filter((m) => !!m.id).slice(0, 100).map((m) => ({ id: `llamacpp:${m.id}`,
        runtimeId: this.id, name: m.id!, family: null, parameterSize: null, quantization: null, diskBytes: null }));
    } catch { return []; }
  }
  async start(config: { modelPath: string; context: number; gpuLayers: number; threads: number }, signal?: AbortSignal): Promise<void> {
    if (this.child) throw new Error('llama.cpp server already managed');
    if (!this.executable || !fs.existsSync(this.executable)) throw new Error('llama-server not installed');
    if ((await this.health()).online) throw new Error('llama.cpp port is already in use by an unmanaged server');
    const model = path.resolve(config.modelPath);
    if (!model.toLowerCase().endsWith('.gguf') || !fs.statSync(model).isFile()) throw new Error('Expected an existing GGUF model');
    if (this.options.modelDirectory && !model.toLowerCase().startsWith(path.resolve(this.options.modelDirectory).toLowerCase() + path.sep)) throw new Error('Model outside configured directory');
    const bounded = (value: number, min: number, max: number) => { if (!Number.isInteger(value) || value < min || value > max) throw new Error('Unsafe llama.cpp configuration'); return value; };
    const args = ['-m', model, '--host', '127.0.0.1', '--port', String(this.port), '-c', String(bounded(config.context, 512, 262144)),
      '-ngl', String(bounded(config.gpuLayers, 0, 999)), '-t', String(bounded(config.threads, 1, 256))];
    const child = spawn(this.executable, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const log = (chunk: Buffer) => { this.logLines.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean)); this.logLines.splice(0, Math.max(0, this.logLines.length - 200)); };
    child.stdout.on('data', log); child.stderr.on('data', log);
    child.once('exit', () => { if (this.child === child) this.child = null; });
    signal?.addEventListener('abort', () => { void this.stop(); }, { once: true });
    for (let i = 0; i < 100; i++) {
      if (signal?.aborted) throw new Error('Cancelled');
      if (child.exitCode !== null) throw new Error(`llama-server exited: ${this.logs().slice(-500)}`);
      if ((await this.health(signal)).online) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await this.stop();
    throw new Error('llama-server health timeout');
  }
  async stop(): Promise<void> {
    const child = this.child;
    if (!child?.pid) return;
    this.child = null;
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    else child.kill('SIGTERM');
  }
  logs(): string { return this.logLines.slice(-200).join('\n'); }
  telemetry(): { pid: number | null; rssBytes: number | null; cpuPercent: number | null; vramBytes: number | null } {
    return { pid: this.child?.pid ?? null, rssBytes: null, cpuPercent: null, vramBytes: null };
  }
  async generate(input: { model: string; prompt: string; system?: string; json?: boolean }, signal?: AbortSignal): Promise<string> {
    const response = await this.request('/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: input.model, stream: false, messages: [...(input.system ? [{ role: 'system', content: input.system }] : []), { role: 'user', content: input.prompt }],
        ...(input.json ? { response_format: { type: 'json_object' } } : {}) }) }, signal, 120000);
    if (!response.ok) throw new Error(`llama.cpp HTTP ${response.status}`);
    const value = await response.json() as { choices?: { message?: { content?: string } }[] };
    return value.choices?.[0]?.message?.content ?? '';
  }
  async *stream(input: { model: string; prompt: string; system?: string; json?: boolean }, signal?: AbortSignal): AsyncIterable<string> {
    const response = await this.request('/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: input.model, stream: true, messages: [...(input.system ? [{ role: 'system', content: input.system }] : []), { role: 'user', content: input.prompt }],
        ...(input.json ? { response_format: { type: 'json_object' } } : {}) }) }, signal, 120000);
    if (!response.ok || !response.body) throw new Error(`llama.cpp HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        pending += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let end: number;
        while ((end = pending.indexOf('\n\n')) >= 0) {
          const event = pending.slice(0, end); pending = pending.slice(end + 2);
          for (const line of event.split(/\r?\n/)) if (line.startsWith('data: ')) {
            const data = line.slice(6); if (data === '[DONE]') return;
            const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
            const content = parsed.choices?.[0]?.delta?.content; if (content) yield content;
          }
        }
      }
    } finally { await reader.cancel().catch(() => {}); }
  }
  private async request(route: string, init: RequestInit, signal?: AbortSignal, timeout = 30000): Promise<Response> {
    if (signal?.aborted) throw new Error('Cancelled');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    try { return await this.fetcher(`${this.endpoint}${route}`, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
}
