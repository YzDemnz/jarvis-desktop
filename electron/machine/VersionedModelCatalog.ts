import fs from 'node:fs';
import type { LocalModelEntry } from '../../src/types';
import { CATALOG_VERSION, LOCAL_MODEL_CATALOG } from '../../src/machine/catalog/localModelCatalog';

export interface CatalogRecord extends LocalModelEntry {
  catalogVersion: number; architecture: string | null; quantizationOptions: string[];
  audio: boolean | null; video: boolean | null; toolCalling: boolean | null; agentic: boolean | null;
  license: string | null; minimumRamBytes: number | null; recommendedRamBytes: number | null;
  minimumVramBytes: number | null; recommendedVramBytes: number | null;
  qualityTier: string | null; routingSuitability: string[]; knownLimitations: string[];
}

/** A user-data JSON catalog can supersede built-ins after validation, without an app rebuild. */
export class VersionedModelCatalog {
  constructor(private readonly updateFile: string) {}
  load(): { version: number; entries: CatalogRecord[]; source: 'builtin' | 'user-data'; error: string | null } {
    const builtin = LOCAL_MODEL_CATALOG.map((entry): CatalogRecord => ({ ...entry, catalogVersion: CATALOG_VERSION,
      architecture: null, quantizationOptions: [entry.quantization], audio: null, video: null, toolCalling: null,
      agentic: null, license: null, minimumRamBytes: entry.estimatedRamBytes, recommendedRamBytes: null,
      minimumVramBytes: entry.estimatedVramBytes, recommendedVramBytes: null, qualityTier: null,
      routingSuitability: [], knownLimitations: ['Aptitudes estimadas; ejecutar benchmark local antes de enrutar automáticamente.'] }));
    if (!fs.existsSync(this.updateFile)) return { version: CATALOG_VERSION, entries: builtin, source: 'builtin', error: null };
    try {
      if (fs.statSync(this.updateFile).size > 5 * 1024 * 1024) throw new Error('Catalog update too large');
      const parsed: unknown = JSON.parse(fs.readFileSync(this.updateFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid catalog object');
      const value = parsed as { version?: unknown; entries?: unknown };
      if (!Number.isInteger(value.version) || (value.version as number) <= CATALOG_VERSION || !Array.isArray(value.entries)) throw new Error('Catalog version or entries invalid');
      const entries = value.entries as CatalogRecord[];
      if (entries.length > 1000 || entries.some((e) => !e || typeof e.id !== 'string' || !Array.isArray(e.runtimes) || !Array.isArray(e.quantizationOptions) || typeof e.contextWindow !== 'number')) throw new Error('Invalid catalog entry');
      return { version: value.version as number, entries, source: 'user-data', error: null };
    } catch (error) {
      return { version: CATALOG_VERSION, entries: builtin, source: 'builtin', error: error instanceof Error ? error.message : String(error) };
    }
  }
}
