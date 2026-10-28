param([Parameter(Mandatory=$true)][string]$JarvisPackagePath,[Parameter(Mandatory=$true)][string]$JarvisAclEvidence)
$ErrorActionPreference='Stop'
$jarvisTarget=(Resolve-Path -LiteralPath $JarvisPackagePath).Path
if($jarvisTarget -notmatch '^E:\\CODEX\\Aplicaciones\\JARVIS\\(?:App instalada$|Paquetes\\[^\\]+$|Proyecto\\release\\win-unpacked$)'){throw 'APP_PACKAGE_SCOPE_REQUIRED'}
if(-not (Test-Path -LiteralPath (Join-Path $jarvisTarget 'JARVIS.exe')) -or -not (Test-Path -LiteralPath (Join-Path $jarvisTarget 'resources\app.asar'))){throw 'APP_PACKAGE_MISSING'}
$jarvisEvidence=[IO.Path]::GetFullPath($JarvisAclEvidence)
if(-not $jarvisEvidence.StartsWith('E:\CODEX\',[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $jarvisEvidence)){throw 'NEW_EXTERNAL_ACL_EVIDENCE_REQUIRED'}
$jarvisAcl=Get-Acl -LiteralPath $jarvisTarget
$jarvisBefore=$jarvisAcl.Sddl
foreach($jarvisPackageSid in @('S-1-15-2-1','S-1-15-2-2')){
    $jarvisSid=[Security.Principal.SecurityIdentifier]::new($jarvisPackageSid)
    $jarvisRule=[Security.AccessControl.FileSystemAccessRule]::new($jarvisSid,[Security.AccessControl.FileSystemRights]::ReadAndExecute,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
    $jarvisAcl.AddAccessRule($jarvisRule)
}
Set-Acl -LiteralPath $jarvisTarget -AclObject $jarvisAcl
@{state='APP_PACKAGE_READ_PERMISSIONS_READY';root=$jarvisTarget;beforeSddl=$jarvisBefore;afterSddl=(Get-Acl -LiteralPath $jarvisTarget).Sddl;asarSddl=(Get-Acl -LiteralPath (Join-Path $jarvisTarget 'resources\app.asar')).Sddl;grants='Read and execute only; standard application package and restricted application package SIDs';ownerProfileExcluded=$true;globalWindowsPolicyChanged=$false;at=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $jarvisEvidence -Encoding UTF8
Write-Output 'APP_SANDBOX_READ_PERMISSIONS_READY'
