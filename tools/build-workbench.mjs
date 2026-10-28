import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
fs.mkdirSync('dist-workbench',{recursive:true});
await build({entryPoints:['electron/workbench/document-worker.mjs'],outfile:'dist-workbench/document-worker.mjs',bundle:true,platform:'node',target:'node24',format:'esm',alias:{'@':path.resolve('src')},external:['@napi-rs/canvas'],banner:{js:"import {createRequire as _createRequire} from 'node:module';const require=_createRequire(import.meta.url);"},sourcemap:false});
fs.copyFileSync('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs','dist-workbench/pdf.worker.mjs');
fs.copyFileSync('electron/workbench/audio-worker.py','dist-workbench/audio-worker.py');
console.log('DOCUMENT_WORKER_BUILT');
