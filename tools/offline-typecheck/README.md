# Typecheck sin node_modules

Este directorio sólo hace falta cuando **no se puede instalar nada** (sin red).
Contiene declaraciones mínimas de `react`, `react-dom`, `zustand`,
`framer-motion`, `lucide-react` y `electron`, suficientes para que `tsc`
verifique todo el código propio del proyecto en modo estricto.

```
tsc -p tools/offline-typecheck/tsconfig.json
python3 tools/offline-typecheck/gen-lucide.py   # regenera el stub de iconos
```

Con `node_modules` instalado esto sobra: usa `npm run typecheck`, que compila
contra los tipos reales y es la fuente de verdad.
