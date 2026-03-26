import React from 'react';
import {
  ArchiveBoxIcon,
  ArrowTopRightOnSquareIcon,
  EllipsisVerticalIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { MeetingStatus } from '../../../services/meetingService';
import { MeetingStatusActionsProps } from '../types';

type StatusAction = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
  confirm?: string;
};

const MeetingStatusActions: React.FC<MeetingStatusActionsProps> = ({
  meeting,
  currentUser,
  showOperationMenu,
  setShowOperationMenu,
  mutations,
}) => {
  const actionKey = meeting.status;

  const openAction: StatusAction = {
    label: '在新标签页打开',
    icon: ArrowTopRightOnSquareIcon,
    onClick: () => mutations.openMeetingInNewTab(meeting.id),
  };

  const ACTIONS_MAP: Record<MeetingStatus, StatusAction[]> = {
    [MeetingStatus.PENDING]: [
      openAction,
      {
        label: '删除会议',
        icon: TrashIcon,
        className: 'text-red-600',
        disabled: mutations.isDeletingMeeting,
        confirm: '确定要删除此未开始会议吗？此操作不可撤销。',
        onClick: () => mutations.deleteMeeting(meeting.id),
      },
    ],
    [MeetingStatus.ACTIVE]: [
      openAction,
      {
        label: '暂停会议',
        icon: PauseIcon,
        disabled: mutations.isPausingMeeting,
        onClick: () => mutations.pauseMeeting(meeting.id),
      },
      {
        label: '结束会议',
        icon: StopIcon,
        disabled: mutations.isEndingMeeting,
        onClick: () => mutations.endMeeting(meeting.id),
      },
      {
        label: '停止并删除',
        icon: TrashIcon,
        className: 'text-red-600',
        disabled: mutations.isEndingMeeting || mutations.isDeletingMeeting,
        onClick: () => mutations.stopAndDeleteMeeting(meeting.id),
      },
    ],
    [MeetingStatus.PAUSED]: [
      openAction,
      {
        label: '恢复会议',
        icon: PlayIcon,
        disabled: mutations.isResumingMeeting,
        onClick: () => mutations.resumeMeeting(meeting.id),
      },
      {
        label: '结束会议',
        icon: StopIcon,
        disabled: mutations.isEndingMeeting,
        onClick: () => mutations.endMeeting(meeting.id),
      },
      {
        label: '停止并删除',
        icon: TrashIcon,
        className: 'text-red-600',
        disabled: mutations.isEndingMeeting || mutations.isDeletingMeeting,
        onClick: () => mutations.stopAndDeleteMeeting(meeting.id),
      },
    ],
    [MeetingStatus.ENDED]: [
      openAction,
      {
        label: '归档会议',
        icon: ArchiveBoxIcon,
        disabled: mutations.isArchivingMeeting,
        onClick: () => mutations.archiveMeeting(meeting.id),
      },
      {
        label: '删除会议',
        icon: TrashIcon,
        className: 'text-red-600',
        disabled: mutations.isDeletingMeeting,
        confirm: '确定要删除此会议吗？此操作不可撤销。',
        onClick: () => mutations.deleteMeeting(meeting.id),
      },
    ],
    [MeetingStatus.ARCHIVED]: [
      openAction,
      {
        label: '删除会议',
        icon: TrashIcon,
        className: 'text-red-600',
        disabled: mutations.isDeletingMeeting,
        confirm: '确定要删除此已归档会议吗？此操作不可撤销。',
        onClick: () => mutations.deleteMeeting(meeting.id),
      },
    ],
  };

  const actions = ACTIONS_MAP[meeting.status] || [];

  const executeAction = async (event: React.MouseEvent, action: StatusAction) => {
    event.stopPropagation();
    if (action.confirm && !window.confirm(action.confirm)) {
      return;
    }
    await action.onClick();
    setShowOperationMenu(null);
  };

  if (meeting.status === MeetingStatus.PENDING) {
    return (
      <>
        <button
          onClick={(event) => {
            event.stopPropagation();
            mutations.startMeeting({
              id: meeting.id,
              startedById: meeting.hostId,
              startedByType: meeting.hostType || 'employee',
              startedByName: currentUser?.name || '主持人',
            });
          }}
          disabled={mutations.isStartingMeeting}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
        >
          <PlayIcon className="h-4 w-4" />
        </button>
        <div className="relative">
          <button
            onClick={(event) => {
              event.stopPropagation();
              setShowOperationMenu(showOperationMenu === actionKey ? null : actionKey);
            }}
            className="inline-flex items-center justify-center h-9 w-9 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            <EllipsisVerticalIcon className="h-4 w-4" />
          </button>
          {showOperationMenu === actionKey && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200">
              {actions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    onClick={(event) => void executeAction(event, action)}
                    disabled={action.disabled}
                    className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 disabled:opacity-50 flex items-center ${
                      action.className || 'text-gray-700'
                    }`}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {action.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </>
    );
  }

  if (meeting.status === MeetingStatus.PAUSED) {
    return (
      <div className="relative">
        <button
          onClick={(event) => {
            event.stopPropagation();
            setShowOperationMenu(showOperationMenu === actionKey ? null : actionKey);
          }}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
        >
          <PlayIcon className="h-4 w-4 mr-1" />
          继续
        </button>
        {showOperationMenu === actionKey && (
          <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  onClick={(event) => void executeAction(event, action)}
                  disabled={action.disabled}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 disabled:opacity-50 flex items-center ${
                    action.className || 'text-gray-700'
                  }`}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {action.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={(event) => {
          event.stopPropagation();
          setShowOperationMenu(showOperationMenu === actionKey ? null : actionKey);
        }}
        className="inline-flex items-center justify-center h-9 w-9 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50"
      >
        <EllipsisVerticalIcon className="h-4 w-4" />
      </button>
      {showOperationMenu === actionKey && (
        <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                onClick={(event) => void executeAction(event, action)}
                disabled={action.disabled}
                className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 disabled:opacity-50 flex items-center ${
                  action.className || 'text-gray-700'
                }`}
              >
                <Icon className="h-4 w-4 mr-2" />
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MeetingStatusActions;
