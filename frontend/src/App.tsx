import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Models from './pages/Models';
import Organization from './pages/Organization';
import Agents from './pages/Agents';
import Tasks from './pages/Tasks';
import Tools from './pages/Tools';
import ApiKeys from './pages/ApiKeys';
import HRManagement from './pages/HRManagement';
import Governance from './pages/Governance';
import Meetings from './pages/Meetings';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/models" element={<Models />} />
            <Route path="/organization" element={<Organization />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/api-keys" element={<ApiKeys />} />
            <Route path="/hr" element={<HRManagement />} />
            <Route path="/governance" element={<Governance />} />
            <Route path="/meetings" element={<Meetings />} />
          </Routes>
        </Layout>
      </Router>
    </QueryClientProvider>
  );
}

export default App;