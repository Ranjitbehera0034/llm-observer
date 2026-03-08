import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Overview from './pages/Overview';
import Requests from './pages/Requests';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-background flex flex-col">
        <header className="border-b border-border bg-surface sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <span className="text-white font-bold text-lg tracking-tight">LLM Observer</span>
              <nav className="flex gap-4">
                <Link to="/" className="text-sm text-textMuted hover:text-white transition-colors">Overview</Link>
                <Link to="/requests" className="text-sm text-textMuted hover:text-white transition-colors">Requests</Link>
              </nav>
            </div>
          </div>
        </header>

        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/requests" element={<Requests />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
