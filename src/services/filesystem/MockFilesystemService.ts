import type { FileNode, FilesystemService } from '@/types';
import { mockTree } from '@/mocks/files';

function flatten(nodes: FileNode[], acc: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    acc.push(n);
    if (n.children) flatten(n.children, acc);
  }
  return acc;
}

export const allNodes = flatten(mockTree);

export function findByPath(path: string): FileNode | undefined {
  return allNodes.find((n) => n.path.toLowerCase() === path.toLowerCase());
}

export function childrenOf(path: string): FileNode[] {
  const node = findByPath(path);
  if (node?.children) return node.children;
  return mockTree;
}

export const mockFilesystemService: FilesystemService = {
  async list(path) { return childrenOf(path); },
  async search(query) {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return allNodes.filter((n) => n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)).slice(0, 40);
  },
  async read(path) {
    const node = findByPath(path);
    if (!node) throw new Error(`No existe: ${path}`);
    return `// Vista previa simulada de ${node.name}\n// ${node.bytes} bytes\n`;
  },
  async stat(path) {
    const node = findByPath(path);
    if (!node) throw new Error(`No existe: ${path}`);
    return node;
  },
};
