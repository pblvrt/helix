import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import './index.css'
import App from './App.tsx'

// In Electron, open external links in the system browser instead of a new Electron window
if (window.electronAPI) {
  document.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (link && link.href && (link.target === '_blank' || link.href.startsWith('http'))) {
      const url = link.href;
      // Only intercept external URLs, not hash navigation
      if (url.startsWith('http') && !url.includes('localhost')) {
        e.preventDefault();
        window.electronAPI!.openExternal(url);
      }
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
