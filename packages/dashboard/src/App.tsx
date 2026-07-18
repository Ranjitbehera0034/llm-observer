import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import Overview from './pages/Overview';
import Requests from './pages/Requests';
import Projects from './pages/Projects';
import Alerts from './pages/Alerts';
import Insights from './pages/Insights';
import Settings from './pages/Settings';
import Limits from './pages/Limits';
import Sync from './pages/Sync';
import Apps from './pages/Apps';
import Wrapped from './pages/Wrapped';
import Sessions from './pages/Sessions';
import Agents from './pages/Agents';
import Tools from './pages/Tools';
import Optimize from './pages/Optimize';
import Compare from './pages/Compare';

function App() {
  return (
    <Router>
      <Layout>
        <ErrorBoundary fallbackText="The dashboard failed to render this page. Error has been logged.">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/optimize" element={<Optimize />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/limits" element={<Limits />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/wrapped" element={<Wrapped />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/sync" element={<Sync />} />
            <Route path="/apps" element={<Apps />} />
          </Routes>
        </ErrorBoundary>
      </Layout>
    </Router>
  );
}

export default App;
