import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import {
  HomeIcon,
  UserGroupIcon,
  ClipboardDocumentListIcon,
  VideoCameraIcon,
  WrenchScrewdriverIcon,
  CpuChipIcon,
  KeyIcon,
  ArrowRightOnRectangleIcon,
  CodeBracketIcon,
  SparklesIcon,
  BoltIcon,
  DocumentTextIcon,
  BookOpenIcon,
} from '@heroicons/react/24/outline';
import { authService } from '../services/authService';
import { employeeService, EmployeeType } from '../services/employeeService';

const Layout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentEmployee, setCurrentEmployee] = useState<any>(null);
  const [checkingAssistant, setCheckingAssistant] = useState(false);
  const [creatingAssistant, setCreatingAssistant] = useState(false);
  const [assistantError, setAssistantError] = useState('');

  useEffect(() => {
    const loadCurrentUserAndEmployee = async () => {
      const user = await authService.getCurrentUser();
      setCurrentUser(user);

      if (!user?.id) {
        setCurrentEmployee(null);
        return;
      }

      setCheckingAssistant(true);
      try {
        const employee = await employeeService.getEmployee(user.id);
        setCurrentEmployee(employee || null);
      } catch {
        setCurrentEmployee(null);
      } finally {
        setCheckingAssistant(false);
      }
    };

    void loadCurrentUserAndEmployee();
  }, []);

  const requiresAssistantBinding =
    !!currentUser &&
    currentEmployee?.type === EmployeeType.HUMAN &&
    !currentEmployee?.exclusiveAssistantAgentId &&
    !currentEmployee?.aiProxyAgentId;

  const handleCreateAssistant = async () => {
    if (!currentUser?.id || creatingAssistant) {
      return;
    }

    setAssistantError('');
    setCreatingAssistant(true);

    try {
      const employee = await employeeService.createAndBindExclusiveAssistant(currentUser.id);
      setCurrentEmployee(employee);
    } catch (error: any) {
      const backendMessage = error?.response?.data?.message;
      setAssistantError(
        typeof backendMessage === 'string' && backendMessage
          ? backendMessage
          : '创建专属助理失败，请稍后重试。',
      );
    } finally {
      setCreatingAssistant(false);
    }
  };

  const handleLogout = () => {
    authService.logout();
    setCurrentUser(null);
    navigate('/login');
  };

  const navigation = [
    { name: '仪表盘', href: '/', icon: HomeIcon },
    { name: '模型管理', href: '/models', icon: CpuChipIcon },
    { name: 'Agent管理', href: '/agents', icon: UserGroupIcon },
    { name: '任务管理', href: '/tasks', icon: ClipboardDocumentListIcon },
    { name: '研发管理', href: '/rd-management', icon: CodeBracketIcon },
    { name: '研发智能', href: '/engineering-intelligence', icon: SparklesIcon },
    { name: '任务编排', href: '/orchestration', icon: SparklesIcon },
    { name: 'Skills管理', href: '/skills', icon: BoltIcon },
    { name: '日志查询', href: '/operation-logs', icon: DocumentTextIcon },
    { name: '备忘录', href: '/memos', icon: BookOpenIcon },
    { name: '工具管理', href: '/tools', icon: WrenchScrewdriverIcon },
    { name: 'API密钥', href: '/api-keys', icon: KeyIcon },
    { name: '人力资源', href: '/hr', icon: UserGroupIcon },
    { name: '会议室', href: '/meetings', icon: VideoCameraIcon },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 侧边栏 */}
      <div className="fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg">
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center h-16 px-4 border-b border-gray-200">
            <h1 className="text-xl font-bold text-gray-900">AI Agent Team</h1>
          </div>

          {/* 导航菜单 */}
          <nav className="flex-1 px-2 py-4 space-y-1">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href;

              const className = `group flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors ${
                isActive
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`;

              const iconClass = `mr-3 h-5 w-5 ${
                isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
              }`;

              return (
                <Link key={item.name} to={item.href} className={className}>
                  <item.icon className={iconClass} aria-hidden="true" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* 用户信息 / 登录 */}
          <div className="px-2 py-4 border-t border-gray-200">
            {currentUser ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm font-medium">
                    {(currentUser.name || currentUser.email || '?').substring(0, 1).toUpperCase()}
                  </div>
                  <div className="ml-2">
                    <p className="text-sm font-medium text-gray-900">{currentUser.name || '用户'}</p>
                    <p className="text-xs text-gray-500">{currentUser.email}</p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                  title="退出登录"
                >
                  <ArrowRightOnRectangleIcon className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="flex items-center justify-center w-full px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <ArrowRightOnRectangleIcon className="h-4 w-4 mr-2" />
                登录
              </Link>
            )}
          </div>

          {/* 底部信息 */}
          <div className="px-2 py-2 border-t border-gray-200">
            <div className="text-xs text-gray-500">
              <p>© 2026 AI Agent Team</p>
            </div>
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="pl-64">
        <main className="py-6">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>

      {requiresAssistantBinding && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900">创建专属助理后才能继续</h2>
            <p className="mt-2 text-sm text-gray-600">
              检测到您尚未绑定专属助理。根据系统规则，人类员工和高管必须先创建并绑定专属助理，才可发起或参与会议。
            </p>

            {assistantError && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {assistantError}
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                退出登录
              </button>
              <button
                onClick={handleCreateAssistant}
                disabled={creatingAssistant || checkingAssistant}
                className="px-4 py-2 text-sm rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {creatingAssistant ? '创建中...' : '创建专属助理'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Layout;
