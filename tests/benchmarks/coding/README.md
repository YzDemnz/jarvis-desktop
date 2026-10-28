# Benchmark de programación multifichero

Tres casos curados, propios, con contratos de aplicación: integración de una dependencia interna; dinero y unidades entre módulos; migración coherente de cotización y checkout. Son más exigentes que los dos ejercicios anteriores, pero **no son reparaciones de repositorios de producción** ni demuestran programación autónoma general.

Cada caso tiene tres módulos fuente. `dependency-contract/src/cart.cjs` supera 1600 caracteres con operaciones funcionales de carrito y pruebas de regresión; permite observar la exclusión conocida de archivos grandes. Los casos de invoice y cotización requieren reparar dos consumidores en la referencia del autor. Una solución alternativa que conserve los contratos y pase los criterios originales también es válida.

`project/tests/` y `project/package.json` se copian y congelan **antes de inferencia**. El driver añade `tests/criteria.json` al mismo root, de modo que el recibo main puede enlazar el criterio real. Los prompts describen el problema y no incluyen la solución. `reference-fixes.json` queda fuera de todos los roots registrados; sólo sirve para validar la calidad del benchmark con Node, nunca se aplica durante la corrida del modelo.

La validación de fixtures exige tres señales por caso: baseline realmente falla, referencia pasa con exactamente las mismas pruebas y una regresión independiente vuelve a fallar. Conserva stdout/stderr completos y hashes. Esta validación no usa IA.

Desde PowerShell, en `E:\CODEX\Aplicaciones\JARVIS\Proyecto`:

```powershell
. 'E:\CODEX\Aplicaciones\JARVIS\Dependencias\Entorno-JARVIS.ps1'
node tools/coding-benchmark-fixtures.mjs --validate
# Requiere el build nativo ya preparado. Usa el modelo local provisionado, sin descargas.
$env:JARVIS_BENCHMARK_LABEL = 'electron44-baseline'
node tests/windows/coding-benchmark.test.mjs
```

Para comparar una mejora, usar otro label y ejecutar de nuevo. Cada ejecución crea proyectos y un perfil SQLite nuevos; nunca resetea intentos anteriores. Para paquete, definir `JARVIS_EXE` con la ruta absoluta del ejecutable. `JARVIS_BENCHMARK_CASES` admite IDs separados por comas. `JARVIS_BENCHMARK_EXPECT_PASS=1` hace fallar el proceso si la calidad no llega a todos los casos; por defecto un benchmark completado devuelve su tasa real, incluso cuando hay fallos conservados.

El driver admite tareas mediante input y click Home reales, exige procedencia local en el journal main, compara hashes de pruebas/manifiesto, verifica que main incluya sus hashes, y ejecuta de forma independiente las mismas pruebas. Clasifica `NO_CONTEXT`, `NO_PROPOSAL`, `TIMEOUT`, `PATCH_REJECTED`, `NO_SOURCE_PATCH`, `CHECK_FAILED` y ausencia de recibos. Las métricas de contexto dependen de lo que registre main; su ausencia se declara `UNKNOWN`. Conserva fallos, proyectos mutados, comandos, recibos, capturas y tiempos en carpetas distintas.

El único perfil reutilizado para provisionamiento es un fixture anterior cerrado, no el perfil del propietario. La IA usa Qwen3-4B existente; Ollama se apunta a un puerto sin servidor, la política de APIs pagadas debe ser falsa y toda la ejecución debe residir en `E:\CODEX`. Esto es aislamiento de datos de prueba; **no es un sandbox de Windows**.

## Comparar dos corridas conservadas

```powershell
node tools/coding-benchmark-compare.mjs electron44-baseline electron44-context --output 'E:\CODEX\Aplicaciones\JARVIS\Proyecto\docs\evidence\electron44-20261011\coding-comparison.json'
```

Los argumentos pueden ser rutas a `result.json`, carpetas de corrida o labels. Un label selecciona el resultado completado más reciente con ese prefijo y registra la ruta exacta elegida. El comparador es puro: lee evidencia guardada, no ejecuta IA ni procesos de JARVIS. No exige que todos los casos pasen.

Sólo compara calidad cuando coincide `criteriaHash` por caso; diferencias de Electron/ABI/modelo/parámetros se presentan como variables observadas. Un resultado sólo cuenta como VERIFIED si constan pruebas independientes exitosas, criterio intacto, hash enlazado en main, recibo main VERIFIED e inteligencia real observada. Mantiene separados los contratos curados del benchmark y la ejecución de IA real.

Para recomendar inversión, distingue archivos fuente ausentes en la entrada (recuperación), archivos recibidos pero excluidos al construir el prompt (contexto), parches que fallan con cobertura registrada (calidad limitada del modelo o loop) y tiempos observados. La ausencia de métricas se declara UNKNOWN. Ninguna correlación de una corrida atribuye por sí sola el fallo a un modelo ni justifica hardware o un especialista externo.
