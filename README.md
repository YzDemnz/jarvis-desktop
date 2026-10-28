# JARVIS Desktop

Estación de trabajo personal para Windows con interfaz Electron/React, lógica TypeScript, almacenamiento SQLite y helpers nativos en C#. Proyecto personal de Jesús Leonardo Martínez Rodríguez.

## Qué demuestra

El interés técnico está en separar la interfaz, la selección de proveedores, el lugar de ejecución y la autoridad sobre los efectos. Una respuesta de transporte correcta no equivale a una tarea verificada. La aplicación conserva identificadores de tarea y operación, checkpoints, recibos y criterios de verificación.

```text
Interfaz React + Zustand + Monaco
                 |
Preload / contratos IPC explícitos
                 |
Main: autoridad, tareas, memoria, políticas y verificación
       |                    |                   |
Intelligence Fabric   Execution Fabric      Tool Broker
  proveedores         selección de backend   permisos / aprobaciones
       |                    |                   |
Ollama / adaptadores    sesiones y artefactos   servicios Windows
                                               helpers C# / procesos
                 |
SQLite / journal / checkpoints / recibos
```

## Decisiones de arquitectura

- **TaskId / OperationId:** continuidad de una tarea con admisiones distintas por operación.
- **Autoridad en main:** la selección de un proveedor no concede permisos a sus herramientas.
- **Intelligence Fabric:** contratos de conexión, selección y uso de proveedores.
- **Execution Fabric:** contratos y selección de entornos; sus pruebas de concepto no equivalen a aislamiento universal ni a integración productiva de todos los backends.
- **Tool Broker:** capacidades nombradas, políticas, aprobaciones, cancelación y auditoría.
- **Memoria:** SQLite, referencias verificables y contexto acotado.
- **SecretRef:** referencias a secretos, sin incluir valores en contexto público.
- **Verificación:** separar resultado del transporte, resultado de la operación y evidencia del artefacto.

## Mapa del código

| Ruta | Responsabilidad |
| --- | --- |
| `electron/` | Proceso principal, IPC, navegador, memoria y servicios |
| `src/` | Interfaz React, estado y contratos de los subsistemas |
| `native/windows-helper/` | Integración nativa Windows en C# |
| `native/process-host/` | Host de procesos y ciclo de vida |
| `tests/` | Pruebas unitarias, dobles Electron e integración Windows |
| `tools/` | Construcción, pruebas y preparación de helpers |
| `third_party/` | Procedencia y avisos de dependencias |

## Desarrollo

Requiere Windows, Node.js compatible con el lockfile y .NET 8 para compilar los helpers. Instala las dependencias desde el registro mediante `npm ci`. Los proveedores locales requieren su propia instalación y modelos; los remotos, credenciales propias.

```powershell
npm ci
npm run typecheck
npm run test:all-portable
npm run test:renderer
npm run dev
```

La construcción completa utiliza `npm run build:dir` y necesita los componentes nativos indicados en `package.json`. No se distribuyen dependencias instaladas ni binarios de proveedores.

## Estado y límites

Snapshot de desarrollo 0.4.5-dev. Algunas superficies de la interfaz conservan datos simulados. Los adaptadores y backends tienen distintos grados de implementación; su existencia no demuestra autonomía general. Las comprobaciones portables y las pruebas Windows son conjuntos distintos. El historial de resultados del equipo original no se presenta como una ejecución nueva en otra máquina. El CV no atribuye calidad universal de programación a los modelos locales.

## Distribución

Este repositorio publica fuentes, fixtures y avisos de terceros para revisión técnica. Excluye perfiles, conversaciones, credenciales, cachés, modelos y paquetes instalados. Conserva `THIRD_PARTY_NOTICES.md` y los avisos disponibles en `third_party/`. No se concede una licencia nueva sobre componentes de terceros.
