import { shell } from 'electron';
import type { TrashPort } from '../../src/dev/ports';

/** The real Windows Recycle Bin (macOS Trash, freedesktop trash on Linux). */
export class ElectronTrashPort implements TrashPort {
  readonly native = true;
  async trash(p: string) { await shell.trashItem(p); }
}
