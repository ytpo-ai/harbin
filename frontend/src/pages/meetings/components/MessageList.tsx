import React from 'react';
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import { MeetingStatus } from '../../../services/meetingService';
import { MessageListProps } from '../types';

const MessageList: React.FC<MessageListProps> = ({
  meeting,
  currentUser,
  repliedMessageIds,
  getParticipantDisplayName,
  onPauseMessageResponse,
  onRevokePausedMessage,
  isPausingMessageResponse,
  isRevokingPausedMessage,
  messagesEndRef,
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {meeting.status === MeetingStatus.PENDING ? (
        <div className="text-center py-12 text-gray-400">
          <ChatBubbleLeftRightIcon className="h-16 w-16 mx-auto mb-4 text-gray-200" />
          <p>会议尚未开始</p>
          <p className="text-sm">点击"开始会议"按钮开始讨论</p>
        </div>
      ) : (meeting.messages || []).length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <ChatBubbleLeftRightIcon className="h-16 w-16 mx-auto mb-4 text-gray-200" />
          <p>等待第一条消息</p>
          <p className="text-sm">发送消息开始讨论；专属助理仅在您主动 @ 时响应</p>
        </div>
      ) : (
        meeting.messages.map((message, index) => {
          const legacyMessage = message as any;
          const senderId = message.senderId || legacyMessage.agentId || 'unknown';
          const senderName = getParticipantDisplayName(senderId, message.senderType === 'agent' ? 'agent' : 'employee');
          const isSystem = message.senderType === 'system';
          const isCurrentUsersEmployeeMessage = message.senderType === 'employee' && senderId === currentUser?.id;
          const isCurrentUsersLegacyProxyMessage =
            message.senderType === 'agent' &&
            message.metadata?.isAIProxy &&
            message.metadata?.proxyForEmployeeId === currentUser?.id;
          const isUser = isCurrentUsersEmployeeMessage || isCurrentUsersLegacyProxyMessage;
          const isPausedPendingResponse = Boolean(message.metadata?.pendingResponsePaused);
          const canPausePendingResponse =
            isUser &&
            meeting.status === MeetingStatus.ACTIVE &&
            !isPausedPendingResponse &&
            !repliedMessageIds.has(message.id);
          const canRevokePausedMessage =
            isUser &&
            meeting.status === MeetingStatus.ACTIVE &&
            isPausedPendingResponse &&
            !repliedMessageIds.has(message.id);

          return (
            <div key={message.id || index} className={`flex ${isSystem ? 'justify-center' : isUser ? 'justify-end' : 'justify-start'}`}>
              {isSystem ? (
                <div className="bg-gray-100 text-gray-600 text-sm px-4 py-2 rounded-full">{message.content}</div>
              ) : (
                <div className={`max-w-[70%] ${isUser ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200'} rounded-lg px-4 py-3 shadow-sm`}>
                  {!isUser && (
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium">
                        {senderName.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-xs font-medium text-gray-600">{senderName}</span>
                      {message.type && message.type !== 'opinion' && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                          {message.type === 'question'
                            ? '提问'
                            : message.type === 'agreement'
                              ? '赞同'
                              : message.type === 'disagreement'
                                ? '反对'
                                : message.type === 'suggestion'
                                  ? '建议'
                                  : message.type === 'introduction'
                                    ? '入场'
                                    : message.type === 'action_item'
                                      ? '行动项'
                                      : '观点'}
                        </span>
                      )}
                    </div>
                  )}
                  <p className={`text-sm ${isUser ? 'text-white' : 'text-gray-800'} whitespace-pre-wrap`}>{message.content}</p>
                  <div className={`text-xs mt-1 ${isUser ? 'text-primary-200' : 'text-gray-400'}`}>
                    {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  {(canPausePendingResponse || canRevokePausedMessage) && (
                    <div className="mt-2 flex items-center gap-2">
                      {canPausePendingResponse && (
                        <button
                          onClick={() => onPauseMessageResponse(message.id)}
                          disabled={isPausingMessageResponse}
                          className="inline-flex items-center rounded border border-primary-300 px-2 py-0.5 text-xs text-primary-700 hover:bg-primary-50 disabled:opacity-50"
                        >
                          暂停回复
                        </button>
                      )}
                      {canRevokePausedMessage && (
                        <>
                          <span className="text-xs text-amber-300">已暂停</span>
                          <button
                            onClick={() => onRevokePausedMessage(message.id)}
                            disabled={isRevokingPausedMessage}
                            className="inline-flex items-center rounded border border-red-300 px-2 py-0.5 text-xs text-red-100 hover:bg-red-500/20 disabled:opacity-50"
                          >
                            撤回
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;
