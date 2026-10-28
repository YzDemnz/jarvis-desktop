import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
const before=JSON.parse(fs.readFileSync('docs/evidence/workflow-20261007/owner-before.json'));
assert.equal(process.env.JARVIS_USER_DATA,'E:\\CODEX\\DatosApps\\JARVIS');
assert.ok(path.resolve(before.backup).startsWith('E:\\CODEX\\Historial\\'));
const hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
function inspect(file){
 const db=new Database(file,{readonly:true});
 // Compare hashes only. No message, task narrative, vault or credential value is output.
 const tables={};for(const [table,order] of [['conversations','id'],['messages','seq'],['task_states','task_id']]){const rows=db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();tables[table]={count:rows.length,sha256:hash(rows)};}
 const tasks=db.prepare('SELECT task_id,state_json FROM task_states ORDER BY task_id').all().map(r=>{const s=JSON.parse(r.state_json);return {id:r.task_id,conversationId:s.conversationId,goal:s.goal};});
 db.close();return {tables,taskIdentityHash:hash(tasks)};
}
const old=inspect(before.backup),current=inspect(path.join(process.env.JARVIS_USER_DATA,'intelligence-fabric/fabric.sqlite'));
assert.equal(current.tables.messages.sha256,old.tables.messages.sha256,'Conversation message rows must remain identical');
assert.equal(current.tables.conversations.sha256,old.tables.conversations.sha256,'Conversation metadata must remain identical');
assert.equal(current.taskIdentityHash,old.taskIdentityHash,'Task identities and goals must be preserved');
const record={status:'PASS',test:false,at:new Date().toISOString(),before:old,after:current,allTaskRowsUnchanged:current.tables.task_states.sha256===old.tables.task_states.sha256,printedNarrativeOrCredentials:false};
fs.writeFileSync('docs/evidence/workflow-20261007/owner-integrity.json',JSON.stringify(record,null,2));console.log('OWNER_HISTORY_HASH_PASS');
