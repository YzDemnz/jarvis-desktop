import { useEffect, useRef } from 'react';
import { Shell } from './Shell';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useSettingsStore } from '@/stores/useSettingsStore';

export function App() {
  const omniboxRef = useRef<HTMLInputElement>(null);
  const accent = useSettingsStore((s) => s.accent);

  useHotkeys(() => {
    omniboxRef.current?.focus();
    omniboxRef.current?.select();
  });

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
  }, [accent]);

  return <Shell omniboxRef={omniboxRef} />;
}
