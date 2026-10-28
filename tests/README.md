# Pruebas

Tres niveles. No son equivalentes: ver `docs/RUNTIME_VALIDATION.md`.

```
tests/unit/                 lógica pura y machine    (tsx, Node)
tests/electron-double/      main real vs fake-electron (tsx, Node)
tests/renderer-integration/ renderer real en Chromium  (esbuild + Playwright)
```

| Comando | Qué ejecuta |
|---|---|
| `npm run test:logic` | router, guiones, omnibox, formato |
| `npm run test:machine` | identidad, perfilado, fingerprint, presupuesto, recomendación, benchmark, capacidades, contexto, first run, credenciales |
| `npm run test:browser` | `TabManager` real contra el doble de Electron |
| `npm run test:agent` | broker, runtime, permisos, aprobaciones, auditoría, servicios de main |
| `npm run test:renderer` | **la UI real en Chromium**: atajos, runs, aprobaciones, STOP AGENT, fugas, responsive |
| `npm test` | las cuatro |

El arnés del renderer bundlea `src/` con esbuild y lo sirve en `127.0.0.1:5399`.
Sustituye únicamente `zustand`, `framer-motion` y `lucide-react` mediante
`tsconfig paths`; el resto es código de producción sin tocar. Tailwind no está
disponible, así que la apariencia queda fuera de alcance.
