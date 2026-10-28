import type { Bounds, VisionElement, VisionObservation, VisionRef } from '@/types';

/**
 * Vision is a provider seam, not an integration. Nothing here is bound to a
 * vendor: a local multimodal model and a cloud API implement the same
 * interface, and the rest of the app never learns which one answered.
 */
export interface VisionProvider {
  readonly id: string;
  readonly local: boolean;
  available(): Promise<boolean>;
  analyze(input: { image: string; mimeType: string; task: string }, signal: AbortSignal): Promise<{
    elements: { label: string; bounds: Bounds; confidence: number }[];
    summary: string | null;
  }>;
}

/** Declared so the day a provider lands, no caller changes. */
export class NullVisionProvider implements VisionProvider {
  readonly id = 'none';
  readonly local = true;
  async available() { return false; }
  async analyze(): Promise<never> { throw new Error('No hay ningún proveedor de visión configurado.'); }
}

const MIN_CONFIDENCE = 0.5;

export class VisionService {
  private refs = new Map<VisionRef, VisionElement>();
  private next = 1;

  constructor(private provider: VisionProvider = new NullVisionProvider()) {}
  useProvider(provider: VisionProvider): void { this.provider = provider; this.refs.clear(); }

  get providerId(): string { return this.provider.id; }
  available(): Promise<boolean> { return this.provider.available().catch(() => false); }

  /**
   * Low-confidence detections are dropped rather than handed to the agent as
   * facts; a 30% guess at "Save" is how a click lands on "Delete".
   */
  async analyze(image: string, task: string, signal: AbortSignal): Promise<VisionObservation> {
    if (signal.aborted) throw new Error('Análisis visual cancelado.');
    const raw = await this.provider.analyze({ image, mimeType: 'image/png', task }, signal);
    if (signal.aborted) throw new Error('Análisis visual cancelado.');
    this.refs.clear();
    const elements = raw.elements
      .filter((e) => e.confidence >= MIN_CONFIDENCE && e.bounds.width > 0 && e.bounds.height > 0)
      .map((e) => {
        const ref = `vision:${this.next++}` as VisionRef;
        const element: VisionElement = { ref, label: e.label, bounds: e.bounds, confidence: e.confidence };
        this.refs.set(ref, element);
        return element;
      });
    return { provider: this.provider.id, elements, summary: raw.summary };
  }

  resolve(ref: string): VisionElement {
    const el = this.refs.get(ref as VisionRef);
    if (!el) throw new Error(`La referencia visual ${ref} ya no es válida. Vuelve a analizar la pantalla.`);
    return el;
  }
}
