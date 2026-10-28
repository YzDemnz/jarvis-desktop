import fs from 'node:fs';
import assert from 'node:assert/strict';
import { NodeProcessPort } from '../../electron/dev/nodePorts';
import { TerminalService } from '../../src/dev/TerminalService';
const result = await new TerminalService(new NodeProcessPort()).execute({ executable: 'dotnet', args: ['--version'], cwd: process.cwd(), timeoutMs: 120000 });
fs.writeFileSync('docs/evidence/recovery-20261007/dotnet-process-probe.json', JSON.stringify(result, null, 2));
console.log('DOTNET_PROCESS_PROBE', JSON.stringify(result));
assert.equal(result.exitCode, 0); assert.equal(result.timedOut, false); assert.equal(result.stdout.trim(), '8.0.425');
