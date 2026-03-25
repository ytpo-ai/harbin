import {
  Schedule,
  ScheduleDocument,
  ScheduleSchema,
  ScheduleStatus,
  ScheduleType,
} from './schedule.schema';

export type OrchestrationScheduleDocument = ScheduleDocument;
export type OrchestrationScheduleStatus = ScheduleStatus;
export type OrchestrationScheduleType = ScheduleType;

export class OrchestrationSchedule extends Schedule {}
export const OrchestrationScheduleSchema = ScheduleSchema;
