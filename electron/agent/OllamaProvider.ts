export interface OllamaModel {
  name: string;
  size: number;
  family: string;
  parameterSize: string;
  modifiedAt: string;
}

export interface OllamaHealth {
  online: boolean;
  endpoint: string;
  version?: string;
  models: OllamaModel[];
  error?: string;
  checkedAt: number;
}

export interface GenerateInput {
  model: string;
  prompt: string;
  system?: string;
  /** Ollama's own JSON mode. Cheaper and stricter than asking politely. */
  format?: 'json'|Record<string,unknown>;
  temperature?: number;
  think?:boolean;
  contextTokens?:number;
  timeoutMs?: number;
  maxTokens?: number;
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';
const HEALTH_TTL = 15_000;

/**
 * Talks to a local Ollama daemon. Lives in the main process because the
 * renderer's CSP refuses connections to 127.0.0.1, and because nothing that
 * reaches a model should sit in the same place as the UI.
 *
 * Every method resolves even when Ollama is missing: an offline daemon is a
 * normal state, not an error the app should crash on.
 */
export class OllamaProvider {
  private cachedHealth: OllamaHealth | null = null;

  constructor(private readonly endpoint: string = process.env.OLLAMA_HOST ?? DEFAULT_ENDPOINT) {}

  private async request(pathname: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 4000);
    const onAbort = () => controller.abort();
    if (init.signal?.aborted) controller.abort();
    init.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetch(`${this.endpoint}${pathname}`, { ...init, signal: controller.signal, redirect: 'error' });
      // Keep cancellation and timeout effective while consuming the response,
      // not only until headers arrive. Local responses are bounded non-streaming.
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 2 * 1024 * 1024) throw Error('OLLAMA_OUTPUT_TOO_LARGE');
      return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally {
      clearTimeout(timeout); init.signal?.removeEventListener('abort', onAbort);
    }
  }

  async health(force = false): Promise<OllamaHealth> {
    if (!force && this.cachedHealth && Date.now() - this.cachedHealth.checkedAt < HEALTH_TTL) {
      return this.cachedHealth;
    }
    const base: OllamaHealth = { online: false, endpoint: this.endpoint, models: [], checkedAt: Date.now() };
    try {
      const versionResponse = await this.request('/api/version', { timeoutMs: 2500 });
      if (!versionResponse.ok) throw new Error(`HTTP ${versionResponse.status}`);
      const version = (await versionResponse.json()) as { version?: string };
      const models = await this.listModels();
      this.cachedHealth = {
        ...base,
        online: true,
        models,
        ...(version.version ? { version: version.version } : {}),
        checkedAt: Date.now(),
      };
    } catch (error) {
      this.cachedHealth = { ...base, error: describe(error), checkedAt: Date.now() };
    }
    return this.cachedHealth;
  }

  /** Never assume a model name: ask the daemon what it actually has. */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await this.request('/api/tags', { timeoutMs: 3000 });
      if (!response.ok) return [];
      const payload = (await response.json()) as {
        models?: { name?: string; size?: number; modified_at?: string; details?: { family?: string; parameter_size?: string } }[];
      };
      return (payload.models ?? [])
        .filter((m) => typeof m.name === 'string')
        .map((m) => ({
          name: m.name as string,
          size: m.size ?? 0,
          family: m.details?.family ?? 'desconocida',
          parameterSize: m.details?.parameter_size ?? '',
          modifiedAt: m.modified_at ?? '',
        }));
    } catch {
      return [];
    }
  }

  async generate(input: GenerateInput, signal?: AbortSignal): Promise<string> {
    return (await this.generateMeasured(input, signal)).text;
  }
  async generateMeasured(input: GenerateInput, signal?: AbortSignal): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }> {
    const body: Record<string, unknown> = {
      model: input.model,
      prompt: input.prompt,
      stream: false,
      options: { temperature: input.temperature ?? 0, ...(input.maxTokens ? { num_predict: input.maxTokens } : {}),...(input.contextTokens?{num_ctx:input.contextTokens}:{}) },
    };
    if (input.system) body.system = input.system;
    if(input.think!==undefined)body.think=input.think;
    if (input.format) body.format = input.format;

    const response = await this.request('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: input.timeoutMs ?? 20_000,
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Ollama respondió ${response.status}`);
    const payload = (await response.json()) as { response?: string; prompt_eval_count?: number; eval_count?: number };
    return { text: payload.response ?? '', inputTokens: payload.prompt_eval_count ?? null, outputTokens: payload.eval_count ?? null };
  }

  /**
   * Generates and parses JSON. Returns null rather than throwing on malformed
   * output, because a model producing bad JSON is expected, not exceptional —
   * the caller falls back instead of failing.
   */
  async structuredGenerate<T = unknown>(input: GenerateInput, signal?: AbortSignal): Promise<T | null> {
    let raw: string;
    try {
      raw = await this.generate({ ...input, format: 'json' }, signal);
    } catch {
      return null;
    }
    return parseJsonLoose<T>(raw);
  }

  /** First model whose name matches a hint, else the smallest available. */
  pickRouterModel(models: OllamaModel[], preferred?: string): string | null {
    if (!models.length) return null;
    if (preferred) {
      const exact = models.find((m) => m.name === preferred);
      if (exact) return exact.name;
      const partial = models.find((m) => m.name.startsWith(preferred.split(':')[0] ?? preferred));
      if (partial) return partial.name;
    }
    const sorted = [...models].sort((a, b) => a.size - b.size);
    return sorted[0]?.name ?? null;
  }
}

/** Models like to wrap JSON in prose or fences. Dig it out without eval. */
export function parseJsonLoose<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  const withoutFences = raw.replace(/```(?:json)?/gi, '').trim();
  const candidates = [withoutFences];
  const first = withoutFences.indexOf('{');
  const last = withoutFences.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(withoutFences.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed as T;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'Sin respuesta (tiempo agotado).';
    if (/ECONNREFUSED|fetch failed/i.test(error.message)) return 'No hay ningún servicio escuchando en el puerto.';
    return error.message;
  }
  return String(error);
}

export const ollamaProvider = new OllamaProvider();
