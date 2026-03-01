import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import {
  employeeService,
  Employee,
  EmployeeType,
  EmployeeStatus,
  EmployeeRole,
  CreateEmployeeDto,
  UpdateEmployeeDto,
} from '../services/employeeService';
import { invitationService, Invitation, InvitationRole, CreateInvitationDto } from '../services/invitationService';
import { authService } from '../services/authService';
import { 
  UserGroupIcon,
  UserPlusIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  ArrowPathIcon,
  TrashIcon,
  ClipboardIcon,
  ArrowRightOnRectangleIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';

const EMPLOYEE_ROLES = [
  { id: 'founder', name: '创始人', label: '创始人' },
  { id: 'co_founder', name: '联合创始人', label: '联合创始人' },
  { id: 'ceo', name: '首席执行官', label: 'CEO' },
  { id: 'cto', name: '首席技术官', label: 'CTO' },
  { id: 'manager', name: '经理', label: '经理' },
  { id: 'senior', name: '高级工程师', label: '高级工程师' },
  { id: 'junior', name: '工程师', label: '工程师' },
  { id: 'intern', name: '实习生', label: '实习生' },
];

const EmployeeManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'employees' | 'invitations' | 'login'>('employees');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [organizationId, setOrganizationId] = useState<string>(() => {
    const currentUserRaw = localStorage.getItem('current_user');
    if (!currentUserRaw) {
      return 'default-org';
    }

    try {
      const parsed = JSON.parse(currentUserRaw) as { organizationId?: string };
      return parsed.organizationId || 'default-org';
    } catch {
      return 'default-org';
    }
  });

  useEffect(() => {
    authService.getCurrentUser().then((user) => {
      setCurrentUser(user);
      if (user?.organizationId) {
        setOrganizationId(user.organizationId);
      }
    });
  }, []);

  const { data: employees } = useQuery(
    ['employees', organizationId],
    () => employeeService.getEmployeesByOrganization(organizationId),
    {
      enabled: !!organizationId,
    }
  );

  const { data: stats } = useQuery(
    ['employee-stats', organizationId],
    () => employeeService.getEmployeeStats(organizationId),
    {
      enabled: !!organizationId,
    }
  );

  const { data: invitations } = useQuery(
    ['invitations', organizationId],
    () => invitationService.getByOrganization(organizationId),
    {
      enabled: !!organizationId,
    }
  );

  const { data: invitationStats } = useQuery(
    ['invitation-stats', organizationId],
    () => invitationService.getStats(organizationId),
    {
      enabled: !!organizationId,
    }
  );

  const createEmployeeMutation = useMutation(
    (data: CreateEmployeeDto) => employeeService.createEmployee(data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['employees', organizationId]);
        queryClient.invalidateQueries(['employee-stats', organizationId]);
      },
    }
  );

  const updateEmployeeMutation = useMutation(
    ({ id, data }: { id: string; data: UpdateEmployeeDto }) => employeeService.updateEmployee(id, data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['employees', organizationId]);
        queryClient.invalidateQueries(['employee-stats', organizationId]);
      },
    }
  );

  const createInvitationMutation = useMutation(
    (data: CreateInvitationDto) => invitationService.createInvitation(data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['invitations']);
        queryClient.invalidateQueries(['invitation-stats']);
      },
    }
  );

  const cancelInvitationMutation = useMutation(
    (id: string) => invitationService.cancelInvitation(id),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['invitations']);
        queryClient.invalidateQueries(['invitation-stats']);
      },
    }
  );

  const resendInvitationMutation = useMutation(
    (id: string) => invitationService.resendInvitation(id),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['invitations']);
      },
    }
  );

  const humanEmployees = employees?.filter(e => e.type === EmployeeType.HUMAN) || [];
  const boundAssistantCount = humanEmployees.filter((employee) => !!employee.exclusiveAssistantAgentId).length;

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">员工管理</h1>
          <p className="mt-1 text-sm text-gray-500">管理组织人类员工与专属助理绑定</p>
        </div>
        <div className="flex items-center gap-4">
          {currentUser ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-lg">
              <div className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-sm">
                {(currentUser.name || currentUser.email || '?').substring(0, 1).toUpperCase()}
              </div>
              <span className="text-sm text-green-700">{currentUser.name || currentUser.email}</span>
              <button
                onClick={() => {
                  authService.logout();
                  setCurrentUser(null);
                }}
                className="text-xs text-green-600 hover:text-green-800"
              >
                退出
              </button>
            </div>
          ) : (
            <button
              onClick={() => setActiveTab('login')}
              className="inline-flex items-center px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
            >
              <ArrowRightOnRectangleIcon className="h-4 w-4 mr-1" />
              登录
            </button>
          )}
        </div>
      </div>

      {/* Tab导航 */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('employees')}
          className={`px-4 py-2 rounded-md text-sm font-medium ${
            activeTab === 'employees'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          员工列表
        </button>
        <button
          onClick={() => setActiveTab('invitations')}
          className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1 ${
            activeTab === 'invitations'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <EnvelopeIcon className="h-4 w-4" />
          邀请管理
          {invitationStats?.pending ? (
            <span className="ml-1 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
              {invitationStats.pending}
            </span>
          ) : null}
        </button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">总员工</p>
              <p className="text-2xl font-semibold">{stats?.total || 0}</p>
            </div>
            <UserGroupIcon className="h-8 w-8 text-gray-400" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">人类员工</p>
              <p className="text-2xl font-semibold text-blue-600">{stats?.humans || 0}</p>
            </div>
            <UserGroupIcon className="h-8 w-8 text-blue-400" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">已绑定专属助理</p>
              <p className="text-2xl font-semibold text-purple-600">{boundAssistantCount}</p>
            </div>
            <UserGroupIcon className="h-8 w-8 text-purple-400" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">活跃</p>
              <p className="text-2xl font-semibold text-green-600">
                {stats?.byStatus?.find(s => s._id === 'active')?.count || 0}
              </p>
            </div>
            <CheckCircleIcon className="h-8 w-8 text-green-400" />
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      {activeTab === 'login' ? (
        <LoginForm onLogin={(user) => {
          setCurrentUser(user);
          setActiveTab('employees');
        }} />
      ) : activeTab === 'employees' ? (
        <EmployeeList
          humanEmployees={humanEmployees}
          organizationId={organizationId}
          onAdd={(data) => createEmployeeMutation.mutate(data)}
          onUpdate={(id, data) => updateEmployeeMutation.mutate({ id, data })}
          isAdding={createEmployeeMutation.isLoading}
          isUpdating={updateEmployeeMutation.isLoading}
          updatingEmployeeId={updateEmployeeMutation.variables?.id}
        />
      ) : (
        <InvitationManagement
          organizationId={organizationId}
          invitations={invitations || []}
          stats={invitationStats}
          onCreate={(data) => createInvitationMutation.mutate(data)}
          onCancel={(id) => cancelInvitationMutation.mutate(id)}
          onResend={(id) => resendInvitationMutation.mutate(id)}
          isCreating={createInvitationMutation.isLoading}
        />
      )}
    </div>
  );
};

// 登录表单
const LoginForm: React.FC<{ onLogin: (user: any) => void }> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await authService.login({ email, password });
      onLogin(response.employee);
    } catch (err: any) {
      setError(err.response?.data?.message || '登录失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-8 max-w-md mx-auto">
      <h2 className="text-xl font-semibold text-center mb-6">员工登录</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">
            {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2"
            placeholder="your@email.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2"
            placeholder="••••••••"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {isLoading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  );
};

// 员工列表
const EmployeeList: React.FC<{
  humanEmployees: Employee[];
  organizationId: string;
  onAdd: (data: CreateEmployeeDto) => void;
  onUpdate: (id: string, data: UpdateEmployeeDto) => void;
  isAdding: boolean;
  isUpdating: boolean;
  updatingEmployeeId?: string;
}> = ({
  humanEmployees,
  organizationId,
  onAdd,
  onUpdate,
  isAdding,
  isUpdating,
  updatingEmployeeId,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState<Partial<CreateEmployeeDto>>({
    type: EmployeeType.HUMAN,
    organizationId,
    role: EmployeeRole.JUNIOR,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(formData as CreateEmployeeDto);
    setShowAddModal(false);
    setFormData({ type: EmployeeType.HUMAN, organizationId, role: EmployeeRole.JUNIOR });
  };

  return (
    <div className="space-y-6">
      {/* 人类员工 */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <span className="text-xl">👤</span>
            人类员工 ({humanEmployees.length})
          </h3>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <UserPlusIcon className="h-4 w-4 mr-1" />
            添加员工
          </button>
        </div>
        <div className="divide-y divide-gray-200">
          {humanEmployees.length === 0 ? (
            <div className="p-8 text-center text-gray-500">暂无人类员工</div>
          ) : (
            humanEmployees.map((employee) => (
              <EmployeeRow
                key={employee.id}
                employee={employee}
                onUpdate={onUpdate}
                isUpdating={isUpdating && updatingEmployeeId === employee.id}
              />
            ))
          )}
        </div>
      </div>

      {/* 添加模态框 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[450px] p-6">
            <h3 className="text-lg font-semibold mb-4">添加人类员工</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">姓名 *</label>
                <input
                  type="text"
                  required
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="员工姓名"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">邮箱 *</label>
                <input
                  type="email"
                  required
                  value={formData.email || ''}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="employee@company.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色 *</label>
                <select
                  required
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as EmployeeRole })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  {EMPLOYEE_ROLES.map((role) => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isAdding}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {isAdding ? '添加中...' : '添加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// 员工行
const EmployeeRow: React.FC<{
  employee: Employee;
  onUpdate: (id: string, data: UpdateEmployeeDto) => void;
  isUpdating: boolean;
}> = ({ employee, onUpdate, isUpdating }) => {
  const [showEditModal, setShowEditModal] = useState(false);
  const [formData, setFormData] = useState<UpdateEmployeeDto>({});

  const hasKnownRole = EMPLOYEE_ROLES.some((item) => item.id === employee.role);

  const openEditModal = () => {
    setFormData({
      name: employee.name || '',
      email: employee.email || '',
      role: hasKnownRole ? employee.role : undefined,
      departmentId: employee.departmentId || '',
      title: employee.title || '',
      status: employee.status,
      salary: employee.salary,
      shares: employee.shares,
      stockOptions: employee.stockOptions,
      description: employee.description || '',
    });
    setShowEditModal(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = (formData.name || '').trim();
    const trimmedEmail = (formData.email || '').trim();
    const trimmedDepartmentId = (formData.departmentId || '').trim();
    const trimmedTitle = (formData.title || '').trim();
    const trimmedDescription = (formData.description || '').trim();
    const canUpdateRole = !!formData.role && EMPLOYEE_ROLES.some((item) => item.id === formData.role);

    onUpdate(employee.id, {
      ...formData,
      role: canUpdateRole ? formData.role : undefined,
      name: trimmedName || undefined,
      email: trimmedEmail || undefined,
      departmentId: trimmedDepartmentId || undefined,
      title: trimmedTitle || undefined,
      description: trimmedDescription || undefined,
    });
    setShowEditModal(false);
  };

  const getStatusBadge = (status: EmployeeStatus) => {
    const styles = {
      [EmployeeStatus.ACTIVE]: 'bg-green-100 text-green-800',
      [EmployeeStatus.PROBATION]: 'bg-yellow-100 text-yellow-800',
      [EmployeeStatus.TERMINATED]: 'bg-red-100 text-red-800',
      [EmployeeStatus.ON_LEAVE]: 'bg-gray-100 text-gray-800',
      [EmployeeStatus.SUSPENDED]: 'bg-orange-100 text-orange-800',
    };
    const labels = {
      [EmployeeStatus.ACTIVE]: '活跃',
      [EmployeeStatus.PROBATION]: '试用期',
      [EmployeeStatus.TERMINATED]: '已离职',
      [EmployeeStatus.ON_LEAVE]: '休假',
      [EmployeeStatus.SUSPENDED]: '已暂停',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  return (
    <div className="p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium bg-blue-500">
          {(employee.name || '?').substring(0, 1).toUpperCase()}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium text-gray-900">{employee.name || '-'}</p>
            <span className="text-xs">👤</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>{EMPLOYEE_ROLES.find(r => r.id === employee.role)?.name || employee.role}</span>
            {employee.email && <span>• {employee.email}</span>}
          </div>
          <div className="text-sm text-gray-500">
            专属助理: {employee.exclusiveAssistantAgentId ? (employee.exclusiveAssistantName || '已绑定（名称待同步）') : '未绑定'}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {getStatusBadge(employee.status)}
        <span className="text-sm text-gray-500">
          加入于 {new Date(employee.joinDate).toLocaleDateString()}
        </span>
        <button
          onClick={openEditModal}
          className="inline-flex items-center px-2 py-1 text-sm text-blue-600 hover:text-blue-800"
          title="编辑员工"
        >
          <PencilSquareIcon className="h-4 w-4 mr-1" />
          编辑
        </button>
      </div>

      {showEditModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[520px] p-6">
            <h3 className="text-lg font-semibold mb-4">编辑账号</h3>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">姓名</label>
                  <input
                    type="text"
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
                  <input
                    type="email"
                    value={formData.email || ''}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">角色</label>
                  <select
                    value={formData.role || ''}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as EmployeeRole })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    {!hasKnownRole && <option value="">保持原角色（{employee.role}）</option>}
                    {EMPLOYEE_ROLES.map((role) => (
                      <option key={role.id} value={role.id}>{role.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
                  <select
                    value={formData.status || EmployeeStatus.ACTIVE}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as EmployeeStatus })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value={EmployeeStatus.ACTIVE}>活跃</option>
                    <option value={EmployeeStatus.PROBATION}>试用期</option>
                    <option value={EmployeeStatus.ON_LEAVE}>休假</option>
                    <option value={EmployeeStatus.SUSPENDED}>已暂停</option>
                    <option value={EmployeeStatus.TERMINATED}>已离职</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">部门</label>
                  <input
                    type="text"
                    value={formData.departmentId || ''}
                    onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">职位</label>
                  <input
                    type="text"
                    value={formData.title || ''}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">薪资</label>
                  <input
                    type="number"
                    min={0}
                    value={formData.salary ?? 0}
                    onChange={(e) => setFormData({ ...formData, salary: Number(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">股份</label>
                  <input
                    type="number"
                    min={0}
                    value={formData.shares ?? 0}
                    onChange={(e) => setFormData({ ...formData, shares: Number(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">期权</label>
                  <input
                    type="number"
                    min={0}
                    value={formData.stockOptions ?? 0}
                    onChange={(e) => setFormData({ ...formData, stockOptions: Number(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {isUpdating ? '保存中...' : '保存修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// 邀请管理
const InvitationManagement: React.FC<{
  organizationId: string;
  invitations: Invitation[];
  stats: any;
  onCreate: (data: CreateInvitationDto) => void;
  onCancel: (id: string) => void;
  onResend: (id: string) => void;
  isCreating: boolean;
}> = ({ organizationId, invitations, stats, onCreate, onCancel, onResend, isCreating }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<CreateInvitationDto>>({
    organizationId,
    invitedByName: '',
    role: InvitationRole.JUNIOR,
    expiresInDays: 7,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(formData as CreateInvitationDto);
    setIsOpen(false);
  };

  return (
    <div className="space-y-4">
      {/* 统计 */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-semibold">{stats?.total || 0}</p>
          <p className="text-sm text-gray-500">总邀请</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-semibold text-yellow-600">{stats?.pending || 0}</p>
          <p className="text-sm text-gray-500">待处理</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-semibold text-green-600">{stats?.accepted || 0}</p>
          <p className="text-sm text-gray-500">已接受</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-semibold text-red-600">{stats?.expired || 0}</p>
          <p className="text-sm text-gray-500">已过期</p>
        </div>
      </div>

      {/* 创建按钮 */}
      <div className="flex justify-end">
        <button
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
        >
          <UserPlusIcon className="h-4 w-4 mr-2" />
          创建邀请
        </button>
      </div>

      {/* 邀请列表 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">邀请码</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">邀请人</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">角色</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">过期时间</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <code className="bg-gray-100 px-2 py-1 rounded text-sm font-mono">{invitation.code}</code>
                    <button
                      onClick={() => navigator.clipboard.writeText(invitation.code)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <ClipboardIcon className="h-4 w-4" />
                    </button>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{invitation.invitedByName}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {EMPLOYEE_ROLES.find(r => r.id === invitation.role)?.name || invitation.role}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    invitation.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                    invitation.status === 'accepted' ? 'bg-green-100 text-green-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {invitation.status === 'pending' ? '待处理' :
                     invitation.status === 'accepted' ? '已接受' : '已失效'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(invitation.expiresAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  {invitation.status === 'pending' && (
                    <div className="flex justify-end gap-2">
                      <button onClick={() => onResend(invitation.id)} className="text-blue-600 hover:text-blue-800">
                        <ArrowPathIcon className="h-4 w-4" />
                      </button>
                      <button onClick={() => onCancel(invitation.id)} className="text-red-600 hover:text-red-800">
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {invitations.length === 0 && (
          <div className="p-8 text-center text-gray-500">暂无邀请记录</div>
        )}
      </div>

      {/* 创建模态框 */}
      {isOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[450px] p-6">
            <h3 className="text-lg font-semibold mb-4">创建邀请</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">邀请人 *</label>
                <input
                  type="text"
                  required
                  value={formData.invitedByName || ''}
                  onChange={(e) => setFormData({ ...formData, invitedByName: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色 *</label>
                <select
                  required
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as InvitationRole })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  {EMPLOYEE_ROLES.map((role) => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">过期天数</label>
                <select
                  value={formData.expiresInDays}
                  onChange={(e) => setFormData({ ...formData, expiresInDays: parseInt(e.target.value) })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value={3}>3天</option>
                  <option value={7}>7天</option>
                  <option value={14}>14天</option>
                  <option value={30}>30天</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button type="button" onClick={() => setIsOpen(false)} className="px-4 py-2 border border-gray-300 rounded-md">取消</button>
                <button type="submit" disabled={isCreating} className="px-4 py-2 bg-primary-600 text-white rounded-md disabled:opacity-50">
                  {isCreating ? '创建中...' : '创建邀请'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeManagement;
