import type { CommandRisk, CommandVerdict, ProcessRequest } from '@/types';
import type { PathFlavor } from './paths';
import { dirname, isAbsolute, isWithin, normalize, resolve } from './paths';
import { sanitizeText } from '@/machine/CredentialBoundary';

/** Executables the agent may start. Shells are deliberately absent. */
export const ALLOWED_EXECUTABLES = [
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'python', 'python3', 'py', 'pip', 'pip3', 'git',
  'dotnet', 'cargo', 'rustc', 'go', 'java', 'javac', 'cmake', 'tsc',
] as const;

const SHELLS = /^(cmd|powershell|pwsh|bash|sh|zsh|fish|csh|tcsh|ksh|dash|wsl|busybox|env|sudo|runas|doas|start|explorer|rundll32|regsvr32|mshta|wscript|cscript)(\.exe)?$/i;
const SHELL_OPERATOR = /^(&&|\|\||;|\||>|>>|<|&|2>|2>&1|1>)$/;
const SHELL_SYNTAX = /\$\(|`|\$\{/;
/** Characters cmd.exe interprets. .cmd shims on Windows go through it. */
const CMD_META = /[&|<>^%!"\r\n]/;
const SECRET_ENV = /(TOKEN|SECRET|PASSWORD|PASSWD|PWD$|API_?KEY|PRIVATE|CREDENTIAL|AUTH|COOKIE|SESSION)/i;
const LONG_RUNNING_SCRIPTS = /^(dev|start|serve|server|watch|preview|storybook)(:.*)?$/;

export interface PolicyContext {
  accessMode?: 'FULL' | 'RESTRICTED';
  flavor: PathFlavor;
  projectRoot: string | null;
  protectedPaths: string[];
  home: string | null;
  /** Git commits need explicit configuration, not just approval. */
  allowCommit?: boolean;
}

type Rule = { risk: CommandRisk; reason: string; longRunning?: boolean; blocked?: boolean };

const safe = (reason: string): Rule => ({ risk: 'SAFE', reason });
const sens = (reason: string, longRunning = false): Rule => ({ risk: 'SENSITIVE', reason, longRunning });
const destr = (reason: string): Rule => ({ risk: 'DESTRUCTIVE', reason });
const block = (reason: string): Rule => ({ risk: 'CRITICAL', reason, blocked: true });

function exeName(executable: string): string {
  return executable.split(/[\\/]/).pop()!.replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();
}

const isVersion = (args: string[]) => args.length === 1 && /^(--version|-v|-V|version|-version)$/.test(args[0]!);

function gitRule(args: string[], ctx: PolicyContext): Rule {
  if (args.some((a) => /^-c$|^--config-env|^--exec-path|^--upload-pack|^--receive-pack|^-C$|^--git-dir|^--work-tree/.test(a))) {
    return block('Git con -c, -C, --git-dir o rutas de ejecución puede ejecutar comandos arbitrarios.');
  }
  const [sub = '', ...rest] = args;
  if (isVersion(args)) return safe('Versión de Git.');
  switch (sub) {
    case 'status': case 'diff': case 'log': case 'show': case 'rev-parse': case 'ls-files': case 'blame': case 'describe':
      return safe(`git ${sub} sólo lee.`);
    case 'branch':
      if (rest.some((a) => /^(-d|-D|--delete|-m|-M|--move|-f|--force)$/.test(a))) return block('Borrar, forzar o renombrar ramas no está permitido.');
      return rest.length ? sens('Crear una rama.') : safe('Listar ramas.');
    case 'add':
      if (rest.some((a) => /^(-A|--all|\.|\*)$/.test(a))) return sens('git add de todo el árbol; revisa qué entra.');
      return sens('Preparar archivos para commit.');
    case 'restore': case 'checkout':
      if (rest.some((a) => /^(-f|--force|\.)$|^-/.test(a) && !/^(--staged|--worktree|--)$/.test(a))) return block(`git ${sub} con opciones de forzado o sobre todo el árbol descarta trabajo.`);
      if (rest.includes('--staged') && !rest.includes('--worktree')) return sens('Quitar del índice (no toca el disco).');
      return destr(`git ${sub} de archivos descarta cambios del disco.`);
    case 'commit':
      if (!ctx.allowCommit) return block('Los commits requieren habilitarlos en la configuración del proyecto.');
      if (rest.some((a) => /^(--amend|--no-verify|-n)$/.test(a))) return block('commit --amend / --no-verify no están permitidos.');
      return sens('Crear un commit local.');
    case 'stash':
      if (/^(drop|clear|pop)$/.test(rest[0] ?? '')) return block(`git stash ${rest[0]} puede perder trabajo.`);
      return sens('Guardar cambios en el stash.');
    case 'push': case 'fetch': case 'pull': case 'clone': case 'remote': case 'submodule':
      return block(`git ${sub} (acciones remotas) todavía no está disponible.`);
    case 'reset': case 'clean': case 'rebase': case 'filter-branch': case 'filter-repo': case 'gc': case 'prune':
    case 'reflog': case 'update-ref': case 'replace': case 'worktree': case 'config': case 'switch': case 'merge': case 'cherry-pick': case 'revert':
      return block(`git ${sub} no está permitido para el agente.`);
    default:
      return block(`Subcomando de Git no reconocido: ${sub || '(vacío)'}.`);
  }
}

function nodePmRule(pm: string, args: string[]): Rule {
  if (isVersion(args)) return safe(`Versión de ${pm}.`);
  const [sub = '', ...rest] = args;
  switch (sub) {
    case 'test': case 't': return sens('Ejecuta las pruebas del proyecto.');
    case 'run': case 'run-script': {
      const script = rest[0] ?? '';
      if (!script) return safe('Listar scripts.');
      return sens(`Ejecuta el script «${script}» del proyecto.`, LONG_RUNNING_SCRIPTS.test(script) || rest.includes('--watch'));
    }
    case 'start': case 'dev': case 'serve': return sens('Arranca un servidor de desarrollo.', true);
    case 'ls': case 'list': case 'outdated': case 'why': case 'explain': case 'view': case 'info': case 'config':
      return sub === 'config' && rest[0] !== 'get' && rest[0] !== 'list' ? block('Cambiar la configuración de npm no está permitido.') : safe(`${pm} ${sub} sólo lee.`);
    case 'install': case 'i': case 'ci': case 'add':
      return sens(`${pm} ${sub} descarga paquetes y ejecuta sus scripts de instalación.`);
    case 'uninstall': case 'remove': case 'rm': case 'un': case 'prune':
      return destr(`${pm} ${sub} elimina dependencias.`);
    case 'exec': case 'x': case 'dlx': case 'create': case 'init':
      return destr(`${pm} ${sub} descarga y ejecuta código de terceros.`);
    case 'publish': case 'unpublish': case 'login': case 'logout': case 'adduser': case 'token': case 'owner': case 'deprecate': case 'dist-tag': case 'access':
      return block(`${pm} ${sub} actúa sobre el registro remoto; no está permitido.`);
    case 'audit': return rest.includes('fix') ? sens('audit fix modifica dependencias.') : safe('Auditoría de dependencias.');
    default:
      // yarn / pnpm accept a bare script name.
      if (pm !== 'npm' && /^[\w:.-]+$/.test(sub)) return sens(`Ejecuta el script «${sub}».`, LONG_RUNNING_SCRIPTS.test(sub));
      return block(`Subcomando no reconocido: ${pm} ${sub}.`);
  }
}

function rule(name: string, args: string[], ctx: PolicyContext): Rule {
  switch (name) {
    case 'git': return gitRule(args, ctx);
    case 'npm': case 'pnpm': case 'yarn': return nodePmRule(name, args);
    case 'npx':
      if (args.includes('--no-install') || args[0] === '--no') return sens('npx con un binario ya instalado en el proyecto.');
      return destr('npx sin --no-install puede descargar y ejecutar un paquete arbitrario.');
    case 'tsc': return sens('Compilador de TypeScript.', args.includes('--watch') || args.includes('-w'));
    case 'node':
      if (isVersion(args)) return safe('Versión de Node.');
      if (args.some((a) => /^(-e|--eval|-p|--print|-r|--require|--import|--loader|--experimental-loader)$/.test(a))) return destr('Código en línea o módulos precargados: se revisa antes de ejecutarlo.');
      if (!args.length) return block('node sin script abriría una consola interactiva.');
      return sens('Ejecuta un script del proyecto.', args.includes('--watch'));
    case 'python': case 'python3': case 'py': {
      if (isVersion(args)) return safe('Versión de Python.');
      if (args.includes('-c')) return destr('Código Python en línea: se revisa antes de ejecutarlo.');
      const m = args.indexOf('-m');
      if (m >= 0) {
        const mod = args[m + 1] ?? '';
        if (mod === 'pip') return rule('pip', args.slice(m + 2), ctx);
        if (/^(pytest|unittest|compileall|mypy|ruff|flake8|pylint|black|isort|py_compile|doctest)$/.test(mod)) return sens(`python -m ${mod}.`);
        if (/^(http\.server|flask|uvicorn|django)$/.test(mod)) return sens(`python -m ${mod} (servidor).`, true);
        return destr(`python -m ${mod}: módulo no reconocido.`);
      }
      if (!args.length) return block('python sin script abriría una consola interactiva.');
      return sens('Ejecuta un script Python del proyecto.');
    }
    case 'pip': case 'pip3': {
      const sub = args[0] ?? '';
      if (isVersion(args) || /^(list|show|freeze|check)$/.test(sub)) return safe(`pip ${sub} sólo lee.`);
      if (sub === 'install') return sens('pip install descarga paquetes.');
      if (sub === 'uninstall') return destr('pip uninstall elimina paquetes.');
      return block(`pip ${sub} no está permitido.`);
    }
    case 'dotnet': {
      const sub = args[0] ?? '';
      if (isVersion(args) || /^(--info|--list-sdks|--list-runtimes)$/.test(sub)) return safe('Información de .NET.');
      if (/^(build|test|restore|format|clean|pack)$/.test(sub)) return sens(`dotnet ${sub}.`);
      if (/^(run|watch)$/.test(sub)) return sens(`dotnet ${sub} (proceso de larga duración).`, true);
      if (sub === 'nuget' && args[1] === 'push') return block('Publicar paquetes no está permitido.');
      return block(`dotnet ${sub} no está permitido.`);
    }
    case 'cargo': {
      const sub = args[0] ?? '';
      if (isVersion(args)) return safe('Versión de Cargo.');
      if (/^(build|check|test|clippy|fmt|doc|bench|tree|metadata)$/.test(sub)) return sens(`cargo ${sub} (los build scripts ejecutan código).`);
      if (sub === 'run' || sub === 'watch') return sens('cargo run.', true);
      if (/^(publish|login|owner|yank)$/.test(sub)) return block(`cargo ${sub} actúa sobre el registro remoto.`);
      if (sub === 'install') return sens('cargo install descarga y compila.');
      return block(`cargo ${sub} no está permitido.`);
    }
    case 'go': {
      const sub = args[0] ?? '';
      if (isVersion(args) || sub === 'env' || sub === 'list') return safe(`go ${sub}.`);
      if (/^(build|test|vet|fmt|mod|generate|install|get)$/.test(sub)) return sub === 'generate' ? destr('go generate ejecuta comandos declarados en el código.') : sens(`go ${sub}.`);
      if (sub === 'run') return sens('go run.', true);
      return block(`go ${sub} no está permitido.`);
    }
    case 'java': case 'javac': case 'rustc': return isVersion(args) ? safe('Versión.') : sens(`${name} compila o ejecuta código del proyecto.`);
    case 'cmake':
      if (isVersion(args)) return safe('Versión de CMake.');
      if (args[0] === '-E' && /^(rm|remove|remove_directory|rename|copy|copy_directory|create_symlink|chdir|env)$/.test(args[1] ?? '')) {
        return block(`cmake -E ${args[1]} manipula archivos fuera del control de JARVIS (usa file.* o la papelera).`);
      }
      if (args[0] === '-P') return destr('cmake -P ejecuta un script CMake.');
      return sens('Configura o compila con CMake.');
    default:
      return block(`«${name}» no está en la lista de ejecutables permitidos.`);
  }
}

/**
 * Classifies one structured process request. Everything is judged on the
 * argument vector as given — there is no shell to reinterpret it — and yet any
 * shell operator or substitution in it is refused outright: the agent must
 * issue separate calls, which keeps each one auditable and cancellable.
 */
export function classifyCommand(req: ProcessRequest, ctx: PolicyContext): CommandVerdict {
  const verdict = (r: Rule): CommandVerdict => ({ allowed: !r.blocked, risk: r.risk, reason: r.reason, longRunning: r.longRunning === true });
  const f = ctx.flavor;

  if (typeof req.executable !== 'string' || !req.executable.trim()) return verdict(block('Falta el ejecutable.'));
  if (!Array.isArray(req.args) || req.args.some((a) => typeof a !== 'string')) return verdict(block('Los argumentos deben ser una lista de textos.'));
  if (req.args.length > 64 || req.args.some((a) => a.length > 4096 || a.includes('\0'))) return verdict(block('Argumentos demasiado largos o inválidos.'));
  if (ctx.accessMode === 'FULL') {
    if (req.executable.includes('\0') || !req.cwd || !isAbsolute(req.cwd, f)) return verdict(block('Ejecutable/directorio de trabajo inválido.'));
    return verdict({ risk: 'SENSITIVE', reason: 'FULL_NATIVE: permisos normales del usuario Windows.' });
  }
  if (/\s/.test(req.executable.trim())) return verdict(block('El ejecutable debe ser un nombre, no una línea de comando.'));
  if (SHELLS.test(req.executable.split(/[\\/]/).pop()!)) return verdict(block('Los intérpretes de comandos (cmd, PowerShell, bash…) no se pueden invocar.'));
  if (/[\\/]/.test(req.executable)) return verdict(block('El ejecutable debe ser un nombre de la lista permitida, no una ruta.'));
  const name = exeName(req.executable);
  if (!(ALLOWED_EXECUTABLES as readonly string[]).includes(name)) return verdict(block(`«${name}» no está en la lista de ejecutables permitidos.`));

  const op = req.args.find((a) => SHELL_OPERATOR.test(a) || SHELL_SYNTAX.test(a));
  if (op) return verdict(block(`«${op}» es sintaxis de shell. Cada comando es una llamada separada; no se encadenan ni se redirigen.`));
  if (f === 'win32' && /^(npm|npx|pnpm|yarn|tsc)$/.test(name) && req.args.some((a) => CMD_META.test(a))) {
    return verdict(block('Este argumento contiene caracteres que cmd.exe interpretaría (& | < > ^ % ! ").'));
  }

  // cwd: explicit, canonical-looking, inside the project, never a system spot.
  if (!req.cwd || !isAbsolute(req.cwd, f)) return verdict(block('Cada comando necesita un directorio de trabajo absoluto.'));
  const cwd = normalize(req.cwd, f);
  if (dirname(cwd, f) === cwd) return verdict(block('No se ejecutan comandos desde la raíz de una unidad.'));
  if (ctx.home && cwd.toLowerCase() === normalize(ctx.home, f).toLowerCase()) return verdict(block('No se ejecutan comandos desde la carpeta de usuario.'));
  if (ctx.protectedPaths.some((p) => isWithin(p, cwd, f))) return verdict(block('El directorio de trabajo está en una ruta protegida del sistema.'));
  if (!ctx.projectRoot || !isWithin(ctx.projectRoot, cwd, f)) return verdict(block('El directorio de trabajo debe estar dentro del proyecto.'));

  for (const [k, v] of Object.entries(req.envSubset ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) return verdict(block(`Variable de entorno inválida: ${k}.`));
    if (SECRET_ENV.test(k) || sanitizeText(`${k}=${v}`) !== `${k}=${v}`) return verdict(block(`No se pasan secretos por variables de entorno (${k}).`));
    if (/^(PATH|NODE_OPTIONS|LD_PRELOAD|DYLD_.*|PYTHONSTARTUP|GIT_.*|npm_config_.*)$/i.test(k)) return verdict(block(`${k} alteraría qué código se ejecuta; no se puede fijar.`));
  }

  const r = rule(name, req.args, ctx);

  // An argument pointing outside the project raises the risk.
  if (!r.blocked && ctx.projectRoot) {
    const outside = req.args.find((a) => {
      const val = a.includes('=') && !isAbsolute(a, f) ? a.slice(a.indexOf('=') + 1) : a;
      if (!/[\\/]/.test(val) || /^-/.test(val) || /^[a-z]+:\/\//i.test(val)) return false;
      const abs = resolve(cwd, val, f);
      return !isWithin(ctx.projectRoot!, abs, f);
    });
    if (outside) {
      if (ctx.protectedPaths.some((p) => isWithin(p, resolve(cwd, outside, f), f))) return verdict(block(`«${outside}» apunta a una ruta protegida del sistema.`));
      return verdict({ ...r, risk: r.risk === 'CRITICAL' ? 'CRITICAL' : 'DESTRUCTIVE', reason: `${r.reason} Además, «${outside}» apunta fuera del proyecto.` });
    }
  }
  return verdict(r);
}
