import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CodexIntelligence} from '../electron/bootstrap/CodexIntelligence';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-codex-job-'));
process.env.JARVIS_ALLOW_FIXTURES='1';
const c=new CodexIntelligence(directory,process.env.JARVIS_CODEX_EXE??null),started=Date.now();
try{const result=await c.inspect();fs.writeFileSync('docs/evidence/bootstrap-20261007/codex-job-probe.json',JSON.stringify({directory,result,elapsedMs:Date.now()-started,diagnostic:c.startupDiagnostic},null,2));console.log(JSON.stringify(result));}finally{await c.stop();}
