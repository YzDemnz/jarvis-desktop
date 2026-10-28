import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

const DEV_PORT = 5273;

/**
 * The production CSP is strict on purpose, but Vite's dev server needs its
 * inline module preamble and an HMR websocket. Rather than weakening the
 * shipped policy, the dev-only variant is swapped in here.
 */
function devCsp() {
  return {
    name: 'jarvis-dev-csp',
    apply: 'serve' as const,
    transformIndexHtml(html: string) {
      return html.replace(
        /<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/,
        `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; ` +
          `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
          `font-src https://fonts.gstatic.com; img-src 'self' data: https:; ` +
          `script-src 'self' 'unsafe-inline'; ` +
          `connect-src 'self' ws://localhost:${DEV_PORT} http://localhost:${DEV_PORT}" />`,
      );
    },
  };
}

export default defineConfig({
  root: __dirname,
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  plugins: [
    react(),
    devCsp(),
    electron({
      main: {
        entry: 'electron/main.ts',
        // Electron runs an ESM main; package.json declares module type.
        vite: {
          resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
          build: {
            // TypeScript is CommonJS: let Node load the original compiler rather
            // than embedding its __filename references into the ESM main.
            rollupOptions: { external: ['better-sqlite3', 'typescript', 'ws'], output: { format: 'es', entryFileNames: 'main.js' } },
          },
        },
      },
      preload: {
        input: { preload: path.join(__dirname, 'electron/preload.ts'), 'credential-preload': path.join(__dirname, 'electron/credential-preload.ts') },
        // A sandboxed preload must be CommonJS — ESM preloads only load with
        // sandbox disabled, and disabling the sandbox is not on the table.
        vite: {
          resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
          build: {
            rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs', inlineDynamicImports: false } },
          },
        },
      },
    }),
  ],
  server: { port: DEV_PORT, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
