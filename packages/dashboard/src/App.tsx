import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
const Tasks = lazy(() => import('./pages/Tasks'));
const ModelAccess = lazy(() => import('./pages/ModelAccess'));
const Overview = lazy(() => import('./pages/Overview'));
const Requests = lazy(() => import('./pages/Requests'));
const Projects = lazy(() => import('./pages/Projects'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Insights = lazy(() => import('./pages/Insights'));
const Settings = lazy(() => import('./pages/Settings'));
const Limits = lazy(() => import('./pages/Limits'));
const Sync = lazy(() => import('./pages/Sync'));
const Apps = lazy(() => import('./pages/Apps'));
const Wrapped = lazy(() => import('./pages/Wrapped'));
const Sessions = lazy(() => import('./pages/Sessions'));
const Agents = lazy(() => import('./pages/Agents'));
const Tools = lazy(() => import('./pages/Tools'));
const Optimize = lazy(() => import('./pages/Optimize'));
const Compare = lazy(() => import('./pages/Compare'));

function App() {
  return (
    <Router>
      <Layout>
        <ErrorBoundary fallbackText="The dashboard failed to render this page. Error has been logged.">
          <Suspense fallback={<div className="p-8 text-textMuted" role="status">Loading page…</div>}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/model-access" element={<ModelAccess />} />
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
          </Suspense>
        </ErrorBoundary>
      </Layout>
    </Router>
  );
}

export default App;
