import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-local-mcp-probe-')),evidence=path.resolve('docs/evidence/intelligence-bridge-20261022');
const entry=path.join(root,'entry.ts');
fs.writeFileSync(entry,['electron/bridge/LocalMcpHost.ts','electron/bridge/BridgeJournal.ts','electron/bridge/McpBridge.ts','electron/fabric/FabricDatabase.ts','src/authority/AuthorityState.ts','electron/connected/TaskContinuity.ts'].map(file=>`export * from ${JSON.stringify(path.resolve(file).replaceAll('\\','/'))};`).join('\n'));
const bundle=path.join(root,'probe.cjs');await build({entryPoints:[entry],outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
// Resolve external SQLite from this repository without copying native bindings.
const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);process.env.NODE_PATH=path.resolve('node_modules');require('node:module').Module._initPaths();
const {LocalMcpHost,BridgeJournal,McpBridge,FabricDatabase,AuthorityState,TaskContinuity}=await import(pathToFileURL(bundle));
const db=new FabricDatabase(path.join(root,'fabric.sqlite')),authority=new AuthorityState(),journal=new BridgeJournal(db,authority,new TaskContinuity(db,path.join(root,'artifacts')));
const deps=path.dirname(process.env.JARVIS_RUNTIME_ROOT),bridge=new McpBridge(path.join(root,'mcp'),journal,path.join(deps,'Herramientas/node-v24.21.0-win-x64/node.exe'),path.resolve('dist-bridge/jarvis-mcp.cjs'));
const host=new LocalMcpHost(path.join(root,'host'),path.join(deps,'Herramientas/Claude/claude.exe'),'http://127.0.0.1:11434',bridge,journal);
const id='mcp-real-local',prompt='El proyecto Atlas se entrega el viernes. Ana revisa las pruebas. Falta confirmar el presupuesto. Haz un seguimiento breve en español con estado, próximo paso y dato pendiente. No afirmes haber realizado acciones.';
const frozen={id,prompt,model:'qwen3.5:2b',criteria:['Actual local CLI must call MCP read and submit','Result stays UNVERIFIED','Text must mention Atlas, viernes, Ana and presupuesto','Reject invented invoice, long digit/hex identifier or claim of executed validation','No paid API or cloud model'],root};
fs.writeFileSync(path.join(evidence,'local-host-frozen-'+Date.now()+'.json'),JSON.stringify(frozen,null,2));
authority.admit(id,createHash('sha256').update(prompt).digest('hex'),prompt);journal.create(id,prompt);
try{const receipt=await host.run(id,frozen.model),task=journal.read(id);const markers=['Atlas','viernes','Ana','presupuesto'].every(s=>task.text?.toLowerCase().includes(s.toLowerCase())),unsupportedFacts=/factura|[a-f0-9]{20}|validaci.n financiera/i.test(task.text??'');const result={status:receipt.state==='PRODUCED'&&markers&&!unsupportedFacts?'PASS':'FAIL',receipt,task,markers,unsupportedFacts,paidApiCalls:0,scope:'Official Claude Code CLI harness using local Qwen, not Claude cloud inference; frozen negatives are finite case checks'};fs.writeFileSync(path.join(evidence,'local-host-attempt-'+Date.now()+'.json'),JSON.stringify(result,null,2));console.log(result.status,receipt.state,receipt.error,task.text);}
catch(error){fs.writeFileSync(path.join(evidence,'local-host-attempt-'+Date.now()+'.json'),JSON.stringify({status:'FAIL',error:String(error),snapshot:host.snapshot(),task:journal.read(id)},null,2));console.log('FAIL',String(error));}
finally{await host.stop();await bridge.stop();db.close();}
