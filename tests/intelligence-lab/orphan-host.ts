import { ACPProcessManager } from '../../src/intelligence/transports/acp/ACPProcessManager';
import { fakeProfile } from './lab-harness';
const manager = new ACPProcessManager(fakeProfile(), process.argv[2]!);
await manager.start();
process.send?.({ guardian: manager.child!.pid, child: manager.ownedPid });
await new Promise(() => {});
