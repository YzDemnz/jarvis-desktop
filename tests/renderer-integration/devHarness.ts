/**
 * Developer agent for the Chromium harness: the production DevService over
 * in-memory ports with Windows path semantics. Commands are scripted but their
 * outcome depends on the real in-memory file contents, so a JARVIS fix really
 * turns `npm test` green; `git status` is computed against a seeded HEAD.
 */
import { DevService } from '@/dev/DevService';
import { MemoryFsPort, MemorySnapshotPort, MemoryTrashPort } from '@/dev/memoryPorts';
import { ScriptedProcessPort } from '@/dev/scriptedProcess';
import type { ScriptedResponse } from '@/dev/scriptedProcess';
import { ScriptedProposer, noProposer } from '@/dev/coding';
import type { ProposalInput } from '@/dev/coding';
import { MemoryConfigPort } from '@/dev/ProjectService';
import { useLocalDevService } from '@/services/dev/devController';
import { setMaxRepairIterations, setPatchProposer } from '@/services/agent/runtime';
import { useJarvisStore } from '@/stores/useJarvisStore';

const ROOT = 'D:\\Projects';
const APP = `${ROOT}\\vigilia-app`;
const BUGGY = 'export const sum = (a: number, b: number) => a - b;\n';
const CLEAN = `${ROOT}\\clean-lib`;

const committed: Record<string, string> = {
  [`${APP}\\package.json`]: JSON.stringify({ name: 'vigilia-app', scripts: { typecheck: 'tsc --noEmit', test: 'node test.js', dev: 'vite' }, devDependencies: { typescript: '5.6.0', vite: '5.4.0', react: '18.3.0' } }, null, 2) + '\n',
  [`${APP}\\tsconfig.json`]: '{ "compilerOptions": { "strict": true } }\n',
  [`${APP}\\src\\math.ts`]: BUGGY,
  [`${APP}\\src\\browser\\TabManager.ts`]: 'export class TabManager {\n  open(url: string) {\n    return url;\n  }\n}\n',
  [`${APP}\\src\\App.tsx`]: "import { TabManager } from './browser/TabManager';\nexport function App() {\n  return new TabManager().open('about:blank');\n}\n",
  [`${APP}\\test.js`]: "const { sum } = require('./src/math');\n",
  [`${APP}\\README.md`]: '# Vigilia\n',
  [`${APP}\\.env`]: 'API_URL=http://localhost\nAPI_KEY=sk-live-harness-0123456789\n',
  [`${APP}\\.git\\HEAD`]: 'ref: refs/heads/main\n',
  ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`${APP}\\src\\mods\\m${i}.ts`, `export const v${i} = ${i};\n`])),
  [`${CLEAN}\\package.json`]: JSON.stringify({ name: 'clean-lib', scripts: { test: 'node t.js' } }) + '\n',
  [`${CLEAN}\\index.js`]: 'module.exports = 1;\n',
  [`${CLEAN}\\.git\\HEAD`]: 'ref: refs/heads/main\n',
};
const REPOS = [APP, CLEAN];

