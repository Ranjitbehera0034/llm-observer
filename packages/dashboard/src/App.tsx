import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import Overview from './pages/Overview';
import Requests from './pages/Requests';
import Projects from './pages/Projects';
import Alerts from './pages/Alerts';
import Insights from './pages/Insights';
import Settings from './pages/Settings';
import SyncPage from './pages/SyncPage';
import Apps from './pages/Apps';
import Wrapped from './pages/Wrapped';
import Sessions from './pages/SessionsPage';

function App() {
  return (
    <Router>
      <Layout>
        <ErrorBoundary fallbackText="The dashboard failed to render this page. Error has been logged.">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/wrapped" element={<Wrapped />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/sync" element={<SyncPage />} />
            <Route path="/apps" element={<Apps />} />
          </Routes>
        </ErrorBoundary>
      </Layout>
    </Router>
  );
}

export default App;
