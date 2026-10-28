import path from 'node:path';
import Database from 'better-sqlite3';
if(process.env.JARVIS_USER_DATA!=='E:\\CODEX\\DatosApps\\JARVIS')throw Error('OWNER_PROFILE_PATH_REQUIRED');
const db=new Database(path.join(process.env.JARVIS_USER_DATA,'intelligence-fabric/fabric.sqlite'),{readonly:true});
const stats={schema:db.pragma('user_version',{simple:true}),integrity:db.pragma('integrity_check',{simple:true}),conversations:db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n,messages:db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,tasks:db.prepare('SELECT COUNT(*) AS n FROM task_states').get().n};db.close();console.log(JSON.stringify(stats));
