import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import Overview from './pages/Overview';
import Requests from './pages/Requests';
import Projects from './pages/Projects';
import Alerts from './pages/Alerts';
import Insights from './pages/Insights';
import Settings from './pages/Settings';

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
