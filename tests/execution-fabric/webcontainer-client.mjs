import { WebContainer } from '@webcontainer/api';

const run = async () => {
  const report = { bootMs: null, installMs: null, testMs: null, buildMs: null, devMs: null,
    virtualWriteRead: false, hostCanaryRead: false, installExit: null, testExit: null,
    buildExit: null, devReady: false, previewLoaded: false, error: null };
  let wc;
  try {
    const start = performance.now(); wc = await WebContainer.boot(); report.bootMs = Math.round(performance.now() - start);
    const project = {
      'package.json': { file: { contents: JSON.stringify({ name: 'ef1-web-poc', private: true, type: 'module',
        scripts: { test: 'node test.cjs', build: 'vite build', dev: 'vite --host 0.0.0.0' },
        dependencies: { react: '18.3.1', 'react-dom': '18.3.1' }, devDependencies: { vite: '5.4.21' } }) } },
      'index.html': { file: { contents: '<div id="root"></div><script type="module" src="/src/main.jsx"></script>' } },
      'test.cjs': { file: { contents: "const fs=require('fs'); if (!fs.readFileSync('src/App.jsx','utf8').includes('EF-1 UI')) process.exit(1);" } },
      src: { directory: {
        'main.jsx': { file: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import App from './App.jsx';createRoot(document.getElementById('root')).render(<App/>);" } },
        'App.jsx': { file: { contents: "import React from 'react';export default function App(){return <h1>EF-1 UI</h1>} " } },
      } },
    };
    await wc.mount(project);
    await wc.fs.writeFile('/virtual-note.txt', 'virtual only');
    report.virtualWriteRead = (await wc.fs.readFile('/virtual-note.txt', 'utf8')) === 'virtual only';
    try { await wc.fs.readFile(window.hostCanaryPath, 'utf8'); report.hostCanaryRead = true; } catch { /* expected */ }
    const runProcess = async (args) => {
      const t = performance.now(); const proc = await wc.spawn('npm', args);
      const output = []; proc.output.pipeTo(new WritableStream({ write(chunk) { if (output.join('').length < 2000) output.push(String(chunk)); } }));
      const exit = await proc.exit; return { exit, ms: Math.round(performance.now() - t), output: output.join('').slice(-800) };
    };
    const install = await runProcess(['install', '--no-audit', '--no-fund']); report.installExit = install.exit; report.installMs = install.ms;
    if (install.exit) throw new Error(`npm install exit ${install.exit}: ${install.output}`);
    const test = await runProcess(['test']); report.testExit = test.exit; report.testMs = test.ms;
    const build = await runProcess(['run', 'build']); report.buildExit = build.exit; report.buildMs = build.ms;
    const devStart = performance.now();
    const ready = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('dev server timeout')), 60_000);
      wc.on('server-ready', (_port, url) => { clearTimeout(timer); resolve(url); }); });
    const dev = await wc.spawn('npm', ['run', 'dev']); dev.output.pipeTo(new WritableStream({ write() {} }));
    const url = await ready; report.devReady = true; report.devMs = Math.round(performance.now() - devStart);
    try { report.previewLoaded = (await fetch(url)).ok; } catch { /* server-ready still observed */ }
    dev.kill();
  } catch (error) { report.error = String(error).slice(0, 800); }
  finally { await wc?.teardown(); }
  return report;
};
window.ef1 = run();