export function createDevHarness() {
  const fs = new MemoryFsPort('win32', committed);
  // The user's work before JARVIS: README edited, notes.md untracked.
  fs.seed(`${APP}\\README.md`, '# Vigilia\n\nNotas del usuario sin commitear.\n');
  fs.seed(`${APP}\\notes.md`, 'borrador\n');
  fs.seed(`${ROOT}\\reforger-tools\\pyproject.toml`, '[project]\nname = "reforger-tools"\n');
  fs.seed(`${ROOT}\\reforger-tools\\tool.py`, 'print("ok")\n');
  // A large project for explorer performance.
  for (let i = 0; i < 1500; i++) fs.seed(`${ROOT}\\monorepo\\src\\gen\\file${String(i).padStart(4, '0')}.ts`, `export const g${i} = ${i};\n`);
  fs.seed(`${ROOT}\\monorepo\\package.json`, JSON.stringify({ name: 'monorepo' }));

  const state = { tests: 'normal' as 'normal' | 'slow' | 'long', calls: [] as string[] };

  const gitStatus = (root: string): string => {
    const head = Object.keys(committed).filter((p) => p.toLowerCase().startsWith(root.toLowerCase() + '\\') && !p.includes('\\.git\\'));
    const now = fs.filesUnder(root).filter((p) => !p.includes('\\.git\\'));
    const rel = (p: string) => p.slice(root.length + 1).replace(/\\/g, '/');
    const out: string[] = ['## main'];
    for (const p of head) {
      const cur = fs.text(p);
      if (cur === null) out.push(` D ${rel(p)}`);
      else if (cur !== committed[p]) out.push(` M ${rel(p)}`);
    }
    for (const p of now) if (!head.some((h) => h.toLowerCase() === p.toLowerCase())) out.push(`?? ${rel(p)}`);
    return out.join('\0') + '\0';
  };

  const port = new ScriptedProcessPort(({ command, cwd }): ScriptedResponse | null => {
    state.calls.push(command);
    if (/ --version$| version$| -version$/.test(command)) return { stdout: '1.0.0\n' };
    const repo = REPOS.find((r) => cwd.toLowerCase().startsWith(r.toLowerCase()));
    if (command.startsWith('git ') && !repo) return { stderr: 'fatal: not a git repository\n', code: 128 };
    if (command.startsWith('git status')) return { stdout: gitStatus(repo!) };
    if (command.startsWith('git diff')) return { stdout: '' };
    if (command.startsWith('git log')) return { stdout: 'abc123\x1fana\x1f2026-09-20\x1finit' };
    if (command.startsWith('git branch')) return { stdout: 'main\n' };
    if (command === 'npm run typecheck') return { stdout: 'tsc --noEmit\n', code: 0 };
    if (command === 'npm test') {
      if (state.tests === 'slow') return { stdout: 'ejecutando pruebas…\n', forever: true };
      const math = fs.text(`${APP}\\src\\math.ts`) ?? '';
      const got = math.includes('a + b') ? 5 : math.includes('a * b') ? 6 : -1;
      const noise = state.tests === 'long' ? Array.from({ length: 5000 }, (_, i) => `  · caso ${i} ok\n`) : [];
      return got === 5
        ? { stdout: [...noise, '✓ 3 pruebas pasaron\n'], code: 0, delayMs: 60 }
        : { stdout: [...noise, `✗ sum(2, 3) debería ser 5, dio ${got}\n`], code: 1, delayMs: 60 };
    }
    if (command === 'npm run dev') return { stdout: ['VITE listo en http://localhost:5173\n'], forever: true };
    return null;
  }, ['node', 'npm', 'npx', 'git', 'python'], 'win32');

  const snapshots = new MemorySnapshotPort();
  const service = new DevService({
    fs, trash: new MemoryTrashPort(fs, 'D:\\$Recycle.Bin.harness'), snapshots, processes: port,
    config: new MemoryConfigPort(), home: 'C:\\Users\\ana', massLimits: { maxFiles: 4, maxBytes: 100 * 1048576, maxTrash: 10 },
  });

  const fixFrom = (input: ProposalInput) => (input.context.files.find((f) => f.path === 'src/math.ts')?.content.includes('a * b') ? 'a * b' : 'a - b');
  const proposers = {
    fix: () => new ScriptedProposer((input) => ({ rationale: 'sum debe sumar', edits: [{ path: 'src/math.ts', ops: [{ kind: 'edit', edit: { oldText: fixFrom(input), newText: 'a + b' } }] }] })),
    repair: () => new ScriptedProposer((input) => ({ rationale: input.attempt === 1 ? 'Primer intento' : 'Corrección tras ver el fallo', edits: [{ path: 'src/math.ts', ops: [{ kind: 'edit', edit: { oldText: fixFrom(input), newText: input.attempt === 1 ? 'a * b' : 'a + b' } }] }] })),
    never: () => new ScriptedProposer((input) => ({ rationale: 'otro intento', edits: [{ path: 'src/math.ts', ops: [{ kind: 'replace', startLine: 1, endLine: 1, text: `export const sum = (a: number, b: number) => a * b + ${input.attempt};` }] }] })),
    mass: () => new ScriptedProposer(() => ({ rationale: 'renombrar en todos los módulos', edits: Array.from({ length: 5 }, (_, i) => ({ path: `src/mods/m${i}.ts`, ops: [{ kind: 'edit' as const, edit: { oldText: `= ${i};`, newText: `= ${i + 100};` } }] })) })),
    none: () => noProposer,
    // Pauses the run from inside the proposal: the patch must not land until RESUME.
    pause: () => new ScriptedProposer((input) => { useJarvisStore.getState().pause(); return { rationale: 'sum debe sumar', edits: [{ path: 'src/math.ts', ops: [{ kind: 'edit', edit: { oldText: fixFrom(input), newText: 'a + b' } }] }] }; }),
  };

  return {
    fs, service, port, state, snapshots, APP, BUGGY, CLEAN,
    async install() {
      // Roots first, then the swap: views already mounted refresh on the swap
      // and must find the projects.
      await service.init();
      await service.projects.addRoot(ROOT);
      const controller = useLocalDevService(service);
      setPatchProposer(proposers.fix());
      return controller !== null;
    },
    setProposer(mode: keyof typeof proposers) { setPatchProposer(proposers[mode]()); },
    setMaxRepair(n: number) { setMaxRepairIterations(n); },
    setTests(mode: 'normal' | 'slow' | 'long') { state.tests = mode; },
    text: (p: string) => fs.text(p),
    userEdit: (p: string, content: string) => fs.userEdit(p, content),
    vanish: (p: string) => fs.vanish(p),
  };
}
