# jarvis-automation-helper

Proceso nativo de Windows que expone UI Automation, gestión de ventanas,
entrada sintética y captura de pantalla a JARVIS mediante un protocolo cerrado.

## Protocolo

Una petición JSON por línea en stdin, una respuesta por línea en stdout.

```json
{ "requestId": "r1", "command": "uiInvoke", "args": { "elementId": "el:42" } }
{ "requestId": "r1", "ok": true }
```

Eventos no solicitados: `{ "event": "humanInput", "data": { "kind": "mouse", "at": 1700000000000 } }`.

El vocabulario completo está en `Program.cs` y es idéntico al de
`electron/desktop/protocol.ts`. Cada lado valida por su cuenta: comando
conocido, exactamente los argumentos declarados, cada uno del tipo declarado.

## Lo que el helper no puede hacer

No existe ningún comando para ejecutar un shell, PowerShell, scripts, código
arbitrario ni cargar DLLs. No es que estén deshabilitados: no están.

Se ejecuta `asInvoker` y nunca pide elevación. No interactúa con el escritorio
seguro (UAC, Ctrl+Alt+Supr): con la sesión bloqueada o en Winlogon, todos los
comandos interactivos se rechazan.

Los campos de credenciales (`IsPassword` o nombre/automationId que lo
indique) nunca devuelven su valor —sólo `filled: true/false`— y `uiSetValue`
se niega a escribir en ellos. Es la segunda barrera; la primera está en JARVIS.

`closeWindow` envía `WM_CLOSE`, nunca mata el proceso: la aplicación puede
mostrar su diálogo de guardado y el helper no tiene forma de responderlo.

## Compilar

Requiere .NET 8 SDK en Windows.

```
dotnet publish -c Release
```

Genera `jarvis-automation-helper.exe` autocontenido. JARVIS lo busca en
`resources/native/` del paquete, o en la ruta indicada por
`JARVIS_AUTOMATION_HELPER` durante el desarrollo.

## Estado

**Código fuente escrito, nunca compilado ni ejecutado.** El entorno donde se
desarrolló no tiene Windows ni .NET. El protocolo sí está probado desde el lado
de Electron contra un helper falso que habla el mismo formato; ver
`docs/WINDOWS_CONTROL_VALIDATION.md`.
