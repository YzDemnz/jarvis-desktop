import { useState } from 'react';
import type { SettingsSection } from '@/stores/useSettingsStore';
import { useDesktopStore } from '@/stores/useDesktopStore';
import { UIInspector } from '@/features/desktop/UIInspector';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { mockProviders } from '@/mocks/providers';
import { ConnectedAISection } from './ConnectedAISection';
import { SystemSection } from './SystemSection';
import { LocalAISection } from './LocalAISection';
import { PrivacySection } from './PrivacySection';
import { TOOL_REGISTRY } from '@/services/agent/tools';
import { Field, Select, TextInput, Toggle } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { PermissionControl } from '@/components/PermissionControl';
import { NativeConsole } from './NativeConsole';

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'system', label: 'Sistema' },
  { id: 'localai', label: 'IA local' },
  { id: 'appearance', label: 'Apariencia' },
  { id: 'providers', label: 'Proveedores de IA' },
  { id: 'models', label: 'Modelos' },
  { id: 'routing', label: 'Enrutado' },
  { id: 'permissions', label: 'Permisos del agente' },
  { id: 'shortcuts', label: 'Atajos' },
  { id: 'browser', label: 'Navegador' },
  { id: 'storage', label: 'Almacenamiento' },
  { id: 'vault', label: 'Vault' },
  { id: 'privacy', label: 'Privacidad' },
  { id: 'updates', label: 'Actualizaciones' },
  { id: 'developer', label: 'Desarrollo' },
];

export function SettingsView() {
  const s = useSettingsStore();

  return (
    <div className="h-full flex min-h-0">
      <aside className="w-[196px] shrink-0 hairline-r bg-graphite/60 overflow-y-auto scroll-thin py-2">
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            onClick={() => s.setSection(sec.id)}
            className={cn(
              'relative w-full text-left h-8 px-4 text-sm transition-colors',
              sec.id === s.section ? 'text-ink bg-white/[0.05]' : 'text-muted hover:text-ink hover:bg-white/[0.03]',
            )}
          >
            {sec.id === s.section && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-signal" />}
            {sec.label}
          </button>
        ))}
      </aside>

      <div className="flex-1 min-w-0 overflow-y-auto scroll-thin">
        <div className="max-w-[700px] px-8 py-8">
          <h1 className="text-lg text-ink tracking-tight mb-6">
            {SECTIONS.find((x) => x.id === s.section)?.label}
          </h1>
          <Section />
        </div>
      </div>
    </div>
  );
}

