import { Injectable } from '@nestjs/common';
import { EiManagementService } from './management.service';
import { CreateRdTaskDto, QueryRdTaskDto, UpdateRdTaskDto } from '../dto';

@Injectable()
export class EiTasksService {
  constructor(private readonly core: EiManagementService) {}

  createTask(payload: CreateRdTaskDto, userId: string) {
    return this.core.createTask(payload, userId);
  }

  findAllTasks(query: QueryRdTaskDto) {
    return this.core.findAllTasks(query);
  }

  findTaskById(taskId: string) {
    return this.core.findTaskById(taskId);
  }

  updateTask(taskId: string, payload: UpdateRdTaskDto) {
    return this.core.updateTask(taskId, payload);
  }

  deleteTask(taskId: string) {
    return this.core.deleteTask(taskId);
  }

  completeTask(taskId: string, result: any) {
    return this.core.completeTask(taskId, result);
  }
}
