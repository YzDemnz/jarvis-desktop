import type { Technology } from '@/types';

export interface TechnologyReport { technologies: Technology[]; type: string; markers: string[] }

const MARKER_FILES = [
  'package.json', 'tsconfig.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', 'Cargo.toml',
  'go.mod', 'CMakeLists.txt', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'deno.json',
];

/** Names in a folder that make it a project, regardless of its folder name. */
export function isProjectMarker(name: string): boolean {
  return MARKER_FILES.includes(name) || /\.(sln|csproj|fsproj|vbproj)$/i.test(name) || name === '.git';
}

/**
 * From the root listing (and package.json, when present) to technologies. A
 * project can be several at once: Electron + React + TypeScript + Vite.
 */
export function detectTechnologies(rootEntries: string[], packageJson?: string | null): TechnologyReport {
  const has = (re: RegExp) => rootEntries.some((n) => re.test(n));
  const tech = new Set<Technology>();
  const markers = rootEntries.filter(isProjectMarker);

  let deps: Record<string, string> = {};
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      deps = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch { /* malformed package.json still marks a Node project */ }
  }
  const dep = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);

  if (has(/^package\.json$/)) { tech.add('node'); tech.add('javascript'); }
  if (has(/^tsconfig(\..+)?\.json$/) || dep('typescript')) tech.add('typescript');
  if (has(/^vite\.config\.(ts|js|mjs|cjs)$/) || dep('vite')) tech.add('vite');
  if (dep('electron')) tech.add('electron');
  if (dep('react')) tech.add('react');
  if (dep('next') || has(/^next\.config\./)) tech.add('nextjs');
  if (dep('tailwindcss') || has(/^tailwind\.config\./)) tech.add('tailwind');
  if (has(/^(pyproject\.toml|requirements.*\.txt|setup\.py|Pipfile)$/)) tech.add('python');
  if (has(/^Cargo\.toml$/)) tech.add('rust');
  if (has(/^go\.mod$/)) tech.add('go');
  if (has(/\.(sln|csproj|fsproj|vbproj)$/i)) tech.add('dotnet');
  if (has(/^(pom\.xml|build\.gradle(\.kts)?)$/)) tech.add('java');
  if (has(/^CMakeLists\.txt$/)) { tech.add('cmake'); tech.add('cpp'); }

  const order: [Technology, string][] = [
    ['electron', 'Electron'], ['nextjs', 'Next.js'], ['react', 'React'], ['typescript', 'TypeScript'], ['node', 'Node.js'],
    ['rust', 'Rust'], ['go', 'Go'], ['dotnet', '.NET'], ['python', 'Python'], ['java', 'Java'], ['cmake', 'C/C++ (CMake)'],
  ];
  const type = order.find(([t]) => tech.has(t))?.[1] ?? (markers.includes('.git') ? 'Repositorio Git' : 'Carpeta');
  return { technologies: [...tech], type, markers };
}
