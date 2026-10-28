import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-s41-diagnose-'));
await build({ entryPoints: ['electron/process/WindowsJobProcess.ts'], outfile: path.join(root, 'job.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { spawnWindowsJob } = await import(pathToFileURL(path.join(root, 'job.mjs')));
const version = process.argv[2] ?? 'b11429'; if (!['b11429', 'b6500'].includes(version)) throw Error('INVALID_VERSION');
const base = path.join(process.env.LOCALAPPDATA, 'JARVIS/runtimes/llama-cpp', version), runtime = JSON.parse(fs.readFileSync(path.join(base, 'runtime.json')));
const proc = spawnWindowsJob({ file: path.join(base, version === 'b6500' ? 'bin/llama-cli.exe' : 'bin/llama-completion.exe'), cwd: path.join(base, 'bin'), args: ['-m', runtime.model.file, '-p', 'Hello', '-n', '8', '-c', '2048', '-ngl', '0', '-t', '4', '--no-display-prompt', '--simple-io', '--no-warmup', ...(version === 'b6500' ? ['--no-conversation'] : [])], env: Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH'].flatMap(k => process.env[k] ? [[k, process.env[k]]] : [])) });
let output = ''; for (const name of ['onStdout', 'onStderr']) proc[name](s => { output = (output + s).slice(-60000); console.log(s); });
const end = new Promise(resolve => proc.onExit((code, signal) => resolve({ code, signal })));
const timer = setTimeout(() => { void proc.killTree(); }, 120000);
try { await proc.ready; console.log('OWNED_DIAGNOSTIC_READY'); const result = await end; const dir = 'docs/evidence/s41/runtime-diagnostics'; fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, Date.now() + '.json'), JSON.stringify({ version, result, output }, null, 2)); }
finally { clearTimeout(timer); await proc.killTree(); }
