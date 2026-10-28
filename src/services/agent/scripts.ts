import type { AgentEvent, ToolId } from '@/types';
import type { ModelLane, TaskType } from '@/types';

export interface ScriptStep {
  delay: number;
  tool: ToolId;
  description: string;
  /** Lane to move, if this step belongs to a model. */
  lane?: string;
  laneState?: ModelLane['state'];
  laneNote?: string;
  type?: AgentEvent['type'];
  approval?: { title: string; detail: string; target?: string; severity?: 'normal' | 'high' };
  metadata?: Record<string, unknown>;
}

export interface TaskScript {
  lanes: ModelLane[];
  steps: ScriptStep[];
  answer: string;
  sources?: { title: string; url: string }[];
}

const LANES = {
  local: { id: 'local', label: 'Local', providerId: 'local' as const, role: 'Routing' },
  gemini: { id: 'gemini', label: 'Gemini', providerId: 'google' as const, role: 'Research' },
  gpt: { id: 'gpt', label: 'GPT', providerId: 'openai' as const, role: 'Scenarios' },
  claude: { id: 'claude', label: 'Claude', providerId: 'anthropic' as const, role: 'Review' },
  quant: { id: 'quant', label: 'Quant', providerId: 'local' as const, role: 'Technical' },
};

function lane(k: keyof typeof LANES, state: ModelLane['state'] = 'idle'): ModelLane {
  return { ...LANES[k], state };
}

const marketScript = (symbol: string): TaskScript => ({
  lanes: [lane('local', 'working'), lane('gemini'), lane('gpt'), lane('claude'), lane('quant')],
  steps: [
    { delay: 260, tool: 'model', description: `Clasificando la petición como market_analysis`, lane: 'local', laneState: 'working', laneNote: 'Clasificando' },
    { delay: 420, tool: 'model', description: `Ruta seleccionada: investigación + escenarios + revisión`, lane: 'local', laneState: 'done', laneNote: 'Ruta lista' },
    { delay: 380, tool: 'browser', description: `Recuperando noticias y presentaciones de ${symbol}`, lane: 'gemini', laneState: 'working', laneNote: 'Investigando' },
    { delay: 640, tool: 'browser', description: '9 fuentes revisadas, 4 relevantes', lane: 'gemini', laneState: 'done', laneNote: '4 fuentes' },
    { delay: 300, tool: 'market_data', description: `Cargando velas y volumen de ${symbol}`, lane: 'quant', laneState: 'working', laneNote: 'Técnico' },
    { delay: 520, tool: 'market_data', description: 'Rango dominante 168–192, volumen por encima de la media de 20 sesiones', lane: 'quant', laneState: 'done', laneNote: 'Rango 168–192' },
    { delay: 420, tool: 'model', description: 'Construyendo escenarios alcista, neutral y bajista', lane: 'gpt', laneState: 'working', laneNote: 'Escenarios' },
    { delay: 700, tool: 'model', description: 'Tres escenarios con condiciones de invalidación', lane: 'gpt', laneState: 'done', laneNote: '3 escenarios' },
    { delay: 380, tool: 'model', description: 'Revisando riesgos y sesgos del análisis', lane: 'claude', laneState: 'working', laneNote: 'Riesgos' },
    { delay: 620, tool: 'model', description: 'Señalado riesgo de concentración de clientes', lane: 'claude', laneState: 'done', laneNote: '2 advertencias' },
    { delay: 320, tool: 'model', description: 'Sintetizando respuesta' },
  ],
  answer: `${symbol} cotiza dentro de un rango que concentra el volumen reciente entre 168 y 192. El escenario alcista pesa algo más (42%) por el capex anunciado, pero el bajista no es descartable mientras siga abierta la revisión de controles de exportación.\n\nLo miraría así: el nivel que invalida la lectura alcista es un cierre semanal bajo 168 con volumen creciente. Tienes los tres escenarios completos en Markets.`,
  sources: [
    { title: 'Reuters · capex hiperescaladores', url: 'https://reuters.com' },
    { title: 'Bloomberg · controles de exportación', url: 'https://bloomberg.com' },
    { title: 'DigiTimes · suministro HBM', url: 'https://digitimes.com' },
  ],
});

const fileScript = (needle: string): TaskScript => ({
  lanes: [lane('local', 'working')],
  steps: [
    { delay: 220, tool: 'model', description: 'Clasificando la petición como file_search', lane: 'local', laneState: 'working', laneNote: 'Clasificando' },
    { delay: 340, tool: 'filesystem', description: `Consultando el índice local por "${needle}"` },
    { delay: 520, tool: 'filesystem', description: '3 coincidencias en D:\\Projects', metadata: { matches: 3 } },
    { delay: 260, tool: 'model', description: 'Ordenando por relevancia y fecha', lane: 'local', laneState: 'done', laneNote: 'Listo' },
  ],
  answer: `Encontré 3 archivos que coinciden con "${needle}". El más reciente es D:\\Projects\\Vigilia\\config.json, modificado hace dos días. Los otros dos están en OldBuilds y probablemente sean copias antiguas.\n\nLos tienes abiertos en Files.`,
});

