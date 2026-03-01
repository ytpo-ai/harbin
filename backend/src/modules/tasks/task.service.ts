import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument } from '../../shared/schemas/task.schema';
import { AgentClientService } from '../agents-client/agent-client.service';
import { DiscussionService } from '../chat/discussion.service';
import { Agent, TeamSettings, ChatMessage } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';

export interface CollaborationResult {
  success: boolean;
  result?: any;
  discussion?: any;
  errors?: string[];
}

@Injectable()
export class TaskService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly discussionService: DiscussionService
  ) {}

  async createTask(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    const newTask = new this.taskModel(taskData);
    return newTask.save();
  }

  async getTask(taskId: string): Promise<Task | null> {
    return this.taskModel.findById(taskId).exec();
  }

  async getAllTasks(): Promise<Task[]> {
    return this.taskModel.find().exec();
  }

  async updateTask(taskId: string, updates: Partial<Task>): Promise<Task | null> {
    return this.taskModel.findByIdAndUpdate(
      taskId, 
      { ...updates, updatedAt: new Date() }, 
      { new: true }
    ).exec();
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const result = await this.taskModel.findByIdAndDelete(taskId).exec();
    return !!result;
  }

  async executeTaskWithCollaboration(
    taskId: string,
    agents: Agent[],
    teamSettings: TeamSettings
  ): Promise<CollaborationResult> {
    const task = await this.getTask(taskId);
    if (!task) {
      return { success: false, errors: ['Task not found'] };
    }

    try {
      switch (teamSettings.collaborationMode) {
        case 'discussion':
          return await this.executeDiscussionMode(task, agents);
        case 'pipeline':
          return await this.executePipelineMode(task, agents);
        case 'parallel':
          return await this.executeParallelMode(task, agents);
        case 'hierarchical':
          return await this.executeHierarchicalMode(task, agents);
        default:
          return { success: false, errors: ['Unknown collaboration mode'] };
      }
    } catch (error) {
      return { 
        success: false, 
        errors: [error instanceof Error ? error.message : 'Unknown error'] 
      };
    }
  }

  private async executeDiscussionMode(task: Task, agents: Agent[]): Promise<CollaborationResult> {
    const agentIds = agents.map(agent => agent.id);
    
    // 创建讨论
    const discussion = await this.discussionService.createDiscussion(
      task.id,
      agentIds,
      `开始讨论任务: ${task.title}\n${task.description}`
    );

    // 等待讨论完成（这里简化处理，实际可能需要更复杂的超时和结束条件）
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.discussionService.concludeDiscussion(
          discussion.id,
          '讨论时间结束，请基于讨论结果完成任务'
        ).then(() => {
          // 选择一个agent来总结和完成任务
          const primaryAgent = agents[0];
          this.agentClientService.executeTask(primaryAgent.id, task, {
            teamContext: { discussionId: discussion.id, mode: 'discussion' }
          }).then(result => {
            this.updateTask(task.id, {
              result,
              status: 'completed',
              completedAt: new Date(),
            }).then(() => {
              resolve({
                success: true,
                result,
                discussion
              });
            });
          });
        });
      }, 60000); // 60秒讨论时间

      // 可以添加提前结束的条件
      this.discussionService.subscribeToEvents(discussion.id, (event) => {
        if (event.type === 'conclusion') {
          clearTimeout(timeout);
          // 处理讨论结束逻辑
        }
      });
    });
  }

  private async executePipelineMode(task: Task, agents: Agent[]): Promise<CollaborationResult> {
    let currentResult = '';
    const results: string[] = [];

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      
      // 传递前一个agent的结果
      const contextMessages: ChatMessage[] = [
        ...task.messages,
        ...(i > 0 ? [{
          role: 'system' as const,
          content: `前一个Agent的处理结果:\n${results[i-1]}`,
          timestamp: new Date(),
        }] : [])
      ];

      const updatedTask = { ...task, messages: contextMessages };
      
      const result = await this.agentClientService.executeTask(agent.id, updatedTask, {
        teamContext: { 
          mode: 'pipeline',
          step: i + 1,
          totalSteps: agents.length,
          previousResult: i > 0 ? results[i-1] : ''
        }
      });

      results.push(result);
      currentResult = result;
    }

    await this.updateTask(task.id, {
      result: currentResult,
      status: 'completed',
      completedAt: new Date(),
    });

    return {
      success: true,
      result: currentResult
    };
  }

  private async executeParallelMode(task: Task, agents: Agent[]): Promise<CollaborationResult> {
    const promises = agents.map(async (agent, index) => {
      return this.agentClientService.executeTask(agent.id, task, {
        teamContext: { 
          mode: 'parallel',
          agentIndex: index,
          totalAgents: agents.length
        }
      });
    });

    const results = await Promise.allSettled(promises);
    const successfulResults = results
      .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
      .map(result => result.value);

    if (successfulResults.length === 0) {
      return { 
        success: false, 
        errors: results.map(r => r.status === 'rejected' ? r.reason : 'Unknown error') 
      };
    }

    // 合并结果
    const combinedResult = this.mergeResults(successfulResults);
    
    await this.updateTask(task.id, {
      result: combinedResult,
      status: 'completed',
      completedAt: new Date(),
    });

    return {
      success: true,
      result: combinedResult
    };
  }

  private async executeHierarchicalMode(task: Task, agents: Agent[]): Promise<CollaborationResult> {
    // 第一个agent作为主管，其他作为执行者
    const supervisor = agents[0];
    const workers = agents.slice(1);

    // 主管制定计划
    const plan = await this.agentClientService.executeTask(supervisor.id, task, {
      teamContext: { 
        mode: 'hierarchical',
        role: 'supervisor',
        workerCount: workers.length
      }
    });

    // 并行执行子任务
    const workerPromises = workers.map(async (worker, index) => {
      const subTask = {
        ...task,
        id: uuidv4(),
        title: `${task.title} - 子任务${index + 1}`,
        description: `根据主管计划执行: ${plan}`,
      };

      return this.agentClientService.executeTask(worker.id, subTask, {
        teamContext: { 
          mode: 'hierarchical',
          role: 'worker',
          plan,
          subTaskIndex: index
        }
      });
    });

    const workerResults = await Promise.allSettled(workerPromises);
    const successfulWorkerResults = workerResults
      .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
      .map(result => result.value);

    // 主管汇总结果
    const summaryContext: ChatMessage[] = [
      ...task.messages,
      {
        role: 'system' as const,
        content: `你的执行团队完成了任务，以下是他们的结果:\n${successfulWorkerResults.join('\n\n')}`,
        timestamp: new Date(),
      }
    ];

    const finalResult = await this.agentClientService.executeTask(supervisor.id, {
      ...task,
      messages: summaryContext
    }, {
      teamContext: { 
        mode: 'hierarchical',
        role: 'supervisor_summary',
        workerResults: successfulWorkerResults
      }
    });

    await this.updateTask(task.id, {
      result: finalResult,
      status: 'completed',
      completedAt: new Date(),
    });

    return {
      success: true,
      result: finalResult
    };
  }

  private mergeResults(results: string[]): string {
    if (results.length === 1) return results[0];
    
    // 简单的合并策略
    return results.map((result, index) => 
      `结果 ${index + 1}:\n${result}`
    ).join('\n\n');
  }
}
