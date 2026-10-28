import type { ArchiveCandidate, FileNode, StorageVolume, SyncTarget } from '@/types';

const now = Date.now();
const day = 86_400_000;

export const mockTree: FileNode[] = [
  {
    id: 'd-projects', name: 'Projects', path: 'D:\\Projects', kind: 'folder', bytes: 0, modified: now - day,
    children: [
      {
        id: 'd-vigilia', name: 'Vigilia', path: 'D:\\Projects\\Vigilia', kind: 'folder', bytes: 0, modified: now - 3600_000,
        children: [
          { id: 'f-pkg', name: 'package.json', path: 'D:\\Projects\\Vigilia\\package.json', kind: 'data', bytes: 2418, modified: now - 3600_000 },
          { id: 'f-cfg', name: 'config.json', path: 'D:\\Projects\\Vigilia\\config.json', kind: 'data', bytes: 891, modified: now - day * 2 },
          { id: 'f-idx', name: 'index.ts', path: 'D:\\Projects\\Vigilia\\src\\index.ts', kind: 'code', bytes: 14_302, modified: now - 7200_000 },
          { id: 'f-readme', name: 'README.md', path: 'D:\\Projects\\Vigilia\\README.md', kind: 'document', bytes: 5120, modified: now - day * 4 },
        ],
      },
      { id: 'd-old', name: 'OldBuilds', path: 'D:\\Projects\\OldBuilds', kind: 'folder', bytes: 0, modified: now - day * 210, children: [] },
      { id: 'd-quant', name: 'Quant', path: 'D:\\Projects\\Quant', kind: 'folder', bytes: 0, modified: now - day * 3, children: [] },
    ],
  },
  {
    id: 'd-docs', name: 'Documentos', path: 'D:\\Documentos', kind: 'folder', bytes: 0, modified: now - day * 6,
    children: [
      { id: 'f-contrato', name: 'Contrato-marco.pdf', path: 'D:\\Documentos\\Contrato-marco.pdf', kind: 'document', bytes: 1_204_992, modified: now - day * 6 },
      { id: 'f-notas', name: 'Notas NVIDIA.md', path: 'D:\\Documentos\\Notas NVIDIA.md', kind: 'document', bytes: 8_190, modified: now - day * 1 },
    ],
  },
  {
    id: 'd-media', name: 'Capturas', path: 'D:\\Capturas', kind: 'folder', bytes: 0, modified: now - day * 2,
    children: [
      { id: 'f-shot1', name: 'reforger-config.png', path: 'D:\\Capturas\\reforger-config.png', kind: 'image', bytes: 486_112, modified: now - day * 2 },
      { id: 'f-shot2', name: 'chart-nvda.png', path: 'D:\\Capturas\\chart-nvda.png', kind: 'image', bytes: 312_004, modified: now - 5400_000 },
    ],
  },
];

export const mockVolumes: StorageVolume[] = [
  { id: 'v-ssd', label: 'Local SSD', kind: 'local', usedBytes: 720e9, totalBytes: 1e12, status: 'attention' },
  { id: 'v-cloud', label: 'Cloud', kind: 'cloud', usedBytes: 184e9, status: 'healthy' },
  { id: 'v-archive', label: 'Archived', kind: 'archive', usedBytes: 96e9, status: 'healthy' },
  { id: 'v-sync', label: 'Synced', kind: 'sync', usedBytes: 41e9, status: 'syncing' },
];

export const mockArchiveCandidates: ArchiveCandidate[] = [
  { id: 'a1', name: 'OldBuilds', path: 'D:\\Projects\\OldBuilds', bytes: 62e9, lastTouched: now - day * 210, reason: 'Sin abrir en 7 meses' },
  { id: 'a2', name: 'Renders 2023', path: 'D:\\Media\\Renders2023', bytes: 41e9, lastTouched: now - day * 400, reason: 'Duplicado en Cloud' },
  { id: 'a3', name: 'node_modules cache', path: 'C:\\Users\\me\\AppData\\npm-cache', bytes: 18e9, lastTouched: now - day * 30, reason: 'Regenerable' },
  { id: 'a4', name: 'Reforger backups', path: 'D:\\Servers\\Reforger\\backups', bytes: 11e9, lastTouched: now - day * 90, reason: 'Retención 30 días' },
];

export const mockSyncTargets: SyncTarget[] = [
  { id: 's-gh', label: 'GitHub · jarvis-desktop', kind: 'github', status: 'synced', lastSync: now - 1000 * 60 * 9, pending: 0 },
  { id: 's-cloud', label: 'Cloud storage', kind: 'cloud', status: 'syncing', lastSync: now - 1000 * 60 * 2, pending: 34 },
  { id: 's-db', label: 'Local database', kind: 'database', status: 'pending', lastSync: now - 1000 * 60 * 180, pending: 3 },
  { id: 's-vault', label: 'Vault', kind: 'vault', status: 'error', lastSync: now - 1000 * 60 * 60 * 14, pending: 1, error: 'Master key bloqueada' },
];
