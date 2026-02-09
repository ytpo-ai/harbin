import { Controller, Get, Post, Body, Param, Delete, Put } from '@nestjs/common';
import { TaskService } from './task.service';
import { Task, Agent, TeamSettings } from '../../shared/types';

@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post()
  async createTask(@Body() taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) {
    return this.taskService.createTask(taskData);
  }

  @Get()
  getAllTasks() {
    return this.taskService.getAllTasks();
  }

  @Get(':id')
  getTask(@Param('id') id: string) {
    return this.taskService.getTask(id);
  }

  @Put(':id')
  updateTask(@Param('id') id: string, @Body() updates: Partial<Task>) {
    return this.taskService.updateTask(id, updates);
  }

  @Delete(':id')
  deleteTask(@Param('id') id: string) {
    return this.taskService.deleteTask(id);
  }

  @Post(':id/execute')
  async executeWithCollaboration(
    @Param('id') id: string, 
    @Body() body: { 
      agents: Agent[], 
      teamSettings: TeamSettings 
    }) {
    return this.taskService.executeTaskWithCollaboration(
      id, 
      body.agents, 
      body.teamSettings
    );
  }
}