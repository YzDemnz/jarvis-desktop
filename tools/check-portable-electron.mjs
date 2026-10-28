import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {getCurrentFuseWire, FuseV1Options} from '@electron/fuses';

const external=value=>{const full=path.resolve(value);assert.ok(full.toLowerCase().startsWith('e:\\codex\\'),'EXTERNAL_ELECTRON_PATH_REQUIRED');return full;};
const digest=async file=>{const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');};
export async function verifyPortableElectron(appOutDir,projectDir=process.cwd()) {
  const original=external(path.join(projectDir,'node_modules/electron/dist/electron.exe'));
  const packaged=external(path.join(appOutDir,'JARVIS.exe'));
  const sourceHash=await digest(original), packagedHash=await digest(packaged);
  assert.equal(packagedHash,sourceHash,'PACKAGED_ELECTRON_BINARY_CHANGED');
  const sourceFuses=await getCurrentFuseWire(original), packagedFuses=await getCurrentFuseWire(packaged);
  assert.deepEqual(packagedFuses,sourceFuses,'PACKAGED_FUSES_CHANGED');
  // ASCII 0 is the upstream disabled state. This build never flips that fuse.
  assert.equal(sourceFuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation],0x30,'UPSTREAM_ASAR_VALIDATION_REQUIRES_A_DIFFERENT_SIGNED_BUILD_PATH');
  const proof={status:'VERIFIED_UPSTREAM_EXECUTABLE_IDENTITY',at:new Date().toISOString(),original,packaged,
    sha256:sourceHash,sourceFuses,packagedFuses,fusesChanged:false,windowsPolicyChanged:false,
    embeddedAsarValidation:'UPSTREAM_DEFAULT_DISABLED_UNCHANGED',asarDeliveryHash:'Separately sealed by delivery manifest'};
  fs.writeFileSync(path.join(appOutDir,'portable-electron-proof.json'),JSON.stringify(proof,null,2));
  console.log('PORTABLE_ELECTRON_IDENTITY_PASS '+sourceHash);return proof;
}
export default async function afterPack(context) {
  if(context.electronPlatformName==='win32')await verifyPortableElectron(context.appOutDir,context.packager.projectDir);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))verifyPortableElectron(external(process.argv[2]??'release/win-unpacked')).catch(error=>{console.error(error);process.exitCode=1;});
