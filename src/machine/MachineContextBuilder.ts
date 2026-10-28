import type { Capability, ContextTopic, LocalAIState, MachineContext, SystemProfile } from '@/types';
import { pickBestGPU, totalFreeDisk } from './performance';

const GB = 1024 ** 3;
const gb = (bytes: number | null) => (bytes === null ? 'no disponible' : `${(bytes / GB).toFixed(1)} GB`);

/**
 * The agent must not receive the whole SystemProfile on every prompt. It is
 * expensive in tokens and needlessly exposes the machine, so each task gets
 * only the axes it could plausibly use — and a question about a web page gets
 * no hardware at all.
 */
export class MachineContextBuilder {
  topicsFor(prompt: string): ContextTopic[] {
    const text = prompt.toLowerCase();
    const topics = new Set<ContextTopic>();

    if (/\b(modelo|models?|ollama|ia local|local ai|router|inferencia|cuantiza)\b/.test(text)) {
      topics.add('localAI');
      topics.add('hardware');
    }
    if (/\b(hardware|cpu|procesador|ram|memoria|gpu|gr[aá]fica|vram|disco|almacenamiento|rendimiento|fps|optimiza|juego|render)\b/.test(text)) {
      topics.add('hardware');
    }
    if (/\b(archivo|archivos|carpeta|directorio|ruta|busca|encuentra)\b|\.(json|ts|md|csv|pdf|png|zip)\b/.test(text)) {
      topics.add('filesystem');
    }
    if (/\b(p[aá]gina|pesta[nñ]a|navega|url|sitio|resume esta|este sitio)\b|https?:\/\//.test(text)) {
      topics.add('browser');
    }

    return topics.size ? [...topics] : ['none'];
  }

  build(
    prompt: string,
    sources: { profile: SystemProfile | null; localAI: LocalAIState | null; capabilities: Capability[] },
  ): MachineContext {
    const topics = this.topicsFor(prompt);
    const lines: string[] = [];
    const { profile, localAI, capabilities } = sources;

    if (topics.includes('hardware') && profile) {
      const gpu = pickBestGPU(profile);
      lines.push(`CPU: ${profile.cpu.model ?? 'desconocida'} (${profile.cpu.logicalThreads ?? '?'} hilos, ${profile.cpu.architecture}).`);
      lines.push(`Memoria: ${gb(profile.memory.totalBytes)} totales, ${gb(profile.memory.availableBytes)} libres.`);
      lines.push(gpu
        ? `GPU: ${gpu.model ?? gpu.vendor} con ${gb(gpu.vramBytes)} de VRAM.`
        : 'GPU: ninguna detectada.');
      const free = totalFreeDisk(profile);
      lines.push(`Disco libre: ${free === null ? 'no disponible' : `${free.toFixed(0)} GB`}.`);
    }

    if (topics.includes('localAI')) {
      if (!localAI || localAI.status === 'NOT_CONFIGURED') {
        lines.push('IA local: no hay ningún runtime configurado.');
      } else {
        const active = localAI.runtimes.find((r) => r.runtimeId === localAI.activeRuntimeId);
        lines.push(`IA local: ${active?.name ?? 'runtime'} en estado ${localAI.status}, ${active?.models.length ?? 0} modelos instalados.`);
        if (localAI.routerModelId) lines.push(`Router local: ${localAI.routerModelId}.`);
      }
    }

    if (topics.includes('filesystem')) {
      const fs = capabilities.filter((c) => c.id.startsWith('filesystem.'));
      const usable = fs.filter((c) => c.state === 'AVAILABLE').map((c) => c.id);
      lines.push(usable.length
        ? `Capacidades de archivos disponibles: ${usable.join(', ')}.`
        : 'Capacidades de archivos: ninguna disponible con el permiso actual.');
    }

    if (topics.includes('browser')) {
      const browser = capabilities.filter((c) => c.id.startsWith('browser.') && c.state === 'AVAILABLE');
      lines.push(browser.length
        ? `Capacidades de navegador disponibles: ${browser.map((c) => c.id).join(', ')}.`
        : 'Capacidades de navegador: ninguna disponible con el permiso actual.');
    }

    const text = lines.join(' ');
    return { topics, lines, approxTokens: Math.ceil(text.length / 4) };
  }
}

export const machineContextBuilder = new MachineContextBuilder();
