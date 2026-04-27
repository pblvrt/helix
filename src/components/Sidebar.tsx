import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Crosshair, Kanban, Zap, Plug, BookOpen, Sparkles } from 'lucide-react';

const navItems = [
  { to: '/',          icon: Crosshair, label: 'Goals' },
  { to: '/board',     icon: Kanban,    label: 'Board' },
  { to: '/executor',  icon: Zap,       label: 'Executor' },
  { to: '/knowledge', icon: BookOpen,  label: 'Knowledge' },
  { to: '/skills',    icon: Sparkles,  label: 'Skills' },
  { to: '/mcp',       icon: Plug,      label: 'MCP' },
];

export default function Topbar() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    const w = window as any;
    if (w.electronAPI?.invoke) {
      w.electronAPI.invoke('app:version').then(setVersion).catch(() => {});
    } else {
      fetch('http://localhost:3458/api/version').then(r => r.json()).then(d => setVersion(d.version || '')).catch(() => {});
    }
  }, []);

  return (
    <header
      className="fixed top-0 left-0 right-0 h-[52px] bg-white/80 backdrop-blur-xl border-b border-edge/60 flex items-center justify-between px-5 z-50"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand to-indigo-500 flex items-center justify-center shadow-sm">
            <Crosshair size={14} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-[14px] font-bold tracking-tight text-primary">SEO Automator</span>
        </div>

        <nav className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-brand/8 text-brand'
                    : 'text-muted hover:text-secondary hover:bg-surface-1'
                }`
              }
            >
              <item.icon size={14} strokeWidth={1.8} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {version && (
          <span className="text-[10px] font-mono text-muted/60 bg-surface-1 px-2 py-0.5 rounded-md">
            v{version}
          </span>
        )}
      </div>
    </header>
  );
}
