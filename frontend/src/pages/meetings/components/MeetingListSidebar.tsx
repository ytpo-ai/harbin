import React from 'react';
import { ChatBubbleLeftRightIcon, ClockIcon, PlusIcon, UserGroupIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { MeetingListSidebarProps } from '../types';

const MeetingListSidebar: React.FC<MeetingListSidebarProps> = ({
  meetings,
  stats,
  selectedMeetingId,
  hasExclusiveAssistant,
  currentEmployee,
  onCreateClick,
  onSelectMeeting,
  getMeetingTypeInfo,
  getStatusBadge,
}) => {
  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-xl font-semibold text-gray-900">会议室</h1>
          <button
            onClick={onCreateClick}
            disabled={!hasExclusiveAssistant}
            className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
          >
            <PlusIcon className="h-4 w-4 mr-1" />
            新建
          </button>
        </div>

        {stats && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-50 rounded p-2">
              <div className="text-lg font-semibold text-gray-900">{stats.total}</div>
              <div className="text-xs text-gray-500">总会议</div>
            </div>
            <div className="bg-green-50 rounded p-2">
              <div className="text-lg font-semibold text-green-600">{stats.byStatus.find((item) => item._id === 'active')?.count || 0}</div>
              <div className="text-xs text-gray-500">进行中</div>
            </div>
            <div className="bg-blue-50 rounded p-2">
              <div className="text-lg font-semibold text-blue-600">{stats.totalMessages}</div>
              <div className="text-xs text-gray-500">总消息</div>
            </div>
          </div>
        )}

        {currentEmployee && !hasExclusiveAssistant && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            您还未绑定专属助理，当前账号不可发起或参与会议。
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {meetings?.map((meeting) => {
          const typeInfo = getMeetingTypeInfo(meeting.type);
          const presentCount = (meeting.participants || []).filter((participant) => participant.isPresent).length;

          return (
            <div
              key={meeting.id}
              onClick={() => onSelectMeeting(meeting)}
              className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                selectedMeetingId === meeting.id ? 'bg-primary-50 border-l-4 border-l-primary-600' : ''
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
                  {presentCount}/{(meeting.participants || []).length}
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
  );
};

export default MeetingListSidebar;
