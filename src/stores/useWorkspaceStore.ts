import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { mockProjects, mockWorkspaces } from '@/mocks/workspaces';
import type { Project, Workspace } from '@/types';

interface WorkspaceState {
  workspaces: Workspace[];
  projects: Project[];
  activeId: string;
  setActive: (id: string) => void;
  active: () => Workspace;
  projectsFor: (workspaceId?: string) => Project[];
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: mockWorkspaces,
      projects: mockProjects,
      activeId: mockWorkspaces[0]!.id,
      // Refusing unknown ids keeps every consumer's lookup total.
      setActive: (activeId) => {
        if (!get().workspaces.some((w) => w.id === activeId)) return;
        set({ activeId });
      },
      active: () => get().workspaces.find((w) => w.id === get().activeId) ?? get().workspaces[0]!,
      projectsFor: (workspaceId) => {
        const id = workspaceId ?? get().activeId;
        const own = get().projects.filter((p) => p.workspaceId === id);
        return own.length ? own : get().projects;
      },
    }),
    { name: 'jarvis.workspace', partialize: (s) => ({ activeId: s.activeId }) },
  ),
);
