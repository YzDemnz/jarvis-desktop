import {app,ipcMain,shell} from 'electron';
import path from 'node:path';
import {authority,authorityHandle,onAuthorityStop} from '../authority';
import {connectedService} from '../connected/ipcConnected';
import {WorkstationService} from './WorkstationService';
let service:WorkstationService|null=null,unsubscribe:(()=>void)|null=null;
export function registerWorkbenchIpc(){
  const dependencies=path.dirname(process.env.JARVIS_RUNTIME_ROOT??'E:\\CODEX\\Aplicaciones\\JARVIS\\Dependencias\\Runtimes');
  service=new WorkstationService(path.join(app.getPath('userData'),'workbench'),authority,connectedService(),path.join(dependencies,'Herramientas','node-v24.21.0-win-x64','node.exe'),app.isPackaged?path.join(process.resourcesPath,'workbench','document-worker.mjs'):path.join(app.getAppPath(),'dist-workbench','document-worker.mjs'));
  unsubscribe=onAuthorityStop(id=>service?.stop(id));
  authorityHandle('workbench:snapshot',()=>({capabilities:service!.capabilities(),runs:service!.receipts(),warnings:service!.warnings()}));
  authorityHandle('workbench:run',(_event,id:unknown,prompt:unknown)=>{if(typeof id!=='string'||typeof prompt!=='string')throw Error('WORKSTATION_REQUEST_INVALID');return service!.run(id,prompt);});
  authorityHandle('workbench:reveal',(_event,id:unknown,index:unknown)=>{if(typeof id!=='string'||!Number.isSafeInteger(index))throw Error('ARTIFACT_SELECTION_INVALID');const artifact=service!.receipt(id)?.artifacts[Number(index)];if(!artifact)throw Error('ARTIFACT_NOT_FOUND');shell.showItemInFolder(artifact.path);return true;});
}
export function unregisterWorkbenchIpc(){['workbench:snapshot','workbench:run','workbench:reveal'].forEach(c=>ipcMain.removeHandler(c));unsubscribe?.();unsubscribe=null;void service?.dispose();service=null;}
