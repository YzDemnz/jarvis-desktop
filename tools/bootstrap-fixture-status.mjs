import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const root=process.env.TEMP;
const dirs=fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name.startsWith('jarvis-fabric-native-bootstrap-')).map(d=>path.join(root,d.name)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
for(const d of dirs.slice(0,2)){
 const f=path.join(d,'intelligence-fabric/fabric.sqlite');if(!fs.existsSync(f))continue;
 const db=new Database(f,{readonly:true});const row=db.prepare('SELECT checkpoint_json AS json FROM task_checkpoints WHERE task_id=?').get('jarvis:bootstrap:v1');
 if(row){const s=JSON.parse(row.json);console.log(JSON.stringify({profile:d,phase:s.phase,health:s.localHealth,progress:s.progress,failure:s.failure,receipts:s.receipts.length}));}db.close();
}
