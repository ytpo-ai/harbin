import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { meetingService, Meeting, MeetingType, MeetingStatus, CreateMeetingDto, MeetingMessage } from '../services/meetingService';
import { agentService } from '../services/agentService';
import { Agent } from '../types';
import { 
  VideoCameraIcon,
  PlusIcon,
  PlayIcon,
  StopIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  CalendarIcon,
  ClockIcon,
  CheckCircleIcon,
  PaperAirplaneIcon,
  UserPlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const MEETING_TYPES = [
  { id: MeetingType.WEEKLY, name: '周会', color: 'bg-blue-100 text-blue-800', icon: '📅' },
  { id: MeetingType.BOARD, name: '董事会', color: 'bg-purple-100 text-purple-800', icon: '👔' },
  { id: MeetingType.DAILY, name: '日常讨论', color: 'bg-green-100 text-green-800', icon: '💬' },
  { id: MeetingType.DEPARTMENT, name: '部门会议', color: 'bg-yellow-100 text-yellow-800', icon: '🏢' },
  { id: MeetingType.AD_HOC, name: '临时会议', color: 'bg-gray-100 text-gray-800', icon: '⚡' },
  { id: MeetingType.PROJECT, name: '项目会议', color: 'bg-indigo-100 text-indigo-800', icon: '📊' },
  { id: MeetingType.EMERGENCY, name: '紧急会议', color: 'bg-red-100 text-red-800', icon: '🚨' },
];

const Meetings: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: meetings, isLoading: meetingsLoading } = useQuery('meetings', () => 
    meetingService.getAllMeetings()
  );
  const { data: stats } = useQuery('meeting-stats', meetingService.getMeetingStats);
  const { data: agents } = useQuery('agents', agentService.getAgents);

  const createMutation = useMutation(meetingService.createMeeting, {
    onSuccess: () => {
      queryClient.invalidateQueries('meetings');
      queryClient.invalidateQueries('meeting-stats');
      setIsCreateModalOpen(false);
    },
  });

  const startMutation = useMutation(
    ({ id, startedBy }: { id: string; startedBy: string }) => 
      meetingService.startMeeting(id, startedBy),
    {
      onSuccess: (data) => {
        queryClient.invalidateQueries('meetings');
        setSelectedMeeting(data);
      },
    }
  );

  const endMutation = useMutation(meetingService.endMeeting, {
    onSuccess: () => {
      queryClient.invalidateQueries('meetings');
      queryClient.invalidateQueries('meeting-stats');
      setSelectedMeeting(null);
    },
  });

  const joinMutation = useMutation(
    ({ id, agentId }: { id: string; agentId: string }) => 
      meetingService.joinMeeting(id, agentId),
    {
      onSuccess: (data) => {
        queryClient.invalidateQueries('meetings');
        if (selectedMeeting?.id === data.id) {
          setSelectedMeeting(data);
        }
      },
    }
  );

  const sendMessageMutation = useMutation(
    ({ id, content }: { id: string; content: string }) => 
      meetingService.sendMessage(id, {
        agentId: 'user', // 用户发送的消息
        content,
        type: 'opinion',
      }),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('meetings');
        setNewMessage('');
      },
    }
  );

  const inviteMutation = useMutation(
    ({ id, agentId, invitedBy }: { id: string; agentId: string; invitedBy: string }) => 
      meetingService.inviteAgent(id, agentId, invitedBy),
    {
      onSuccess: (data) => {
        queryClient.invalidateQueries('meetings');
        if (selectedMeeting?.id === data.id) {
          setSelectedMeeting(data);
        }
      },
    }
  );

  useEffect(() => {
    if (selectedMeeting) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedMeeting?.messages]);

  // 刷新选中会议的数据
  useEffect(() => {
    if (selectedMeeting) {
      const interval = setInterval(async () => {
        const updated = await meetingService.getMeeting(selectedMeeting.id);
        if (updated) {
          setSelectedMeeting(updated);
        }
      }, 3000); // 每3秒刷新一次

      return () => clearInterval(interval);
    }
  }, [selectedMeeting?.id]);

  const getMeetingTypeInfo = (type: MeetingType) => {
    return MEETING_TYPES.find(t => t.id === type) || MEETING_TYPES[2];
  };

  const getStatusBadge = (status: MeetingStatus) => {
    const styles = {
      [MeetingStatus.PENDING]: 'bg-gray-100 text-gray-800',
      [MeetingStatus.ACTIVE]: 'bg-green-100 text-green-800',
      [MeetingStatus.PAUSED]: 'bg-yellow-100 text-yellow-800',
      [MeetingStatus.ENDED]: 'bg-red-100 text-red-800',
    };
    const labels = {
      [MeetingStatus.PENDING]: '待开始',
      [MeetingStatus.ACTIVE]: '进行中',
      [MeetingStatus.PAUSED]: '已暂停',
      [MeetingStatus.ENDED]: '已结束',
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  if (meetingsLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-6rem)] flex">
      {/* 左侧会议列表 */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-xl font-semibold text-gray-900">会议室</h1>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
            >
              <PlusIcon className="h-4 w-4 mr-1" />
              新建
            </button>
          </div>
          
          {/* 统计 */}
          {stats && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-gray-50 rounded p-2">
                <div className="text-lg font-semibold text-gray-900">{stats.total}</div>
                <div className="text-xs text-gray-500">总会议</div>
              </div>
              <div className="bg-green-50 rounded p-2">
                <div className="text-lg font-semibold text-green-600">
                  {stats.byStatus.find(s => s._id === 'active')?.count || 0}
                </div>
                <div className="text-xs text-gray-500">进行中</div>
              </div>
              <div className="bg-blue-50 rounded p-2">
                <div className="text-lg font-semibold text-blue-600">{stats.totalMessages}</div>
                <div className="text-xs text-gray-500">总消息</div>
              </div>
            </div>
          )}
        </div>

        {/* 会议列表 */}
        <div className="flex-1 overflow-y-auto">
          {meetings?.map((meeting) => {
            const typeInfo = getMeetingTypeInfo(meeting.type);
            const presentCount = meeting.participants.filter(p => p.isPresent).length;
            
            return (
              <div
                key={meeting.id}
                onClick={() => setSelectedMeeting(meeting)}
                className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                  selectedMeeting?.id === meeting.id ? 'bg-primary-50 border-l-4 border-l-primary-600' : ''
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-gray-900 truncate">{meeting.title}</h3>
                  {getStatusBadge(meeting.status)}
                </div>
                <div className="flex items-center text-sm text-gray-500 mb-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs mr-2 ${typeInfo.color}`}>
                    {typeInfo.icon} {typeInfo.name}
                  </span>
                  <span className="flex items-center">
                    <UserGroupIcon className="h-3 w-3 mr-1" />
                    {presentCount}/{meeting.participants.length}
                  </span>
                </div>
                <div className="flex items-center text-xs text-gray-400">
                  <ChatBubbleLeftRightIcon className="h-3 w-3 mr-1" />
                  {meeting.messageCount} 条消息
                  {meeting.startedAt && (
                    <>
                      <span className="mx-2">•</span>
                      <ClockIcon className="h-3 w-3 mr-1" />
                      {new Date(meeting.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          
          {meetings?.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <VideoCameraIcon className="h-12 w-12 mx-auto mb-2 text-gray-300" />
              <p>暂无会议</p>
              <p className="text-sm">点击"新建"创建第一个会议</p>
            </div>
          )}
        </div>
      </div>

      {/* 右侧会议详情/讨论区 */}
      <div className="flex-1 bg-gray-50 flex flex-col">
        {selectedMeeting ? (
          <>
            {/* 会议头部 */}
            <div className="bg-white border-b border-gray-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-semibold text-gray-900">{selectedMeeting.title}</h2>
                    {getStatusBadge(selectedMeeting.status)}
                  </div>
                  <p className="text-sm text-gray-500">{selectedMeeting.description}</p>
                  {selectedMeeting.agenda && (
                    <p className="text-sm text-gray-600 mt-1">
                      <span className="font-medium">议程：</span>{selectedMeeting.agenda}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedMeeting.status === MeetingStatus.PENDING && (
                    <button
                      onClick={() => startMutation.mutate({ 
                        id: selectedMeeting.id, 
                        startedBy: selectedMeeting.hostId 
                      })}
                      disabled={startMutation.isLoading}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                    >
                      <PlayIcon className="h-4 w-4 mr-1" />
                      开始会议
                    </button>
                  )}
                  {selectedMeeting.status === MeetingStatus.ACTIVE && (
                    <button
                      onClick={() => endMutation.mutate(selectedMeeting.id)}
                      disabled={endMutation.isLoading}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                    >
                      <StopIcon className="h-4 w-4 mr-1" />
                      结束会议
                    </button>
                  )}
                </div>
              </div>

              {/* 参与者列表 */}
              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm text-gray-500">参与者：</span>
                <div className="flex items-center gap-1">
                  {selectedMeeting.participants.map((participant) => {
                    const agent = agents?.find(a => a.id === participant.agentId);
                    return (
                      <div
                        key={participant.agentId}
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 ${
                          participant.isPresent 
                            ? 'bg-green-500 text-white border-green-500' 
                            : 'bg-gray-200 text-gray-600 border-gray-300'
                        }`}
                        title={`${agent?.name || participant.agentId} ${participant.isPresent ? '(在线)' : '(离线)'}`}
                      >
                        {(agent?.name || participant.agentId).charAt(0).toUpperCase()}
                      </div>
                    );
                  })}
                  
                  {/* 邀请按钮 */}
                  {selectedMeeting.status !== MeetingStatus.ENDED && agents && (
                    <div className="relative group">
                      <button className="w-8 h-8 rounded-full bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:border-gray-400">
                        <UserPlusIcon className="h-4 w-4" />
                      </button>
                      
                      {/* 邀请下拉菜单 */}
                      <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 hidden group-hover:block">
                        <div className="p-2 max-h-48 overflow-y-auto">
                          <p className="text-xs text-gray-500 mb-2 px-2">点击邀请Agent</p>
                          {agents
                            .filter(a => 
                              a.isActive && 
                              !selectedMeeting.participants.some(p => p.agentId === a.id) &&
                              !selectedMeeting.invitedAgentIds.includes(a.id!)
                            )
                            .map(agent => (
                              <button
                                key={agent.id}
                                onClick={() => inviteMutation.mutate({
                                  id: selectedMeeting.id,
                                  agentId: agent.id!,
                                  invitedBy: selectedMeeting.hostId,
                                })}
                                className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100 rounded flex items-center"
                              >
                                <div className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs mr-2">
                                  {agent.name.charAt(0)}
                                </div>
                                {agent.name}
                              </button>
                            ))}
                          {agents.filter(a => 
                            a.isActive && 
                            !selectedMeeting.participants.some(p => p.agentId === a.id) &&
                            !selectedMeeting.invitedAgentIds.includes(a.id!)
                          ).length === 0 && (
                            <p className="text-xs text-gray-400 px-2 py-1">没有可邀请的Agent</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                {selectedMeeting.invitedAgentIds.length > 0 && (
                  <span className="text-xs text-gray-400 ml-2">
                    +{selectedMeeting.invitedAgentIds.length} 已邀请
                  </span>
                )}
              </div>
            </div>

            {/* 消息区域 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {selectedMeeting.messages.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <ChatBubbleLeftRightIcon className="h-16 w-16 mx-auto mb-4 text-gray-200" />
                  <p>会议尚未开始</p>
                  <p className="text-sm">会议开始后，Agents将自动参与讨论</p>
                </div>
              ) : (
                selectedMeeting.messages.map((message, index) => {
                  const agent = agents?.find(a => a.id === message.agentId);
                  const isSystem = message.agentId === 'system';
                  const isUser = message.agentId === 'user';
                  
                  return (
                    <div
                      key={message.id || index}
                      className={`flex ${isSystem ? 'justify-center' : isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      {isSystem ? (
                        <div className="bg-gray-100 text-gray-600 text-sm px-4 py-2 rounded-full">
                          {message.content}
                        </div>
                      ) : (
                        <div className={`max-w-[70%] ${isUser ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200'} rounded-lg px-4 py-3 shadow-sm`}>
                          {!isUser && (
                            <div className="flex items-center gap-2 mb-1">
                              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium">
                                {(agent?.name || message.agentId).charAt(0).toUpperCase()}
                              </div>
                              <span className="text-xs font-medium text-gray-600">
                                {agent?.name || message.agentId}
                              </span>
                              {message.type && message.type !== 'opinion' && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                                  {message.type === 'question' ? '提问' : 
                                   message.type === 'agreement' ? '赞同' :
                                   message.type === 'disagreement' ? '反对' :
                                   message.type === 'suggestion' ? '建议' :
                                   message.type === 'introduction' ? '入场' :
                                   message.type === 'action_item' ? '行动项' : '观点'}
                                </span>
                              )}
                            </div>
                          )}
                          <p className={`text-sm ${isUser ? 'text-white' : 'text-gray-800'} whitespace-pre-wrap`}>
                            {message.content}
                          </p>
                          <div className={`text-xs mt-1 ${isUser ? 'text-primary-200' : 'text-gray-400'}`}>
                            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入框 */}
            {selectedMeeting.status === MeetingStatus.ACTIVE && (
              <div className="bg-white border-t border-gray-200 px-6 py-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && newMessage.trim()) {
                        sendMessageMutation.mutate({ id: selectedMeeting.id, content: newMessage });
                      }
                    }}
                    placeholder="输入消息..."
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <button
                    onClick={() => {
                      if (newMessage.trim()) {
                        sendMessageMutation.mutate({ id: selectedMeeting.id, content: newMessage });
                      }
                    }}
                    disabled={sendMessageMutation.isLoading || !newMessage.trim()}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <PaperAirplaneIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )}

            {/* 会议总结 */}
            {selectedMeeting.summary && (
              <div className="bg-blue-50 border-t border-blue-200 px-6 py-4">
                <h3 className="text-sm font-semibold text-blue-900 mb-2 flex items-center">
                  <CheckCircleIcon className="h-4 w-4 mr-1" />
                  会议总结
                </h3>
                <div className="text-sm text-blue-800 whitespace-pre-wrap">
                  {selectedMeeting.summary.content}
                </div>
                {selectedMeeting.summary.actionItems.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-blue-900">行动项：</p>
                    <ul className="text-xs text-blue-800 list-disc list-inside mt-1">
                      {selectedMeeting.summary.actionItems.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <VideoCameraIcon className="h-16 w-16 mx-auto mb-4 text-gray-200" />
              <p className="text-lg">选择一个会议开始</p>
              <p className="text-sm mt-1">或创建新会议</p>
            </div>
          </div>
        )}
      </div>

      {/* 创建会议模态框 */}
      {isCreateModalOpen && (
        <CreateMeetingModal
          agents={agents?.filter(a => a.isActive) || []}
          onClose={() => setIsCreateModalOpen(false)}
          onCreate={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isLoading}
        />
      )}
    </div>
  );
};

// 创建会议模态框
const CreateMeetingModal: React.FC<{
  agents: Agent[];
  onClose: () => void;
  onCreate: (data: CreateMeetingDto) => void;
  isLoading: boolean;
}> = ({ agents, onClose, onCreate, isLoading }) => {
  const [formData, setFormData] = useState<Partial<CreateMeetingDto>>({
    title: '',
    description: '',
    type: MeetingType.DAILY,
    hostId: agents[0]?.id || '',
    participantIds: [],
    agenda: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.title && formData.hostId) {
      onCreate(formData as CreateMeetingDto);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[600px] max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900">创建新会议</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                会议标题 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="例如：产品需求评审会议"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                会议类型 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {MEETING_TYPES.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setFormData({ ...formData, type: type.id })}
                    className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                      formData.type === type.id
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className="mr-1">{type.icon}</span>
                    {type.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                rows={2}
                placeholder="会议目的和背景..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">议程</label>
              <textarea
                value={formData.agenda}
                onChange={(e) => setFormData({ ...formData, agenda: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                rows={2}
                placeholder="1. 讨论议题A\n2. 讨论议题B\n3. 决策和行动计划"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                主持人 <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.hostId}
                onChange={(e) => setFormData({ ...formData, hostId: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">选择主持人</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} ({agent.type})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">参与者</label>
              <div className="border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                {agents
                  .filter(a => a.id !== formData.hostId)
                  .map((agent) => (
                    <label key={agent.id} className="flex items-center p-2 hover:bg-gray-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.participantIds?.includes(agent.id!)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({
                              ...formData,
                              participantIds: [...(formData.participantIds || []), agent.id!],
                            });
                          } else {
                            setFormData({
                              ...formData,
                              participantIds: formData.participantIds?.filter(id => id !== agent.id) || [],
                            });
                          }
                        }}
                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">{agent.name}</p>
                        <p className="text-xs text-gray-500">{agent.type}</p>
                      </div>
                    </label>
                  ))}
                {agents.filter(a => a.id !== formData.hostId).length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">没有其他可用的Agent</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isLoading || !formData.title || !formData.hostId}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {isLoading ? '创建中...' : '创建会议'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Meetings;
