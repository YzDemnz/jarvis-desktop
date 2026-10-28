export interface Workspace {
  id: string;
  name: string;
  accent: string;
  description: string;
  pinnedModules: string[];
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  language?: string;
  branch?: string;
  dirtyFiles: number;
  lastOpened: number;
}
