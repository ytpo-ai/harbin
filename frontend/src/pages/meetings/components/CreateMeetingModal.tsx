import React, { useEffect, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { CreateMeetingDto, MeetingType } from '../../../services/meetingService';
import { CREATE_MODAL_MEETING_TYPES } from '../constants';
import { CreateMeetingModalProps } from '../types';

const CreateMeetingModal: React.FC<CreateMeetingModalProps> = ({
  agents,
  currentUser,
  onClose,
  onCreate,
  isLoading,
}) => {
  const [formData, setFormData] = useState<Partial<CreateMeetingDto>>({
    title: '',
    description: '',
    type: MeetingType.DAILY,
    hostId: currentUser?.id || '',
    hostType: 'employee',
    participantIds: [],
    agenda: '',
  });

  useEffect(() => {
    if (currentUser) {
      setFormData({
        title: '',
        description: '',
        type: MeetingType.DAILY,
        hostId: currentUser.id,
        hostType: 'employee',
        participantIds: [],
        agenda: '',
      });
    }
  }, [currentUser]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (formData.title && formData.hostId) {
      onCreate({
        ...formData,
        hostId: formData.hostId,
        hostType: 'employee',
      } as CreateMeetingDto);
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
                onChange={(event) => setFormData({ ...formData, title: event.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="例如：产品需求评审会议"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                会议类型 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {CREATE_MODAL_MEETING_TYPES.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setFormData({ ...formData, type: type.id })}
                    className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                      formData.type === type.id ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:bg-gray-50'
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
                onChange={(event) => setFormData({ ...formData, description: event.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                rows={2}
                placeholder="会议目的和背景..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">议程</label>
              <textarea
                value={formData.agenda}
                onChange={(event) => setFormData({ ...formData, agenda: event.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                rows={2}
                placeholder={'1. 讨论议题A\n2. 讨论议题B\n3. 决策和行动计划'}
              />
            </div>

            <div className="rounded-md border border-primary-200 bg-primary-50 px-3 py-2">
              <p className="text-sm font-medium text-primary-900">主持人将设置为你本人（员工身份）</p>
              <p className="mt-1 text-xs text-primary-700">当前主持人：{currentUser?.name || currentUser?.email || '当前账号'}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">参与者 (可多选)</label>
              <div className="border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                {currentUser && currentUser.id !== formData.hostId && (
                  <label className="flex items-center p-2 hover:bg-gray-50 rounded cursor-pointer border-b mb-2">
                    <input
                      type="checkbox"
                      checked={formData.participantIds?.some((item) => item.id === currentUser.id)}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setFormData({
                            ...formData,
                            participantIds: [...(formData.participantIds || []), { id: currentUser.id, type: 'employee' }],
                          });
                        } else {
                          setFormData({
                            ...formData,
                            participantIds: formData.participantIds?.filter((item) => item.id !== currentUser.id) || [],
                          });
                        }
                      }}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-900">{currentUser.name || currentUser.email}</p>
                      <p className="text-xs text-gray-500">我 (员工)</p>
                    </div>
                  </label>
                )}
                {agents
                  .filter((agent) => (formData.hostId ? agent.id !== formData.hostId : true))
                  .map((agent) => (
                    <label key={agent.id} className="flex items-center p-2 hover:bg-gray-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.participantIds?.some((item) => item.id === agent.id) || false}
                        onChange={(event) => {
                          const currentParticipants = formData.participantIds || [];
                          if (event.target.checked) {
                            setFormData({
                              ...formData,
                              participantIds: [...currentParticipants, { id: agent.id, type: 'agent' as const }],
                            });
                          } else {
                            setFormData({
                              ...formData,
                              participantIds: currentParticipants.filter((item) => item.id !== agent.id),
                            });
                          }
                        }}
                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">{agent.name}</p>
                        <p className="text-xs text-gray-500">{agent.roleId}</p>
                      </div>
                    </label>
                  ))}
                {(agents.length === 0 || agents.filter((agent) => (formData.hostId ? agent.id !== formData.hostId : true)).length === 0) && (
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
                disabled={isLoading || !formData.title || !currentUser?.id}
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

export default CreateMeetingModal;
