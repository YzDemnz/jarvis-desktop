import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const file=process.argv[2];
if(!path.resolve(file).startsWith('E:\\CODEX\\'))throw Error('EXTERNAL_PROFILE_REQUIRED');
const db=new Database(path.join(file,'intelligence-fabric/fabric.sqlite'),{readonly:true});
const records=db.prepare("SELECT operation_json FROM task_operations WHERE operation_id LIKE 'project-checks:%' OR operation_id LIKE 'proposal:%'").all().map(r=>JSON.parse(r.operation_json));
console.log(JSON.stringify({profile:file,records},null,2));db.close();
