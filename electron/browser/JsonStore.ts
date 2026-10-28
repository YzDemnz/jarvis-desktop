import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Small debounced JSON store under userData. Deliberately dumb: browsing data
 * is not worth a database, and keeping it as plain files makes a profile wipe
 * a single unlink.
 */
export class JsonStore<T> {
  private cache: T | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly relativePath: string,
    private readonly fallback: T,
  ) {}

  private get file(): string {
    return path.join(app.getPath('userData'), 'browser', this.relativePath);
  }

  read(): T {
    if (this.cache !== null) return this.cache;
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.cache = JSON.parse(raw) as T;
    } catch {
      this.cache = this.fallback;
    }
    return this.cache;
  }

  write(value: T): void {
    this.cache = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.cache === null) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.cache, null, 2), 'utf8');
    } catch (error) {
      console.error('[browser] no se pudo guardar', this.relativePath, error);
    }
  }
}
