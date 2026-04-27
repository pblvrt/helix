import { Component, type ReactNode, useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Topbar from './components/Sidebar';
import Goals from './pages/Goals';
import GoalDetail from './pages/GoalDetail';
import Board from './pages/Board';
import Executor from './pages/Executor';
import McpConnections from './pages/McpConnections';
import Knowledge from './pages/Knowledge';
import Skills from './pages/Skills';
import Setup from './pages/Setup';
import { checkOnboardingStatus } from './api/client';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace' }}>
          <h2 style={{ color: '#DC2626' }}>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#666', marginTop: 12 }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppShell() {
  const [ready, setReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    checkOnboardingStatus()
      .then(({ onboardingCompleted }) => {
        setNeedsOnboarding(!onboardingCompleted);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Topbar />
      <main className="pt-16 px-6 pb-6">
        <ErrorBoundary>
          <Routes>
            <Route path="/"          element={needsOnboarding ? <Navigate to="/setup" replace /> : <Goals />} />
            <Route path="/goals/:id" element={<GoalDetail />} />
            <Route path="/board"     element={<Board />} />
            <Route path="/executor"  element={<Executor />} />
            <Route path="/mcp"       element={<McpConnections />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/skills"    element={<Skills />} />
            <Route path="/setup"     element={<Setup onComplete={() => setNeedsOnboarding(false)} />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}
