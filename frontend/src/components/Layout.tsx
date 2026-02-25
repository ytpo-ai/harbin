import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  HomeIcon,
  UserGroupIcon,
  ClipboardDocumentListIcon,
  VideoCameraIcon,
  BuildingOfficeIcon,
  WrenchScrewdriverIcon,
  ScaleIcon,
  CpuChipIcon,
  KeyIcon,
} from '@heroicons/react/24/outline';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();

  const navigation = [
    { name: '仪表盘', href: '/', icon: HomeIcon },
    { name: '模型管理', href: '/models', icon: CpuChipIcon },
    { name: '组织管理', href: '/organization', icon: BuildingOfficeIcon },
    { name: 'Agent管理', href: '/agents', icon: UserGroupIcon },
    { name: '任务管理', href: '/tasks', icon: ClipboardDocumentListIcon },
    { name: '工具管理', href: '/tools', icon: WrenchScrewdriverIcon },
    { name: 'API密钥', href: '/api-keys', icon: KeyIcon },
    { name: '人力资源', href: '/hr', icon: UserGroupIcon },
    { name: '公司治理', href: '/governance', icon: ScaleIcon },
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
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`group flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <item.icon
                    className={`mr-3 h-5 w-5 ${
                      isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
                    }`}
                    aria-hidden="true"
                  />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* 底部信息 */}
          <div className="px-2 py-4 border-t border-gray-200">
            <div className="text-xs text-gray-500">
              <p>© 2026 AI Agent Team</p>
              <p>Version 1.0.0</p>
            </div>
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="pl-64">
        <main className="py-6">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;