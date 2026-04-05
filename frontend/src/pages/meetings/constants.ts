import { MeetingType } from '../../services/meetingService';
import { PhraseSuggestion } from './types';

export const MEETING_TYPES = [
  { id: MeetingType.WEEKLY, name: '周会', color: 'bg-blue-100 text-blue-800', icon: '📅' },
  { id: MeetingType.BOARD, name: '董事会', color: 'bg-purple-100 text-purple-800', icon: '👔' },
  { id: MeetingType.DAILY, name: '日常讨论', color: 'bg-green-100 text-green-800', icon: '💬' },
  { id: MeetingType.DEPARTMENT, name: '部门会议', color: 'bg-yellow-100 text-yellow-800', icon: '🏢' },
  { id: MeetingType.AD_HOC, name: '临时会议', color: 'bg-gray-100 text-gray-800', icon: '⚡' },
  { id: MeetingType.ONE_ON_ONE, name: '一对一对话', color: 'bg-slate-100 text-slate-800', icon: '💬' },
  { id: MeetingType.PROJECT, name: '项目会议', color: 'bg-indigo-100 text-indigo-800', icon: '📊' },
  { id: MeetingType.EMERGENCY, name: '紧急会议', color: 'bg-red-100 text-red-800', icon: '🚨' },
];

export const CREATE_MODAL_MEETING_TYPES = MEETING_TYPES.filter(
  (type) => type.id !== MeetingType.DEPARTMENT && type.id !== MeetingType.ONE_ON_ONE,
);

export const MEETING_PHRASE_SUGGESTIONS: PhraseSuggestion[] = [
  { key: 'model_list', label: '查询模型列表 (ZH)', command: '[当前有哪些模型]' },
  { key: 'model_list', label: 'List models (EN)', command: '[list models]' },
  { key: 'model_search', label: '搜索最新模型 (ZH)', command: '[搜索最新openai模型]' },
  { key: 'model_search', label: 'Search latest models (EN)', command: '[search latest openai models]' },
  { key: 'memo_record', label: '记录到备忘录 (ZH)', command: '[记录到备忘录]' },
  { key: 'memo_record', label: 'Append to memo (EN)', command: '[append to memo]' },
  { key: 'operation_log', label: '查看操作日志 (ZH)', command: '[查看操作日志]' },
  { key: 'operation_log', label: 'Operation log (EN)', command: '[operation log]' },
  { key: 'agent_list', label: '查看Agent列表 (ZH)', command: '[查看agent列表]' },
  { key: 'agent_list', label: 'List agents (EN)', command: '[list agents]' },
];
