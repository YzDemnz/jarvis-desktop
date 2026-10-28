import path from 'node:path';
import fs from 'node:fs';
import { NodeProcessPort } from '../dev/nodePorts';
import { assertProcessScope, spawnWindowsJob } from './WindowsJobProcess';
import type { ApplicationLaunchResult } from '../../src/desktop/adapter';

export interface Shortcut { target: string; args?: string; cwd?: string }
export function applicationLaunch(target: string, shortcut?: Shortcut) {
  const file = shortcut?.target ?? target;
  // Strict owned-launch primitive. Shell activation is a separate operation;
  // it never adopts a foreign broker's PID.
  if (!path.isAbsolute(file) || !/\.(exe|com)$/i.test(file) || !fs.statSync(file).isFile()) throw Error('APPLICATION_OWNERSHIP_UNAVAILABLE: requires a direct executable');
  const cwd = shortcut?.cwd && fs.existsSync(shortcut.cwd) ? shortcut.cwd : path.dirname(file);
  return { file, args: shortcut?.args ? [shortcut.args] : [], cwd, env: new NodeProcessPort().baseEnv(), windowsVerbatimArguments: !!shortcut?.args, visible: true };
}
export async function launchOwnedApplication(target: string, readShortcut: (p: string) => Shortcut) {
  const req = applicationLaunch(target, /\.lnk$/i.test(target) ? readShortcut(target) : undefined);
  const proc = spawnWindowsJob(req);
  const pid = await proc.ready!;
  return { pid, uacPrompted: false, ownership: 'WINDOWS_JOB' as const, stopScope: 'OWNED_PROCESS_FAMILY' as const, externalInstance: 'UNKNOWN' as const };
}

/** Activation success is not proof of a new owned application instance. */
export async function activateApplication(target: string, readShortcut: (p: string) => Shortcut,
  open: (target: string) => Promise<string>, requireOwnership = false): Promise<ApplicationLaunchResult> {
  const external = async (): Promise<ApplicationLaunchResult> => {
    if (requireOwnership) throw Error('APPLICATION_OWNERSHIP_UNAVAILABLE');
    if (!path.isAbsolute(target) || !/\.(lnk|url|appref-ms|exe|com)$/i.test(target) || !fs.statSync(target).isFile()) throw Error('APPLICATION_ACTIVATION_UNAVAILABLE');
    assertProcessScope();
    const error = await open(target);
    if (error) throw Error('APPLICATION_ACTIVATION_FAILED');
    return { pid: null, uacPrompted: false, ownership: 'UNOWNABLE', stopScope: 'NONE', externalInstance: 'UNKNOWN',
      limitation: 'External shell activation/reuse; STOP never adopts or kills an external instance.' };
  };
  let req;
  try { req = applicationLaunch(target, /\.lnk$/i.test(target) ? readShortcut(target) : undefined); }
  catch {
    return external();
  }
  let proc: ReturnType<typeof spawnWindowsJob> | undefined;
  try {
    proc = spawnWindowsJob(req); const pid = await proc.ready!;
    return { pid, uacPrompted: false, ownership: 'WINDOWS_JOB', stopScope: 'OWNED_PROCESS_FAMILY', externalInstance: 'UNKNOWN' };
  } catch {
    // Ensure the failed owned attempt has closed before trying shell activation.
    await proc?.killTree(); return external();
  }
}
