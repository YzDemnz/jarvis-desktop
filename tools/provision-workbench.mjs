import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {unzipSync} from 'fflate';
const base='E:\\CODEX\\Aplicaciones\\JARVIS\\Dependencias\\Workstation';
const proof=path.resolve('docs/evidence/device-workflows-20261022/provision');fs.mkdirSync(proof,{recursive:true});fs.mkdirSync(base,{recursive:true});
const receipts=[];
async function get(url){const r=await fetch(url);if(!r.ok)throw Error('HTTP '+r.status+' '+url);return r;}
async function download(url,name,expected){const file=path.join(base,name);fs.mkdirSync(path.dirname(file),{recursive:true});
 if(fs.existsSync(file)){const digest=createHash('sha256').update(fs.readFileSync(file)).digest('hex');if(expected&&digest===expected){receipts.push({url,file,sha256:digest,reused:true});return file;}}
 const r=await get(url),hash=createHash('sha256'),out=fs.openSync(file+'.partial','w');let size=0,last=0;
 try{for await(const chunk of r.body){hash.update(chunk);fs.writeSync(out,chunk);size+=chunk.length;if(Date.now()-last>10000){fs.writeFileSync(path.join(proof,'progress.json'),JSON.stringify({url,size,at:new Date().toISOString()}));last=Date.now();}}}finally{fs.closeSync(out);}
 const sha256=hash.digest('hex');if(expected&&sha256!==expected)throw Error('DOWNLOAD_HASH_MISMATCH '+name);fs.renameSync(file+'.partial',file);receipts.push({url,file,sha256,size});fs.writeFileSync(path.join(proof,'downloads.json'),JSON.stringify(receipts,null,2));console.log('DOWNLOADED '+name+' '+size);return file;}
function run(file,args){const r=spawnSync(file,args,{encoding:'utf8',windowsHide:true,env:{...process.env,PIP_CACHE_DIR:path.join(base,'cache'),PYTHONPYCACHEPREFIX:path.join(base,'pycache')}});fs.appendFileSync(path.join(proof,'commands.log'),JSON.stringify({file,args,status:r.status,stdout:r.stdout,stderr:r.stderr})+'\n');if(r.status!==0)throw Error('PROVISION_COMMAND_FAILED '+file);return r.stdout;}
function unzip(file,dir){fs.mkdirSync(dir,{recursive:true});for(const [name,data]of Object.entries(unzipSync(fs.readFileSync(file)))){const target=path.resolve(dir,name);if(!target.startsWith(path.resolve(dir)+path.sep))throw Error('ZIP_PATH_INVALID');if(name.endsWith('/')){fs.mkdirSync(target,{recursive:true});continue;}fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);}}
try{
 const tag='master-995-fd21ecf',zip=await download(`https://github.com/leejet/stable-diffusion.cpp/releases/download/${tag}/sd-master-fd21ecf-bin-win-vulkan-x64.zip`,'sd-vulkan.zip','5cbc57846997511da8d2d18748eb83b85e58e2ed9879668cc81117da2c315544');unzip(zip,path.join(base,'sd'));
 const pythonZip=await download('https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip','python-3.12.10.zip');unzip(pythonZip,path.join(base,'python'));fs.writeFileSync(path.join(base,'python','python312._pth'),'python312.zip\n.\nLib/site-packages\nimport site\n');
 const bundled='C:\\Users\\leo_j\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
 run(bundled,['-m','pip','install','--disable-pip-version-check','--target',path.join(base,'python','Lib','site-packages'),'--only-binary=:all:','--python-version','3.12','--implementation','cp','--abi','cp312','--platform','win_amd64','-r',path.resolve('tools/workstation-python-requirements.txt')]);
 const voiceRoot='https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_MX/ald/medium/';
 for(const name of ['es_MX-ald-medium.onnx','es_MX-ald-medium.onnx.json','MODEL_CARD'])await download(voiceRoot+name,'voices/'+name);
 const sum=(await (await get('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256')).text()).split(/\s+/)[0];
 const ff=await download('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip','ffmpeg.zip',sum);unzip(ff,path.join(base,'ffmpeg'));
 const info=await(await get('https://huggingface.co/api/models/second-state/stable-diffusion-v1-5-GGUF?blobs=true')).json(),model='stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf',meta=info.siblings.find(x=>x.rfilename===model);
 fs.writeFileSync(path.join(proof,'image-model-origin.json'),JSON.stringify({sha:info.sha,cardData:info.cardData,model:meta},null,2));
 await download(`https://huggingface.co/second-state/stable-diffusion-v1-5-GGUF/resolve/${info.sha}/${model}`,'models/sd15-q4.gguf',meta.lfs.sha256);
 fs.writeFileSync(path.join(base,'provision.json'),JSON.stringify({at:new Date().toISOString(),status:'FILES_INSTALLED_NOT_INFERENCE_VERIFIED',receipts},null,2));console.log('WORKSTATION_FILES_INSTALLED');
}catch(error){fs.writeFileSync(path.join(proof,'failure-'+Date.now()+'.json'),JSON.stringify({error:String(error),receipts},null,2));throw error;}
