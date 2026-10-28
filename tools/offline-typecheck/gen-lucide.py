import re,os
names=set()
for root,d,fs in os.walk('src'):
    for f in fs:
        if f.endswith(('.ts','.tsx')):
            s=open(os.path.join(root,f)).read()
            for m in re.finditer(r"import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'lucide-react'",s,re.S):
                for n in m.group(1).split(','):
                    n=n.strip()
                    if n: names.add(n.split(' as ')[0].strip())
out=["declare module 'lucide-react' {","  export type LucideIcon = (props: any) => any;"]
out+= [f"  export const {n}: LucideIcon;" for n in sorted(names)]
out.append("}")
open('tools/offline-typecheck/shims/lucide.d.ts','w').write("\n".join(out)+"\n")
print(len(names),"iconos")
