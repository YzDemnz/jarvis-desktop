export interface ExternalComponent {
  component: string; installedVersion: string; testedVersion: string;
  protocolVersion: string; compatibleRange: string; lastSuccessfulValidation: string | null;
}
/** Detection only. Exact compatibility until a range is actually validated. */
export class ExternalComponentRegistry {
  private entries = new Map<string, ExternalComponent>();
  register(entry: ExternalComponent): void { this.entries.set(entry.component, { ...entry }); }
  compatible(id: string): boolean { const e = this.entries.get(id); return !!e && e.installedVersion === e.testedVersion; }
  validated(id: string): void { if (!this.compatible(id)) throw new Error('Version mismatch'); this.entries.get(id)!.lastSuccessfulValidation = new Date().toISOString(); }
  list(): ExternalComponent[] { return [...this.entries.values()].map(e => ({ ...e })); }
}
