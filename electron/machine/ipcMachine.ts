import { app, ipcMain, shell } from 'electron';
import path from 'node:path';
import { IPC } from '../ipc';
import { osIdentityService } from './OSIdentityService';
import { SystemProfiler, adapterForPlatform } from './SystemProfiler';
import { MockHardwareAdapter } from './hardware/MockHardwareAdapter';
import { localAIManager } from './localInference';
import { recommendModels } from '../../src/machine/ModelRecommendationEngine';
import { LOCAL_MODEL_CATALOG } from '../../src/machine/catalog/localModelCatalog';
import { localModelBenchmark } from '../../src/machine/LocalModelBenchmark';
import { VersionedModelCatalog } from './VersionedModelCatalog';
import { CancellationToken } from '../../src/agent';

import { authorityHandle, allowNavigation, onAuthorityStop } from '../authority';

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

const profiler = new SystemProfiler(adapterForPlatform(), () => osIdentityService.displays());
export const bootstrapHardwareProfile = () => profiler.profile(true);
const catalog = () => new VersionedModelCatalog(path.join(app.getPath('userData'), 'model-catalog.json'));

const localAI = localAIManager;

/** One token per benchmark, so STOP AGENT can reach it. */
let benchmarkToken: CancellationToken | null = null;

export function registerMachineIpc(): void {
  onAuthorityStop(() => { benchmarkToken?.cancel('STOP'); benchmarkToken = null; });
  const M = IPC.machine;

  authorityHandle(M.identity, () => osIdentityService.identity());

  authorityHandle(M.profile, async (_e, force: unknown) => profiler.full(force === true));

  /**
   * Testing hook: swaps in a fixture adapter. Guarded so a packaged build can
   * never be pushed onto fake hardware by a renderer message.
   */
  authorityHandle(M.useFixture, (_e, fixtureId: unknown) => {
    if (process.env.JARVIS_ALLOW_FIXTURES !== '1') return { ok: false, error: 'Las fixtures sólo están disponibles en modo de pruebas.' };
    profiler.useAdapter(new MockHardwareAdapter(str(fixtureId, 'C')));
    return { ok: true };
  });

  authorityHandle(M.discoverLocalAI, async () => localAI.discover());
  authorityHandle(M.localAIState, () => localAI.current());

  authorityHandle(M.recommend, async () => {
    const { profile } = await profiler.full();
    const state = await localAI.discover();
    return recommendModels({ profile, runtimes: state.runtimes });
  });

  authorityHandle(M.catalog, () => catalog().load().entries);

  authorityHandle(M.benchmark, async (_e, runtimeId: unknown, modelId: unknown) => {
    const runtime = localAI.runtime(str(runtimeId) as never);
    if (!runtime) return { error: 'Runtime desconocido.' };
    benchmarkToken?.cancel('Reemplazado por otro benchmark');
    benchmarkToken = new CancellationToken();
    return localModelBenchmark.run(runtime, str(modelId), benchmarkToken);
  });

  authorityHandle(M.cancelBenchmark, () => {
    benchmarkToken?.cancel('Cancelado por el usuario');
    benchmarkToken = null;
    return true;
  });

  /**
   * Opens the official page and nothing else. No silent install, no download,
   * no installer execution — that is a later, explicitly assisted step.
   */
  authorityHandle(M.openOfficialSource, async (_e, url: unknown) => {
    const target = str(url);
    const allowed = LOCAL_MODEL_CATALOG.some((m) => m.officialSource === target || m.downloadPage === target)
      || target === 'https://ollama.com/download';
    if (!allowed || !/^https:\/\//i.test(target)) {
      return { ok: false, error: 'Enlace no reconocido.' };
    }
    if (!await allowNavigation(target)) return { ok: false, error: 'Destino no autorizado.' };
    await shell.openExternal(target);
    return { ok: true };
  });
}

export function unregisterMachineIpc(): void {
  Object.values(IPC.machine).forEach((channel) => {
    try { ipcMain.removeHandler(channel); } catch { /* sin handler */ }
  });
}
