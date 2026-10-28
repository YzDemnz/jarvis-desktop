import fs from 'node:fs';
import path from 'node:path';
const [outside, inside, networkHost] = process.argv.slice(2);
const result = { outsideRead: false, outsideWrite: false, insideWrite: false, network: 'NOT_TESTED' };
try { fs.readFileSync(outside); result.outsideRead = true; } catch { /* denied */ }
try { fs.writeFileSync(`${outside}.write-probe`, 'probe'); result.outsideWrite = true; fs.unlinkSync(`${outside}.write-probe`); } catch { /* denied */ }
try { fs.writeFileSync(path.join(inside, 'inside-probe.txt'), 'probe'); result.insideWrite = true; } catch { /* denied */ }
if (networkHost) {
  try { await fetch(networkHost, { signal: AbortSignal.timeout(1500) }); result.network = 'CONNECTED'; }
  catch { result.network = 'DENIED_OR_UNAVAILABLE'; }
}
console.log(JSON.stringify(result));
