import { useState } from 'react';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { Button } from '@/components/ui/Button';
import type { TaskState } from '@/fabric/types';

/** Direct user native work, using the same main service/receipts as agent tools. */
export function NativeConsole() {
  const mode = useJarvisStore(s => s.permission);
  const [executable, setExecutable] = useState('powershell.exe');
  const [cwd, setCwd] = useState('');
  const [args, setArgs] = useState('["-NoProfile","-Command","Get-Location"]');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');
  const [runId, setRunId] = useState('');
  async function execute() {
    const bridge = window.jarvis;
    if (!bridge?.authority || busy) return;
    setBusy(true); setOutput('');
    const id = crypto.randomUUID(); setRunId(id);
    const state: TaskState = { taskId: id, conversationId: id, goal: 'Ejecución nativa del usuario',
      currentTask: 'running', instructions: [], findings: [], decisions: [], evidence: [], artifacts: [],
      openQuestions: [], pendingSteps: [], completedWork: [], updatedAt: Date.now() };
    try {
      const vector: unknown = JSON.parse(args);
      if (!Array.isArray(vector) || vector.some(a => typeof a !== 'string')) throw new Error('Argumentos: usa una lista JSON de textos.');
      await bridge.authority.begin(id, JSON.stringify({ executable, cwd, args }));
      await bridge.fabric.saveTask(state);
      const result = await bridge.authority.execute(id, 'terminal.execute', { executable, cwd, args: vector });
      state.currentTask = result.status === 'CANCELLED' ? 'cancelled' : result.ok && result.status === 'SUCCESS' ? 'completed' : 'failed';
      state.evidence = result.evidence; state.updatedAt = Date.now();
      await bridge.fabric.saveTask(state);
      setOutput(JSON.stringify(result, null, 2));
    } catch (error) {
      state.currentTask = 'failed'; state.updatedAt = Date.now();
      await bridge.fabric.saveTask(state);
      setOutput(String(error));
    } finally { setBusy(false); }
  }
  const input = 'w-full h-8 rounded-md bg-raised border border-hairline px-2 text-xs font-mono';
  return <section data-native-console data-testid="native-console" className="py-4 space-y-2">
    <h2 className="text-sm">Trabajo nativo · {mode}</h2>
    <p className="text-xs text-muted">Directorio absoluto, sin registrar un proyecto. No eleva privilegios de Windows.</p>
    <input className={input} name="executable" aria-label="Ejecutable nativo" value={executable} onChange={e => setExecutable(e.target.value)} />
    <input className={input} name="cwd" aria-label="Directorio nativo" value={cwd} onChange={e => setCwd(e.target.value)} placeholder="C:\\ruta\\de\\trabajo" />
    <textarea className={input + ' h-20'} name="args" aria-label="Argumentos nativos" value={args} onChange={e => setArgs(e.target.value)} />
    <div className="flex gap-2">
      <Button data-native-execute aria-label="Ejecutar nativo" disabled={busy} onClick={() => void execute()}>Ejecutar</Button>
      <Button aria-label="STOP nativo" onClick={() => void window.jarvis?.authority.stop()}>STOP</Button>
    </div>
    <span data-testid="native-run-id" className="text-2xs text-faint">{runId}</span>
    <pre data-testid="native-output" className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{output}</pre>
  </section>;
}
