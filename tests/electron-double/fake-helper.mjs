// A stand-in for jarvis-automation-helper.exe: a real separate process that
// speaks the same line-delimited JSON protocol. It exists to test the bridge's
// transport — ids, timeouts, crashes, garbage — not Windows behaviour.
import readline from 'node:readline';

const received = [];
const hangStop = process.argv.includes('--hang-stop');
const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch { out({ requestId: '', ok: false, error: 'JSON inválido' }); return; }
  received.push(req.command);
  const reply = (result) => out({ requestId: req.requestId, ok: true, result });
  const error = (msg) => out({ requestId: req.requestId, ok: false, error: msg });

  switch (req.command) {
    case 'ping':
      if (process.argv.includes('--exit-before-ping')) { process.exit(7); }
      if (process.argv.includes('--cold-start')) { setTimeout(() => reply('pong'), 5000); return; }
      // Noise before the answer: the bridge must skip it without breaking.
      process.stdout.write('esto no es json\n');
      process.stdout.write('{"sin":"requestId"}\n');
      process.stdout.write(`{"requestId":"${req.requestId}","ok":true,`); // split across writes
      setTimeout(() => process.stdout.write('"result":"pong"}\n'), 5);
      return;
    case 'sessionState': return reply('ACTIVE');
    case 'listWindows': return reply([{ windowId: 'hwnd:0x10', processId: 1, processName: 'Code.exe', title: 'VS Code', bounds: { x: 0, y: 0, width: 800, height: 600 }, state: 'normal', visible: true, focused: true, monitor: 0, elevated: false }]);
    case 'activateWindow':
      if (req.args.windowId === 'hwnd:0xdead') return; // never answers → timeout
      return reply(null);
    case 'closeWindow':
      if (req.args.windowId === 'hwnd:0xcrash') process.exit(3);
      return reply(null);
    case 'uiElement':
      if (req.args.elementId === 'el:late') { setTimeout(() => reply({ late: true }), 400); return; }
      return reply(null);
    case 'uiInvoke': return error('El control no expone el patrón Invoke.');
    case 'keyPress':
      if (req.args.key === 'h') out({ event: 'humanInput', data: { kind: 'keyboard', at: 123 } });
      return reply(null);
    case 'typeText': {
      // Slow typing, cancellable by cancelInput.
      const t = setTimeout(() => { globalThis.__typing = null; reply({ typed: req.args.text.length }); }, hangStop ? 5000 : 500);
      globalThis.__typing = { t, id: req.requestId };
      return;
    }
    case 'cancelInput':
      if (hangStop) return reply(null); // Accepts STOP but fails to quiesce.
      if (globalThis.__typing) {
        clearTimeout(globalThis.__typing.t);
        out({ requestId: globalThis.__typing.id, ok: false, error: 'Acción de entrada cancelada.' });
        globalThis.__typing = null;
      }
      return reply(null);
    case 'inputState':
      if (hangStop) return; // Even telemetry stalls: watchdog must bound the receipt.
      return reply({ active: !!globalThis.__typing });
    case 'processes':
      // Reports every command it has ever received, so the test can prove
      // that invalid requests never reached this process.
      return reply(received.map((c) => ({ pid: 0, name: c, memoryBytes: null, windowCount: 0, elevated: null })));
    default: return reply(null);
  }
});
