import { useEffect } from 'react';

interface Shortcut {
  key: string;
  modifiers?: ('meta' | 'ctrl' | 'shift' | 'alt')[];
  handler: () => void;
  ignoreInputs?: boolean;
}

export function useKeyboardShortcut(shortcuts: Shortcut[], deps: unknown[] = []) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      for (const s of shortcuts) {
        const ignoreInputs = s.ignoreInputs ?? true;
        if (ignoreInputs) {
          const tag = (e.target as HTMLElement)?.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') continue;
        }

        if (e.key.toLowerCase() !== s.key.toLowerCase()) continue;

        const mods = s.modifiers || [];
        if (mods.includes('meta') && !e.metaKey) continue;
        if (mods.includes('ctrl') && !e.ctrlKey) continue;
        if (mods.includes('shift') && !e.shiftKey) continue;
        if (mods.includes('alt') && !e.altKey) continue;

        // If modifiers are expected but none match the meta/ctrl requirement
        if (!mods.includes('meta') && !mods.includes('ctrl') && (e.metaKey || e.ctrlKey)) continue;

        e.preventDefault();
        s.handler();
        return;
      }
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
