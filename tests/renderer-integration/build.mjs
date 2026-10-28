import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = path.join(os.tmpdir(), 'jarvis-harness');

/**
 * Bundles the real renderer. The only substitutions are the three packages that
 * cannot be installed here, remapped through tsconfig paths — no production
 * source is touched or conditionally compiled.
 */
export function build() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  buildSync({
    entryPoints: [path.join(here, 'entry.tsx')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    tsconfig: path.join(here, 'tsconfig.bundle.json'),
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.css': 'css' },
    outfile: path.join(OUT_DIR, 'bundle.js'),
    sourcemap: 'inline',
    logLevel: 'warning',
  });

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>JARVIS · harness</title>
<link rel="stylesheet" href="./bundle.css"></head>
<body><div id="root"></div><script src="./bundle.js"></script></body></html>`);

  return OUT_DIR;
}

export function serve(dir = OUT_DIR, port = 5399) {
  return import('node:http').then(({ createServer }) => new Promise((resolve) => {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    const server = createServer((req, res) => {
      const file = path.join(dir, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
      if (!file.startsWith(dir) || !fs.existsSync(file)) { res.writeHead(404).end('no'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'text/plain' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${port}/` }));
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  build();
  console.log('bundle en', OUT_DIR);
}
