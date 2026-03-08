import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Overview from './pages/Overview';

function App() {
  return (
    <Router>
      {/* 
        Future: Add Sidebar/Layout wrapper here. 
        For Day 1, we just render the Overview page standalone or wrapped in a simple min-h-screen container.
      */}
      <div className="min-h-screen bg-background">
        <Routes>
          <Route path="/" element={<Overview />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