const codeScript: TaskScript = {
  lanes: [lane('local', 'working'), lane('claude'), lane('gpt')],
  steps: [
    { delay: 240, tool: 'model', description: 'Clasificando la petición como code_debugging', lane: 'local', laneState: 'working', laneNote: 'Clasificando' },
    { delay: 320, tool: 'git', description: 'Rama feat/agent-core, 7 archivos modificados', lane: 'local', laneState: 'done' },
    { delay: 480, tool: 'filesystem', description: 'Leídos 17 archivos relacionados' },
    { delay: 380, tool: 'model', description: 'Analizando la arquitectura del módulo', lane: 'claude', laneState: 'working', laneNote: 'Analizando' },
    { delay: 720, tool: 'model', description: 'Encontrada una dependencia circular entre stores y services', lane: 'claude', laneState: 'done', laneNote: '1 hallazgo' },
    { delay: 400, tool: 'model', description: 'Redactando el parche propuesto', lane: 'gpt', laneState: 'working', laneNote: 'Parche' },
    { delay: 560, tool: 'model', description: 'Parche listo para revisión', lane: 'gpt', laneState: 'done', laneNote: 'Listo' },
  ],
  answer: 'El problema no está en el componente sino en el orden de importación: `stores/useJarvisStore` importa `services/agent`, que a su vez vuelve a `stores`. Propongo mover la simulación a un módulo sin estado y que el store solo consuma eventos.\n\nTienes el parche en Coding, sin aplicar.',
};

const controlScript: TaskScript = {
  lanes: [lane('local', 'working')],
  steps: [
    { delay: 220, tool: 'model', description: 'Clasificando la petición como computer_control', lane: 'local', laneState: 'working', laneNote: 'Clasificando' },
    { delay: 320, tool: 'windows', description: 'Buscando la aplicación entre los programas instalados' },
    { delay: 420, tool: 'processes', description: 'Se requiere aprobación para lanzar un proceso', type: 'approval',
      approval: { title: 'JARVIS quiere abrir una aplicación', detail: 'Se lanzará un proceso nuevo con tu sesión de usuario.', target: 'C:\\Program Files\\Blender Foundation\\Blender\\blender.exe', severity: 'normal' } },
  ],
  answer: 'Queda a la espera de tu aprobación. En cuanto la des, abro la aplicación y te aviso cuando la ventana esté enfocada.',
};

const researchScript: TaskScript = {
  lanes: [lane('local', 'working'), lane('gemini'), lane('claude')],
  steps: [
    { delay: 240, tool: 'model', description: 'Clasificando la petición como web_research', lane: 'local', laneState: 'working', laneNote: 'Clasificando' },
    { delay: 300, tool: 'browser', description: 'Buscando fuentes primarias', lane: 'gemini', laneState: 'working', laneNote: 'Buscando' },
    { delay: 620, tool: 'browser', description: '12 resultados, 5 marcados como relevantes', lane: 'gemini', laneState: 'done', laneNote: '5 fuentes' },
    { delay: 440, tool: 'model', description: 'Resumiendo y contrastando fuentes', lane: 'claude', laneState: 'working', laneNote: 'Resumiendo' },
    { delay: 560, tool: 'model', description: 'Resumen con citas listo', lane: 'claude', laneState: 'done', laneNote: 'Listo' },
  ],
  answer: 'Reuní cinco fuentes y las contrasté. Dos coinciden en lo esencial, una lo contradice y las otras dos son secundarias.\n\nGuardé todo en Research con las citas enlazadas para que puedas revisar de dónde sale cada afirmación.',
  sources: [
    { title: 'Documentación oficial', url: 'https://electronjs.org/docs' },
    { title: 'Nota de versión', url: 'https://github.com' },
  ],
};

const chatScript: TaskScript = {
  lanes: [lane('local', 'working')],
  steps: [
    { delay: 200, tool: 'model', description: 'Resolviendo en local', lane: 'local', laneState: 'working', laneNote: 'Local' },
    { delay: 420, tool: 'model', description: 'Respuesta lista', lane: 'local', laneState: 'done', laneNote: 'Listo' },
  ],
  answer: 'Listo. Si quieres que use un modelo más grande para esto, dímelo y lo subo de nivel.',
};

export function scriptFor(taskType: TaskType, prompt: string): TaskScript {
  switch (taskType) {
    case 'market_analysis': {
      const symbol = (prompt.match(/\b(NVDA|AMD|MSFT|TSM|BTC|ETH|SPX|NDX|NVIDIA|TESLA)\b/i)?.[0] ?? 'NVDA').toUpperCase();
      return marketScript(symbol === 'NVIDIA' ? 'NVDA' : symbol);
    }
    case 'file_search': {
      const needle = prompt.match(/[\w.-]+\.(json|ts|tsx|md|pdf|png|csv|zip)/i)?.[0] ?? 'config.json';
      return fileScript(needle);
    }
    case 'code_debugging':
    case 'code_generation':
      return codeScript;
    case 'computer_control':
      return controlScript;
    case 'web_research':
    case 'summarization':
      return researchScript;
    default:
      return chatScript;
  }
}
