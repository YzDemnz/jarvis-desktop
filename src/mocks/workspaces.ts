import type { Project, Workspace } from '@/types';

export const mockWorkspaces: Workspace[] = [
  { id: 'ws-personal', name: 'Personal', accent: '#79A9FF', description: 'Día a día, correo, notas', pinnedModules: ['home', 'browser', 'files'] },
  { id: 'ws-derecho', name: 'Derecho', accent: '#C0A16B', description: 'Expedientes y jurisprudencia', pinnedModules: ['research', 'files'] },
  { id: 'ws-reforger', name: 'Arma Reforger', accent: '#7FA35E', description: 'Servidor, mods, configuración', pinnedModules: ['coding', 'files'] },
  { id: 'ws-vigilia', name: 'Vigilia', accent: '#9B7FD4', description: 'Producto en desarrollo', pinnedModules: ['coding', 'projects'] },
  { id: 'ws-trading', name: 'Trading', accent: '#3FB68B', description: 'Mercados y análisis', pinnedModules: ['markets', 'trading'] },
];

export const mockProjects: Project[] = [
  { id: 'p1', workspaceId: 'ws-vigilia', name: 'Vigilia', path: 'D:\\Projects\\Vigilia', language: 'TypeScript', branch: 'feat/agent-core', dirtyFiles: 7, lastOpened: Date.now() - 1000 * 60 * 42 },
  { id: 'p2', workspaceId: 'ws-reforger', name: 'Servidor Reforger', path: 'D:\\Servers\\Reforger', language: 'C++', branch: 'main', dirtyFiles: 0, lastOpened: Date.now() - 1000 * 60 * 60 * 5 },
  { id: 'p3', workspaceId: 'ws-trading', name: 'Quant Notebooks', path: 'D:\\Projects\\Quant', language: 'Python', branch: 'research', dirtyFiles: 2, lastOpened: Date.now() - 1000 * 60 * 60 * 26 },
  { id: 'p4', workspaceId: 'ws-personal', name: 'JARVIS Desktop', path: 'D:\\Projects\\jarvis-desktop', language: 'TypeScript', branch: 'main', dirtyFiles: 12, lastOpened: Date.now() - 1000 * 60 * 6 },
];
