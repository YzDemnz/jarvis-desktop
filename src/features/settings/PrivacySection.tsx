import { Lock, ShieldCheck } from 'lucide-react';
import { useMachineStore } from '@/stores/useMachineStore';
import { Button } from '@/components/ui/Button';
import { useUIStore } from '@/stores/useUIStore';

interface Row {
  label: string;
  value: string;
  tone?: 'moss' | 'muted';
  hint?: string;
}

/**
 * States plainly what JARVIS is and is not. Every line here corresponds to a
 * decision already made in the architecture, not an aspiration: there is no
 * account system to sign into, no sync endpoint, and no password storage.
 */
export function PrivacySection() {
  const { firstRunConfig, identity, reconfigure } = useMachineStore();
  const setModule = useUIStore((s) => s.setModule);

  const rows: Row[] = [
    { label: 'Cuenta JARVIS', value: 'Ninguna', tone: 'moss', hint: 'No existe registro ni inicio de sesión.' },
    { label: 'Identidad', value: identity ? 'Perfil del sistema' : 'Perfil del sistema (sin proceso principal)', hint: identity ? `${identity.username} · ${identity.computerName}` : undefined },
    { label: 'Sincronización en la nube', value: 'Desactivada', tone: 'moss' },
    { label: 'Telemetría', value: 'Desactivada', tone: 'moss' },
    { label: 'Almacenamiento de contraseñas', value: 'Deshabilitado', tone: 'moss', hint: 'Inicias sesión dentro del navegador; JARVIS nunca ve la contraseña.' },
    {
      label: 'Sesiones de sitios web',
      value: firstRunConfig.sessionPolicy === 'keep' ? 'Se mantienen' : 'Se borran al cerrar',
      hint: 'Una sesión no es una contraseña.',
    },
    { label: 'Información del sistema', value: 'Sólo en este equipo', tone: 'moss', hint: 'El perfil de hardware nunca sale de la máquina.' },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-hairline bg-panel p-4" data-testid="privacy-rows">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-3.5 w-3.5 text-moss" strokeWidth={1.8} />
          <h3 className="text-sm text-ink">JARVIS es local</h3>
        </div>
        <dl className="grid grid-cols-[200px_1fr] gap-y-2.5 text-xs">
          {rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-faint">{r.label}</dt>
              <dd>
                <span className={r.tone === 'moss' ? 'text-moss' : 'text-ink/90'}>{r.value}</span>
                {r.hint && <span className="block text-2xs text-faint mt-0.5">{r.hint}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-lg border border-hairline bg-panel p-4">
        <div className="flex items-start gap-2.5">
          <Lock className="h-3.5 w-3.5 text-faint mt-0.5 shrink-0" strokeWidth={1.7} />
          <p className="text-xs text-muted leading-relaxed">
            Los campos sensibles —contraseñas, PIN, códigos de un solo uso, 2FA y códigos de
            recuperación— se eliminan antes de que cualquier texto de página, instantánea del DOM,
            evento del agente o entrada de auditoría exista. Un modelo nunca llega a verlos.
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-hairline bg-panel p-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <h3 className="text-sm text-ink">Reconfigurar JARVIS</h3>
            <p className="text-xs text-muted mt-1">
              Vuelve a analizar el equipo y a elegir el nivel de acceso y las sesiones.
            </p>
          </div>
          <Button
            size="md" variant="quiet" className="ml-auto shrink-0"
            data-testid="reconfigure"
            onClick={() => { setModule('home'); reconfigure(); }}
          >
            Reconfigurar
          </Button>
        </div>
      </section>
    </div>
  );
}
