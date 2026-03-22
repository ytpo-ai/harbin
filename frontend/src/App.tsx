import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Models from './pages/Models';
import Agents from './pages/Agents';
import AgentDetail from './pages/AgentDetail';
import Tools from './pages/Tools';
import ApiKeys from './pages/ApiKeys';
import EmployeeManagement from './pages/EmployeeManagement';
import HRManagement from './pages/HRManagement';
import Meetings from './pages/Meetings';
import RdConversation from './pages/RdConversation';
import AgentTaskRunner from './pages/AgentTaskRunner';
import ProjectManagement from './pages/ProjectManagement';
import EngineeringStatistics from './pages/EngineeringStatistics';
import EngineeringRequirements from './pages/EngineeringRequirements';
import EngineeringRequirementDetail from './pages/EngineeringRequirementDetail';
import EngineeringBoard from './pages/EngineeringBoard';
import Orchestration from './pages/Orchestration';
import PlanDetail from './pages/PlanDetail';
import Scheduler from './pages/Scheduler';
import Skills from './pages/Skills';
import OperationLogs from './pages/OperationLogs';
import Memos from './pages/Memos';
import MessageCenter from './pages/MessageCenter';
import PromptRegistry from './pages/PromptRegistry';
import PromptRegistryDetail from './pages/PromptRegistryDetail';
import UiManagement from './pages/UiManagement';
import Usage from './pages/Usage';
import Login from './pages/Login';
import Register from './pages/Register';
import { authService } from './services/authService';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000,
    },
  },
});

// 受保护的路由组件
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isLoggedIn = authService.isLoggedIn();
  
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          {/* 公开路由 - 不需要Layout */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/invite" element={<Register />} />
          <Route path="/meetings/:meetingId" element={<ProtectedRoute><Meetings /></ProtectedRoute>} />
          
          {/* 受保护的路由 - 需要Layout */}
          <Route element={<Layout />}>
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/models" element={<ProtectedRoute><Models /></ProtectedRoute>} />
            <Route path="/organization" element={<ProtectedRoute><Navigate to="/" replace /></ProtectedRoute>} />
            <Route path="/agents" element={<ProtectedRoute><Agents /></ProtectedRoute>} />
            <Route path="/agents/:agentId" element={<ProtectedRoute><AgentDetail /></ProtectedRoute>} />
            <Route path="/tools" element={<ProtectedRoute><Tools /></ProtectedRoute>} />
            <Route path="/api-keys" element={<ProtectedRoute><ApiKeys /></ProtectedRoute>} />
            <Route path="/usage" element={<ProtectedRoute><Usage /></ProtectedRoute>} />
            <Route path="/hr" element={<ProtectedRoute><EmployeeManagement /></ProtectedRoute>} />
            <Route path="/roles" element={<ProtectedRoute><HRManagement /></ProtectedRoute>} />
            <Route path="/governance" element={<ProtectedRoute><Navigate to="/" replace /></ProtectedRoute>} />
            <Route path="/meetings" element={<ProtectedRoute><Meetings /></ProtectedRoute>} />
            <Route path="/rd-conversation" element={<ProtectedRoute><RdConversation /></ProtectedRoute>} />
            <Route path="/agent-task-runner" element={<ProtectedRoute><AgentTaskRunner /></ProtectedRoute>} />
            <Route path="/orchestration" element={<ProtectedRoute><Orchestration /></ProtectedRoute>} />
            <Route path="/orchestration/plans/:id" element={<ProtectedRoute><PlanDetail /></ProtectedRoute>} />
            <Route path="/scheduler" element={<ProtectedRoute><Scheduler /></ProtectedRoute>} />
            <Route path="/prompt-registry" element={<ProtectedRoute><PromptRegistry /></ProtectedRoute>} />
            <Route path="/prompt-registry/templates/:templateId" element={<ProtectedRoute><PromptRegistryDetail /></ProtectedRoute>} />
            <Route path="/skills" element={<ProtectedRoute><Skills /></ProtectedRoute>} />
            <Route path="/operation-logs" element={<ProtectedRoute><OperationLogs /></ProtectedRoute>} />
            <Route path="/memos" element={<ProtectedRoute><Memos /></ProtectedRoute>} />
            <Route path="/message-center" element={<ProtectedRoute><MessageCenter /></ProtectedRoute>} />
            <Route path="/ui-management" element={<ProtectedRoute><UiManagement /></ProtectedRoute>} />
            <Route path="/engineering-intelligence" element={<Navigate to="/ei" replace />} />
            <Route path="/engineering-intelligence/*" element={<Navigate to="/ei" replace />} />
            <Route path="/ei" element={<ProtectedRoute><ProjectManagement /></ProtectedRoute>} />
            <Route path="/ei/statistics" element={<ProtectedRoute><EngineeringStatistics /></ProtectedRoute>} />
            <Route path="/ei/requirements" element={<ProtectedRoute><EngineeringRequirements /></ProtectedRoute>} />
            <Route path="/ei/requirements/:requirementId" element={<ProtectedRoute><EngineeringRequirementDetail /></ProtectedRoute>} />
            <Route path="/ei/board" element={<ProtectedRoute><EngineeringBoard /></ProtectedRoute>} />
          </Route>
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
