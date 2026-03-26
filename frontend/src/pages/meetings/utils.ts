import React from 'react';
import { Meeting, MeetingStatus, MeetingType } from '../../services/meetingService';
import { MEETING_TYPES } from './constants';

const STATUS_SUFFIX_PATTERN = /(?:[\s()\[\]{}【】（）\-:：]+)?(待开始|进行中|已暂停|已结束|已归档)(?:[\s)\]】）]+)?$/;
const ONE_TO_ONE_TITLE_PATTERN = /^与\s*(.+?)\s*的1对1聊天$/;
const ONE_TO_ONE_DESCRIPTION_PATTERN = /^与\s*Agent\s*(.+?)\s*的直接会话$/i;
const FALLBACK_MEETING_TITLE = '未命名会议';

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const normalizeOneToOneParticipantName = (value: string) => normalizeWhitespace(value).replace(/^Agent\s+/i, '').toLowerCase();

export const normalizeMeetingTitle = (value?: string) => {
  if (!value) {
    return '';
  }

  let normalized = normalizeWhitespace(value);
  while (STATUS_SUFFIX_PATTERN.test(normalized)) {
    normalized = normalized.replace(STATUS_SUFFIX_PATTERN, '').trim();
  }

  return normalized;
};

const getSemanticMeetingTitleKey = (value?: string) => {
  const normalized = normalizeMeetingTitle(value);
  if (!normalized) {
    return '';
  }

  const normalizedTitleMatch = normalized.match(ONE_TO_ONE_TITLE_PATTERN);
  if (normalizedTitleMatch) {
    return `one_to_one:${normalizeOneToOneParticipantName(normalizedTitleMatch[1])}`;
  }

  const normalizedDescriptionMatch = normalized.match(ONE_TO_ONE_DESCRIPTION_PATTERN);
  if (normalizedDescriptionMatch) {
    return `one_to_one:${normalizeOneToOneParticipantName(normalizedDescriptionMatch[1])}`;
  }

  return `text:${normalized.toLowerCase()}`;
};

export const isDuplicateMeetingDescription = (title?: string, description?: string) => {
  const titleKey = getSemanticMeetingTitleKey(title);
  const descriptionKey = getSemanticMeetingTitleKey(description);
  return Boolean(titleKey && descriptionKey && titleKey === descriptionKey);
};

export const getMeetingDisplayTitle = (title?: string, description?: string) => {
  const normalizedTitle = normalizeMeetingTitle(title);
  if (normalizedTitle) {
    return normalizedTitle;
  }

  const normalizedDescription = normalizeMeetingTitle(description);
  return normalizedDescription || FALLBACK_MEETING_TITLE;
};

export const getMeetingDisplayDescription = (title?: string, description?: string) => {
  const normalizedDescription = normalizeMeetingTitle(description);
  if (!normalizedDescription || isDuplicateMeetingDescription(title, normalizedDescription)) {
    return '';
  }

  return normalizedDescription;
};

export const mergeMeetingMessages = (current: Meeting | null, next: Meeting): Meeting['messages'] => {
  const merged = new Map<string, Meeting['messages'][number]>();
  const currentMessages = current?.messages || [];
  const nextMessages = next.messages || [];

  currentMessages.forEach((message) => {
    if (message?.id) {
      merged.set(message.id, message);
    }
  });

  nextMessages.forEach((message) => {
    if (message?.id) {
      merged.set(message.id, message);
    }
  });

  const orderedCurrentIds = currentMessages.map((message) => message.id).filter(Boolean);
  const orderedNextIds = nextMessages.map((message) => message.id).filter(Boolean);
  const orderedIds = Array.from(new Set([...orderedCurrentIds, ...orderedNextIds]));
  const orderedMessages = orderedIds
    .map((id) => merged.get(id))
    .filter((message): message is Meeting['messages'][number] => Boolean(message));

  if (orderedMessages.length > 0) {
    return orderedMessages;
  }

  return nextMessages;
};

export const getMeetingTypeInfo = (type: MeetingType) => {
  return MEETING_TYPES.find((item) => item.id === type) || MEETING_TYPES[2];
};

export const getSpeakingModeLabel = (mode?: string) => {
  if (mode === 'ordered' || mode === 'sequential' || mode === 'round_robin') {
    return '有序发言';
  }
  return '自由讨论';
};

export const getParticipantDisplayName = (
  participantDisplayMap: Map<string, string>,
  selectedMeeting: Meeting | null,
  participantId: string,
  participantType: 'employee' | 'agent',
  participant?: Meeting['participants'][number],
) => {
  const resolvedParticipant =
    participant || selectedMeeting?.participants?.find((item) => item.participantId === participantId && item.participantType === participantType);

  if (resolvedParticipant?.isExclusiveAssistant) {
    const assistantName = participantDisplayMap.get(`agent:${participantId}`);
    if (assistantName) {
      return assistantName;
    }

    if (resolvedParticipant.assistantForEmployeeId) {
      const ownerName =
        participantDisplayMap.get(`employee:${resolvedParticipant.assistantForEmployeeId}`) ||
        resolvedParticipant.assistantForEmployeeId;
      return `${ownerName}的专属助理`;
    }
  }

  return participantDisplayMap.get(`${participantType}:${participantId}`) || participantId;
};

export const getStatusBadge = (status: MeetingStatus) => {
  const styles: Record<string, string> = {
    [MeetingStatus.PENDING]: 'bg-gray-100 text-gray-800',
    [MeetingStatus.ACTIVE]: 'bg-green-100 text-green-800',
    [MeetingStatus.PAUSED]: 'bg-yellow-100 text-yellow-800',
    [MeetingStatus.ENDED]: 'bg-red-100 text-red-800',
    [MeetingStatus.ARCHIVED]: 'bg-blue-100 text-blue-800',
  };
  const labels: Record<string, string> = {
    [MeetingStatus.PENDING]: '待开始',
    [MeetingStatus.ACTIVE]: '进行中',
    [MeetingStatus.PAUSED]: '已暂停',
    [MeetingStatus.ENDED]: '已结束',
    [MeetingStatus.ARCHIVED]: '已归档',
  };

  return React.createElement(
    'span',
    {
      className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status]}`,
    },
    labels[status],
  );
};