function Section() {
  const s = useSettingsStore();

  switch (s.section) {
    case 'general':
      return (
        <div className="divide-y divide-hairline">
          <Field label="Módulo de inicio" hint="Lo que verás al abrir JARVIS">
            <Select
              value={s.startModule}
              onChange={(v) => s.patch({ startModule: v })}
              options={[
                { value: 'home', label: 'Home' },
                { value: 'browser', label: 'Browser' },
                { value: 'markets', label: 'Markets' },
                { value: 'coding', label: 'Coding' },
              ]}
            />
          </Field>
          <Field label="Densidad" hint="Cuánto aire tiene la interfaz">
            <Select
              value={s.density}
              onChange={(v) => s.patch({ density: v as 'compact' | 'comfortable' })}
              options={[{ value: 'comfortable', label: 'Cómoda' }, { value: 'compact', label: 'Compacta' }]}
            />
          </Field>
          <Field label="Telemetría" hint="Nada sale del equipo mientras esté apagada">
            <Toggle checked={s.telemetry} onChange={(v) => s.patch({ telemetry: v })} label="Telemetría" />
          </Field>
        </div>
      );

    case 'appearance':
      return (
        <div className="divide-y divide-hairline">
          <Field label="Color de acento" hint="Se usa en foco, selección y el núcleo del orbe">
            <div className="flex items-center gap-1.5">
              {['#79A9FF', '#63C4C9', '#3FB68B', '#C0A16B', '#9B7FD4'].map((c) => (
                <button
                  key={c}
                  onClick={() => { s.patch({ accent: c }); document.documentElement.style.setProperty('--accent', c); }}
                  className={cn('h-6 w-6 rounded-xs border transition-transform', s.accent === c ? 'border-ink scale-105' : 'border-hairline')}
                  style={{ background: `${c}33` }}
                  aria-label={`Acento ${c}`}
                />
              ))}
            </div>
          </Field>
          <Field label="Reducir movimiento" hint="Desactiva las animaciones del orbe y los paneles">
            <Toggle checked={s.reduceMotion} onChange={(v) => s.patch({ reduceMotion: v })} label="Reducir movimiento" />
          </Field>
        </div>
      );

    case 'providers':
      return <ConnectedAISection />;

    case 'models':
      return (
        <div className="space-y-4">
          {mockProviders.map((p) => (
            <div key={p.id}>
              <h2 className="text-xs text-faint mb-1.5">{p.label}</h2>
              <div className="surface rounded-lg divide-y divide-hairline">
                {p.models.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-3.5 h-11">
                    <span className="text-sm text-ink/90 w-28 truncate">{m.label}</span>
                    <Badge tone="signal">{m.tier}</Badge>
                    <span className="text-2xs text-faint tnum">{(m.contextWindow / 1000).toFixed(0)}k contexto</span>
                    <div className="ml-auto flex items-center gap-1">
                      {m.capabilities.vision && <Badge tone="muted">visión</Badge>}
                      {m.capabilities.reasoning && <Badge tone="muted">razonamiento</Badge>}
                      {m.local && <Badge tone="moss">local</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );

    case 'routing':
      return (
        <div className="divide-y divide-hairline">
          <Field label="Router local" hint="Un modelo pequeño clasifica cada petición antes de elegir el modelo grande">
            <Toggle checked={s.routerEnabled} onChange={(v) => s.patch({ routerEnabled: v })} label="Router local" />
          </Field>
          <Field label="Modelo del router">
            <Select
              value={s.routerModel}
              onChange={(v) => s.patch({ routerModel: v })}
              options={mockProviders.flatMap((p) => p.models.map((m) => ({ value: m.id, label: `${p.label} · ${m.label}` })))}
            />
          </Field>
          {(['LOCAL', 'FAST', 'STANDARD', 'REASONING', 'MAX'] as const).map((tier) => (
            <Field key={tier} label={`Nivel ${tier}`} hint={`Proveedor preferido cuando el router elige ${tier}`}>
              <Select
                value={s.tierOverrides[tier]}
                onChange={(v) => s.patch({ tierOverrides: { ...s.tierOverrides, [tier]: v } })}
                options={[{ value: 'auto', label: 'Automático' }, ...mockProviders.map((p) => ({ value: p.id, label: p.label }))]}
              />
            </Field>
          ))}
        </div>
      );

    case 'permissions':
      return (
        <div>
          <div className="divide-y divide-hairline mb-6">
            <Field label="Modo de acceso" hint="Decisión persistente del usuario en el menú nativo. No otorga elevación Windows.">
              <PermissionControl />
            </Field>
          </div>

          <h2 className="text-xs text-faint mb-2">Herramientas</h2>
          <div className="surface rounded-lg divide-y divide-hairline">
            {TOOL_REGISTRY.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-3.5 h-12">
                <div className="min-w-0 w-40">
                  <div className="text-sm text-ink/90">{t.name}</div>
                  <div className="text-2xs text-faint truncate">{t.description}</div>
                </div>
                <Badge tone={t.requiredPermission === 'ADMIN' ? 'clay' : t.requiredPermission === 'CONTROL' ? 'amber' : 'muted'}>
                  {t.requiredPermission}
                </Badge>
                {(t.risk === 'DESTRUCTIVE' || t.risk === 'CRITICAL') && <Badge tone="clay">{t.risk.toLowerCase()}</Badge>}
                {!t.enabled && <Badge tone="muted">deshabilitada</Badge>}
                <span className="ml-auto text-2xs text-faint">{t.strategy.replace('_', ' ')}</span>
                <Toggle checked={t.enabled} onChange={() => {}} label={t.name} />
              </div>
            ))}
          </div>
          <p className="text-2xs text-faint mt-3">
            El orden de interacción va de lo más seguro a lo último: API directa, DOM del navegador,
            UI Automation, visión y sólo al final teclado y ratón.
          </p>
        </div>
      );

    case 'shortcuts':
      return (
        <div className="space-y-4">
        <EmergencyShortcut />
        <div className="surface rounded-lg divide-y divide-hairline">
          {s.shortcuts.map((sc) => (
            <div key={sc.id} className="flex items-center gap-3 px-3.5 h-11">
              <span className="text-sm text-ink/90 flex-1">{sc.label}</span>
              {sc.scope === 'global' && <Badge tone="signal">global</Badge>}
              <kbd className="text-xs font-mono text-muted border border-hairline rounded-xs px-2 h-6 leading-[22px]">
                {sc.combo}
              </kbd>
              <Button variant="ghost" size="xs" disabled={!sc.editable}>Cambiar</Button>
            </div>
          ))}
        </div>
        </div>
      );

    case 'browser':
      return (
        <div className="divide-y divide-hairline">
          <Field label="Buscador" hint="Se usa cuando lo que escribes no es una dirección ni una orden">
            <Select
              value={s.searchEngine}
              onChange={(v) => s.patch({ searchEngine: v })}
              options={[{ value: 'DuckDuckGo', label: 'DuckDuckGo' }, { value: 'Google', label: 'Google' }, { value: 'Brave', label: 'Brave' }]}
            />
          </Field>
          <Field label="Bloquear rastreadores">
            <Toggle checked={s.blockTrackers} onChange={(v) => s.patch({ blockTrackers: v })} label="Bloquear rastreadores" />
          </Field>
          <Field label="Motor" hint="Chromium integrado en Electron, con la interfaz separada del motor">
            <span className="text-xs text-faint">WebContentsView</span>
          </Field>
        </div>
      );

    case 'storage':
      return (
        <div className="divide-y divide-hairline">
          <Field label="Carpeta de trabajo" hint="Dónde guarda JARVIS índices y cachés">
            <TextInput value="D:\\JARVIS\\data" onChange={() => {}} mono />
          </Field>
          <Field label="Sincronizar con GitHub" hint="Sólo código, configuración, prompts y registro de modelos. Nunca secretos">
            <Toggle checked onChange={() => {}} label="Sincronizar con GitHub" />
          </Field>
        </div>
      );

    case 'vault':
      return (
        <div className="divide-y divide-hairline">
          <Field label="Origen de la clave maestra" hint="La decisión final se toma cuando exista el broker">
            <Select value="dpapi" onChange={() => {}} options={[{ value: 'dpapi', label: 'Windows DPAPI' }, { value: 'tpm', label: 'TPM' }, { value: 'passphrase', label: 'Frase de paso' }]} />
          </Field>
          <Field label="Bloquear tras inactividad">
            <Select value="15" onChange={() => {}} options={[{ value: '5', label: '5 minutos' }, { value: '15', label: '15 minutos' }, { value: '60', label: '1 hora' }]} />
          </Field>
          <Field label="Los modelos reciben el valor" hint="Esto no se puede activar por diseño">
            <Toggle checked={false} onChange={() => {}} label="Los modelos reciben el valor" />
          </Field>
        </div>
      );

    case 'system':
      return <SystemSection />;

    case 'localai':
      return <LocalAISection />;

    case 'privacy':
      return <PrivacySection />;

    case 'updates':
      return (
        <div className="divide-y divide-hairline">
          <Field label="Versión">
            <span className="text-xs tnum text-muted">0.1.0 · V1 frontend</span>
          </Field>
          <Field label="Canal">
            <Select value="dev" onChange={() => {}} options={[{ value: 'dev', label: 'Desarrollo' }, { value: 'stable', label: 'Estable' }]} />
          </Field>
          <Field label="Buscar al iniciar">
            <Toggle checked onChange={() => {}} label="Buscar al iniciar" />
          </Field>
        </div>
      );

    case 'developer':
      return (
        <div className="divide-y divide-hairline">
          <NativeConsole />
          <Field label="Modo desarrollador" hint="Muestra la decisión del router y los eventos crudos en cada respuesta">
            <Toggle checked={s.devMode} onChange={(v) => s.patch({ devMode: v })} label="Modo desarrollador" />
          </Field>
          <div className="py-4" data-testid="settings-ui-inspector">
            <div className="text-sm text-ink/90 mb-1">Inspector de UI</div>
            <p className="text-xs text-muted mb-3">
              Árbol accesible de la ventana seleccionada: nombre, tipo, automationId, patrones.
              Los campos de credenciales nunca muestran su valor.
            </p>
            <UIInspector />
          </div>
          <Field label="Restablecer preferencias" hint="Borra lo guardado en el equipo y vuelve al estado inicial">
            <Button
              variant="danger"
              onClick={() => {
                localStorage.removeItem('jarvis.ui');
                localStorage.removeItem('jarvis.settings');
                localStorage.removeItem('jarvis.workspace');
                location.reload();
              }}
            >
              Restablecer
            </Button>
          </Field>
        </div>
      );
  }
}

/**
 * CANCEL ALL COMPUTER CONTROL. Global, so it works while another app has the
 * focus — which is exactly when the user needs it.
 */
function EmergencyShortcut() {
  const { emergencyShortcut, emergencyError, setEmergencyShortcut } = useDesktopStore();
  const [draft, setDraft] = useState(emergencyShortcut);
  return (
    <div className="surface rounded-lg p-3.5 space-y-2" data-testid="emergency-shortcut">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-ink/90">Cancelar todo el control del equipo</div>
          <div className="text-2xs text-muted mt-0.5">
            Detiene ratón, teclado y la ejecución en curso desde cualquier aplicación. No cierra ventanas.
          </div>
        </div>
        <Badge tone="clay">emergencia</Badge>
      </div>
      <div className="flex items-center gap-2">
        <input
          data-testid="emergency-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 h-8 rounded-md bg-raised border border-hairline px-2 text-xs font-mono text-ink"
        />
        <Button size="xs" variant="ghost" onClick={() => void setEmergencyShortcut(draft)}>Guardar</Button>
      </div>
      {emergencyError && <p className="text-2xs text-clay" data-testid="emergency-error">{emergencyError}</p>}
    </div>
  );
}
