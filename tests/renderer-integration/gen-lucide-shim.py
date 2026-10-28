import re, os
names = set()
for root, dirs, files in os.walk('src'):
    for f in files:
        if f.endswith(('.ts', '.tsx')):
            s = open(os.path.join(root, f)).read()
            for m in re.finditer(r"import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'lucide-react'", s, re.S):
                for n in m.group(1).split(','):
                    n = n.strip()
                    if n: names.add(n.split(' as ')[0].strip())
body = """import { createElement, forwardRef } from 'react';

/**
 * Harness-only lucide-react. Each icon renders a real <svg> carrying its name,
 * so tests can target an icon without depending on the actual path data.
 * Regenerate with: python3 tests/renderer-integration/gen-lucide-shim.py
 */
function icon(name: string) {
  const Component = forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
    createElement('svg', { ...props, ref, 'data-icon': name, viewBox: '0 0 24 24', width: 16, height: 16 }));
  Component.displayName = name;
  return Component;
}

export type LucideIcon = ReturnType<typeof icon>;
"""
body += "\n".join(f"export const {n} = icon('{n}');" for n in sorted(names)) + "\n"
open('tests/renderer-integration/shims/lucide-react.tsx', 'w').write(body)
print(len(names), "iconos en el shim del arnés")
