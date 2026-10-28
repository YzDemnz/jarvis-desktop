import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalStrongDetector } from '../../src/execution/StrongLocalDetector';

const detector = new LocalStrongDetector();
const result = { at: new Date().toISOString(), platform: os.platform(), release: os.release(),
  node: process.version, findings: detector.findings(), strong: await detector.detect(),
  note: 'Read-only executable/module probe. Feature state, VM boot and security are not attested.' };
const dest = path.resolve(import.meta.dirname, '../../docs/evidence/ef1/local-backend-probe.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
