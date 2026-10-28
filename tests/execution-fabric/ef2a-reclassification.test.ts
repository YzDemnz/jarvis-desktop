import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lines = fs.readFileSync(path.join(root, 'docs/evidence/ef2a/ef1-reclassification.jsonl'), 'utf8').trim().split('\n');
assert.equal(lines.length, 2);
for (const line of lines) {
  const record = JSON.parse(line) as { provider: string; sourcePath: string; sourceSha256: string; classification: string; reason: string };
  const content = fs.readFileSync(path.join(root, record.sourcePath));
  assert.equal(createHash('sha256').update(content).digest('hex').toUpperCase(), record.sourceSha256);
  assert.ok(record.reason); assert.ok(record.sourcePath.startsWith('docs/evidence/ef1/'));
  const source = JSON.parse(content.toString('utf8')) as { outputTail: string };
  if (record.provider === 'Codex') {
    assert.equal(record.classification, 'POLICY_BLOCKED'); assert.match(source.outputTail, /rejected: blocked by policy/);
  } else {
    assert.equal(record.provider, 'OpenCode'); assert.equal(record.classification, 'UNKNOWN');
    assert.match(source.outputTail, /Unexpected server error/);
  }
}
console.log('PASS EF-2A EF-1 reclassification: original sha256 bound; Codex policy blocked; OpenCode unknown');
