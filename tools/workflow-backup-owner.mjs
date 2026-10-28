import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const source=process.env.JARVIS_USER_DATA;
if(source!=='E:\\CODEX\\DatosApps\\JARVIS')throw Error('EXTERNAL_OWNER_PROFILE_REQUIRED');
const target='E:\\CODEX\\Historial\\Workflow-JARVIS-20261007\\Perfil-antes-de-0.4.1';fs.mkdirSync(target,{recursive:true});
const backup=path.join(target,'fabric.sqlite');if(fs.existsSync(backup))throw Error('PRESERVE_EXISTING_BACKUP');
const db=new Database(path.join(source,'intelligence-fabric/fabric.sqlite'),{readonly:true});
const stats={schema:db.pragma('user_version',{simple:true}),integrity:db.pragma('integrity_check',{simple:true}),conversations:db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n,messages:db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,tasks:db.prepare('SELECT COUNT(*) AS n FROM task_states').get().n};
await db.backup(backup);db.close();
for(const rel of ['authority/policy.json','connected-ai/connected-policy.json']){const from=path.join(source,rel),to=path.join(target,rel);if(fs.existsSync(from)){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);}}
const record={kind:'CONSISTENT_OWNER_BACKUP',source,backup,stats,test:false,at:new Date().toISOString()};fs.writeFileSync('docs/evidence/workflow-20261007/owner-before.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));
