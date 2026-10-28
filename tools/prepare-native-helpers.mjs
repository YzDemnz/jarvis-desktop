import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pin=JSON.parse(fs.readFileSync(path.join(repo,'tools/native-helper-artifacts.json'),'utf8'));
const external=value=>{const full=path.resolve(repo,value);if(!full.toLowerCase().startsWith('e:\\codex\\'))throw Error('EXTERNAL_NATIVE_ARTIFACT_PATH_REQUIRED');return full;};
const git=(...args)=>{const result=spawnSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error('NATIVE_SOURCE_GIT_CHECK_FAILED');return result.stdout.trim();};
if(git('rev-parse','HEAD:native')!==pin.nativeTree || git('diff','--name-only','HEAD','--','native')
  || git('ls-files','--others','--exclude-standard','--','native'))throw Error('NATIVE_SOURCE_CHANGED_REQUIRES_NEW_VERIFIED_ARTIFACTS');
const cache=external(process.env.JARVIS_NATIVE_ARTIFACT_ROOT??pin.cache);
const digest=async file=>{const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');};
// Validate every input before copying any output; hashes are reviewed build inputs, never model/runtime arguments.
const files=[];
for(const entry of pin.files){const source=external(path.join(cache,entry.name)),target=external(entry.target);
  if(!fs.existsSync(source)||await digest(source)!==entry.sha256)throw Error('NATIVE_ARTIFACT_HASH_MISMATCH: '+entry.name);
  files.push({...entry,source,target});}
if(!process.argv.includes('--check'))for(const entry of files){fs.mkdirSync(path.dirname(entry.target),{recursive:true});
  if(!fs.existsSync(entry.target)||await digest(entry.target)!==entry.sha256)fs.copyFileSync(entry.source,entry.target);
  if(await digest(entry.target)!==entry.sha256)throw Error('NATIVE_STAGING_HASH_MISMATCH');}
console.log(JSON.stringify({status:'VERIFIED_NATIVE_ARTIFACTS',mode:process.argv.includes('--check')?'CHECK_ONLY':'STAGED',
  sourceCommit:pin.sourceCommit,nativeTree:pin.nativeTree,policyChanged:false,files:files.map(({name,sha256,target})=>({name,sha256,target})),
  reason:'Reuse the previous verified binaries because native sources are identical; Node/Electron migration changes no C# source or protocol.'}));
