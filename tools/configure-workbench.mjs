import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
const root='E:\\CODEX\\Aplicaciones\\JARVIS\\Dependencias\\Workstation',assets={};
const originalVoice=JSON.parse(fs.readFileSync(path.join(root,'voices/es_MX-ald-medium.onnx.json'),'utf8'));
if(originalVoice.phoneme_type==='PhonemeType.ESPEAK')originalVoice.phoneme_type='espeak';
fs.writeFileSync(path.join(root,'voices/es_MX-ald-medium.piper18.json'),JSON.stringify(originalVoice,null,2));
const ff=fs.readdirSync(path.join(root,'ffmpeg')).find(n=>n.startsWith('ffmpeg-'));
for(const [name,relative]of Object.entries({python:'python/python.exe',voice:'voices/es_MX-ald-medium.onnx',voiceConfig:'voices/es_MX-ald-medium.piper18.json',sd:'sd/sd-cli.exe',imageModel:'models/sd15-q4.gguf',ffmpeg:`ffmpeg/${ff}/bin/ffmpeg.exe`,ffprobe:`ffmpeg/${ff}/bin/ffprobe.exe`})){
 const file=path.resolve(root,relative),data=fs.readFileSync(file);assets[name]={path:path.relative(root,file),sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length};
}
const manifest={version:1,at:new Date().toISOString(),assets,status:'DETECTED_NOT_INFERENCE_VERIFIED',voice:'es_MX-ald-medium',image:'SD1.5-Q4_0',imageSize:512,imageSteps:12,video:'Narrated still-image MP4 composition, not neural motion'};
fs.writeFileSync(path.join(root,'runtime.json'),JSON.stringify(manifest,null,2));fs.writeFileSync('docs/evidence/device-workflows-20261022/provision/runtime.json',JSON.stringify(manifest,null,2));
const tests=[['python',['-m','piper','--help']],['sd',['--list-devices']],['ffmpeg',['-version']]];
for(const [key,args]of tests){const r=spawnSync(path.join(root,assets[key].path),args,{encoding:'utf8',windowsHide:true,timeout:60000});fs.writeFileSync(`docs/evidence/device-workflows-20261022/provision/${key}-discovery.json`,JSON.stringify({status:r.status,error:r.error?String(r.error):null,stdout:r.stdout,stderr:r.stderr},null,2));console.log(key+' '+r.status);}
