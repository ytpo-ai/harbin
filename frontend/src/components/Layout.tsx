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
  ChartBarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  BellIcon,
  EnvelopeOpenIcon,
} from '@heroicons/react/24/outline';
import { authService } from '../services/authService';
import { employeeService, EmployeeType } from '../services/employeeService';
import {
  messageCenterService,
  MessageCenterItem,
  MESSAGE_CENTER_UPDATED_EVENT,
  MessageCenterUpdatedDetail,
} from '../services/messageCenterService';
import { wsService } from '../services/wsService';

const Layout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentEmployee, setCurrentEmployee] = useState<any>(null);
  const [checkingAssistant, setCheckingAssistant] = useState(false);
  const [creatingAssistant, setCreatingAssistant] = useState(false);
  const [assistantError, setAssistantError] = useState('');
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isMessageDrawerOpen, setIsMessageDrawerOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState<MessageCenterItem[]>([]);
  const [loadingUnreadMessages, setLoadingUnreadMessages] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

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

  const refreshUnreadCount = async () => {
    if (!currentUser?.id) {
      setUnreadCount(0);
      return;
    }

    try {
      const count = await messageCenterService.getUnreadCount();
      setUnreadCount(count);
    } catch {
      setUnreadCount(0);
    }
  };

  const loadUnreadMessages = async () => {
    setLoadingUnreadMessages(true);
    try {
      const result = await messageCenterService.listMessages({ page: 1, pageSize: 100, isRead: false });
      setUnreadMessages(result.items || []);
      setUnreadCount(result.unreadCount || 0);
    } catch {
      setUnreadMessages([]);
    } finally {
      setLoadingUnreadMessages(false);
    }
  };

  useEffect(() => {
    if (!currentUser?.id) {
      return;
    }

    void refreshUnreadCount();

    const onFocus = () => {
      void refreshUnreadCount();
    };

    const onMessageCenterUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<MessageCenterUpdatedDetail>;
      if (typeof customEvent?.detail?.unreadCount === 'number') {
        setUnreadCount(customEvent.detail.unreadCount);
      } else {
        void refreshUnreadCount();
      }
      if (isMessageDrawerOpen) {
        void loadUnreadMessages();
      }
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener(MESSAGE_CENTER_UPDATED_EVENT, onMessageCenterUpdated);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(MESSAGE_CENTER_UPDATED_EVENT, onMessageCenterUpdated);
    };
  }, [currentUser?.id, isMessageDrawerOpen]);

  useEffect(() => {
    if (!currentUser?.id) {
      return;
    }

    const unsubscribe = wsService.subscribe(`ws:user:${currentUser.id}`, (raw) => {
      try {
        const envelope = JSON.parse(raw) as {
          protocol?: string;
          event?: string;
          data?: { unreadCount?: number };
        };

        if (envelope?.protocol !== 'harbin.ws.v1') {
          return;
        }
        if (envelope?.event !== 'message-center.message.created') {
          return;
        }

        if (typeof envelope?.data?.unreadCount === 'number') {
          setUnreadCount(envelope.data.unreadCount);
        } else {
          void refreshUnreadCount();
        }

        if (isMessageDrawerOpen) {
          void loadUnreadMessages();
        }
      } catch {
        // ignore invalid websocket payload
      }
    });

    return () => {
      unsubscribe();
    };
  }, [currentUser?.id, isMessageDrawerOpen]);

  useEffect(() => {
    if (isMessageDrawerOpen) {
      void loadUnreadMessages();
    }
  }, [isMessageDrawerOpen]);

  const toggleMessageDrawer = () => {
    setIsMessageDrawerOpen((prev) => {
      const next = !prev;
      if (next) {
        void loadUnreadMessages();
      }
      return next;
    });
  };

  const openMessageCenterPage = () => {
    setIsMessageDrawerOpen(false);
    navigate('/message-center');
  };

  const handleMarkRecentMessageRead = async (messageId: string) => {
    try {
      await messageCenterService.markAsRead(messageId);
      setUnreadMessages((prev) => prev.filter((item) => item.messageId !== messageId));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      await loadUnreadMessages();
    } catch {
      // ignore
    }
  };

  const handleMarkAllUnreadMessagesRead = async () => {
    try {
      await messageCenterService.markAllAsRead();
      setUnreadMessages([]);
      setUnreadCount(0);
      await loadUnreadMessages();
    } catch {
      // ignore
    }
  };

  const openRecentMessage = async (item: MessageCenterItem) => {
    if (!item.isRead) {
      await handleMarkRecentMessageRead(item.messageId);
    }

    setIsMessageDrawerOpen(false);
    navigate(`/message-center?messageId=${encodeURIComponent(item.messageId)}`);
  };

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
        { name: '项目管理', href: '/ei', icon: SparklesIcon },
        { name: '工程统计', href: '/ei/statistics', icon: ChartBarIcon },
        { name: '需求管理', href: '/ei/requirements', icon: DocumentTextIcon },
        { name: '智能研发看板', href: '/ei/board', icon: ChartBarIcon },
        { name: '研发会话', href: '/rd-conversation', icon: CodeBracketIcon },
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
        { name: '消息中心', href: '/message-center', icon: BellIcon },
        { name: 'API密钥', href: '/api-keys', icon: KeyIcon },
        { name: '日志查询', href: '/operation-logs', icon: DocumentTextIcon },
        { name: '人力资源', href: '/hr', icon: UserGroupIcon },
        { name: '角色管理', href: '/roles', icon: UserGroupIcon },
      ],
    },
  ];

  const isItemActive = (href: string) =>
    href === '/'
      ? location.pathname === '/'
      : href === '/ei'
        ? location.pathname === '/ei'
        : location.pathname.startsWith(href);

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
        <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={toggleMessageDrawer}
              className="relative inline-flex items-center justify-center h-9 w-9 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
              title="消息中心"
            >
              <BellIcon className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] leading-[18px]">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {currentUser && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsUserMenuOpen((prev) => !prev)}
                  className="flex items-center gap-2 pl-2 border-l border-gray-200"
                >
                  <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm font-medium">
                    {(currentUser.name || currentUser.email || '?').substring(0, 1).toUpperCase()}
                  </div>
                  <span className="text-sm text-gray-700 hidden sm:inline">{currentUser.name || currentUser.email}</span>
                </button>
                {isUserMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-md shadow-lg p-1 z-20">
                    <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">{currentUser.email}</div>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded"
                    >
                      退出登录
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <main className="py-6">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>

      {isMessageDrawerOpen && (
        <div className="fixed inset-0 z-[65]">
          <div className="absolute inset-0 bg-black/30" onClick={() => setIsMessageDrawerOpen(false)} />
            <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl border-l border-gray-200 flex flex-col">
              <div className="px-4 h-14 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">消息中心</h2>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleMarkAllUnreadMessagesRead}
                    disabled={unreadCount === 0}
                    className="text-xs text-gray-600 hover:text-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    全部已读
                  </button>
                  <button
                    type="button"
                    onClick={openMessageCenterPage}
                    className="text-xs text-primary-600 hover:text-primary-700"
                  >
                    查看全部
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loadingUnreadMessages ? (
                  <div className="p-4 text-sm text-gray-500">加载中...</div>
                ) : unreadMessages.length === 0 ? (
                  <div className="p-6 text-sm text-gray-400">暂无未读消息</div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {unreadMessages.map((item) => (
                      <div key={item.messageId} className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                          <button
                            type="button"
                            onClick={() => openRecentMessage(item)}
                            className="text-sm font-medium text-left text-gray-900 hover:text-primary-700"
                          >
                            {item.title}
                          </button>
                          <p className="mt-1 text-xs text-gray-600">{item.content}</p>
                          <p className="mt-1 text-[11px] text-gray-400">{new Date(item.createdAt).toLocaleString()}</p>
                        </div>
                        {!item.isRead && (
                            <button
                              type="button"
                              onClick={() => handleMarkRecentMessageRead(item.messageId)}
                              className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800"
                            >
                              <EnvelopeOpenIcon className="h-3.5 w-3.5" />
                              标记已读
                            </button>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
