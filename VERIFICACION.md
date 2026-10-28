# Verificación de la copia publicada

Fecha: 27 de octubre de 2026. Plataforma: Windows de 64 bits.

## Comprobaciones ejecutadas

- `tsc --noEmit`: aprobado sobre la copia publicable, con las dependencias ya instaladas del proyecto.
- `tests/unit/adv-verification.test.ts`: 14 casos aprobados.
- `tests/unit/adv-concilius.test.ts`: 17 casos aprobados.
- `tests/unit/project-check-evidence.test.ts`: 12 casos aprobados.
- Adaptador SQLite de la prueba: Electron 44.9.3, SQLite 13.0.3, ABI Node API comprobada por el runner.

Comando de las tres suites:

```powershell
node tools/test-adv-unit.mjs tests/unit/adv-verification.test.ts tests/unit/adv-concilius.test.ts tests/unit/project-check-evidence.test.ts
```

## Alcance

Se probaron contratos de verificación, continuidad, persistencia de evidencia, cancelación y recuperación del journal. No se reconstruyó el instalador ni se repitió la suite completa de Windows. Las comprobaciones no acreditan autonomía general ni el funcionamiento de todos los proveedores remotos. Los fixtures con cadenas que simulan secretos emplean valores sintéticos en la copia pública. Las dependencias instaladas se mantienen fuera del repositorio.
