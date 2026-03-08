import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import {
  HomeIcon,
  UserGroupIcon,
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
  ClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
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
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);

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

  const topLevelNavigation = [
    { name: '仪表板', href: '/', icon: HomeIcon },
    { name: '会议室', href: '/meetings', icon: VideoCameraIcon },
  ];

  const groupedNavigation = [
    {
      name: '智能体管理',
      icon: UserGroupIcon,
      items: [
        { name: 'Agent管理', href: '/agents', icon: UserGroupIcon },
        { name: 'Skills管理', href: '/skills', icon: BoltIcon },
        { name: '工具管理', href: '/tools', icon: WrenchScrewdriverIcon },
        { name: '模型管理', href: '/models', icon: CpuChipIcon },
        { name: '备忘录', href: '/memos', icon: BookOpenIcon },
      ],
    },
    {
      name: '研发智能',
      icon: SparklesIcon,
      items: [
        { name: '研发智能', href: '/engineering-intelligence', icon: SparklesIcon },
        { name: '研发管理', href: '/rd-management', icon: CodeBracketIcon },
      ],
    },
    {
      name: '任务计划',
      icon: DocumentTextIcon,
      items: [
        { name: '计划编排', href: '/orchestration', icon: DocumentTextIcon },
        { name: '定时服务', href: '/scheduler', icon: ClockIcon },
      ],
    },
    {
      name: '系统管理',
      icon: KeyIcon,
      items: [
        { name: 'API密钥', href: '/api-keys', icon: KeyIcon },
        { name: '日志查询', href: '/operation-logs', icon: DocumentTextIcon },
        { name: '人力资源', href: '/hr', icon: UserGroupIcon },
      ],
    },
  ];

  const isItemActive = (href: string) =>
    href === '/' ? location.pathname === '/' : location.pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 侧边栏 */}
      <div
        className={`fixed inset-y-0 left-0 z-50 bg-white shadow-lg transition-all duration-200 ${
          isSidebarExpanded ? 'w-64' : 'w-16'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div
            className={`flex items-center justify-between h-16 border-b border-gray-200 ${
              isSidebarExpanded ? 'px-4' : 'px-2'
            }`}
          >
            <h1 className="text-xl font-bold text-gray-900">
              {isSidebarExpanded ? 'AI Agent Team' : 'AI'}
            </h1>
            <button
              type="button"
              onClick={() => setIsSidebarExpanded((prev) => !prev)}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
              title={isSidebarExpanded ? '收起侧边栏' : '展开侧边栏'}
            >
              {isSidebarExpanded ? (
                <ChevronLeftIcon className="h-5 w-5" />
              ) : (
                <ChevronRightIcon className="h-5 w-5" />
              )}
            </button>
          </div>

          {/* 导航菜单 */}
          <nav className={`flex-1 py-4 ${isSidebarExpanded ? 'px-2' : 'px-1'} space-y-4`}>
            <div className="space-y-1">
              {topLevelNavigation.map((item) => {
                const isActive = isItemActive(item.href);

                const className = `group flex items-center py-2 text-sm font-medium rounded-md transition-colors ${
                  isSidebarExpanded ? 'px-2' : 'px-2 justify-center'
                } ${
                  isActive
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`;

                const iconClass = `${isSidebarExpanded ? 'mr-3' : ''} h-5 w-5 ${
                  isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
                }`;

                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={className}
                    title={!isSidebarExpanded ? item.name : undefined}
                  >
                    <item.icon className={iconClass} aria-hidden="true" />
                    {isSidebarExpanded && item.name}
                  </Link>
                );
              })}
            </div>

            {groupedNavigation.map((section) => {
              const isSectionActive = section.items.some((item) => isItemActive(item.href));

              return (
                <div key={section.name} className="space-y-2">
                  {isSidebarExpanded && (
                    <div
                      className={`flex items-center px-2 text-xs font-semibold uppercase tracking-wide ${
                        isSectionActive ? 'text-primary-600' : 'text-gray-400'
                      }`}
                    >
                      <section.icon className="mr-2 h-4 w-4" />
                      {section.name}
                    </div>
                  )}
                  <div className={`space-y-1 ${isSidebarExpanded ? 'pl-2' : ''}`}>
                    {section.items.map((item) => {
                      const isActive = isItemActive(item.href);

                      const className = `group flex items-center py-2 text-sm font-medium rounded-md transition-colors ${
                        isSidebarExpanded ? 'px-2' : 'px-2 justify-center'
                      } ${
                        isActive
                          ? 'bg-primary-100 text-primary-700'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`;

                      const iconClass = `${isSidebarExpanded ? 'mr-3' : ''} h-5 w-5 ${
                        isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
                      }`;

                      return (
                        <Link
                          key={`${section.name}-${item.name}`}
                          to={item.href}
                          className={className}
                          title={!isSidebarExpanded ? item.name : undefined}
                        >
                          <item.icon className={iconClass} aria-hidden="true" />
                          {isSidebarExpanded && item.name}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* 用户信息 / 登录 */}
          <div className="px-2 py-4 border-t border-gray-200">
            {currentUser ? (
              <div
                className={`flex items-center gap-2 ${
                  isSidebarExpanded ? 'justify-between' : 'flex-col'
                }`}
              >
                <div className="flex items-center">
                  <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm font-medium">
                    {(currentUser.name || currentUser.email || '?').substring(0, 1).toUpperCase()}
                  </div>
                  {isSidebarExpanded && (
                    <div className="ml-2">
                      <p className="text-sm font-medium text-gray-900">{currentUser.name || '用户'}</p>
                      <p className="text-xs text-gray-500">{currentUser.email}</p>
                    </div>
                  )}
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
                className={`flex items-center justify-center w-full border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 ${
                  isSidebarExpanded ? 'px-4 py-2' : 'p-2'
                }`}
                title={!isSidebarExpanded ? '登录' : undefined}
              >
                <ArrowRightOnRectangleIcon className={`h-4 w-4 ${isSidebarExpanded ? 'mr-2' : ''}`} />
                {isSidebarExpanded && '登录'}
              </Link>
            )}
          </div>

          {/* 底部信息 */}
          <div className="px-2 py-2 border-t border-gray-200">
            {isSidebarExpanded && (
              <div className="text-xs text-gray-500">
                <p>© 2026 AI Agent Team</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className={`transition-all duration-200 ${isSidebarExpanded ? 'pl-64' : 'pl-16'}`}>
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
