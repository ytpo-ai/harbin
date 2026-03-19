import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { AgentsAppModule } from '../apps/agents/src/app.module';
import { Agent, AgentDocument } from '../src/shared/schemas/agent.schema';
import { Employee, EmployeeDocument } from '../src/shared/schemas/employee.schema';
import { AgentRole, AgentRoleDocument } from '../src/shared/schemas/agent-role.schema';
import { getTierByAgentRoleCode, getTierByEmployeeRole } from '../src/shared/role-tier';

type TierMigrationIssue = {
  scope: 'role' | 'agent' | 'employee';
  id: string;
  reason: string;
};

async function run(): Promise<void> {
  const legacyApp = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const agentsApp = await NestFactory.createApplicationContext(AgentsAppModule, { logger: ['error', 'warn'] });

  try {
    const roleModel = legacyApp.get<Model<AgentRoleDocument>>(getModelToken(AgentRole.name));
    const employeeModel = legacyApp.get<Model<EmployeeDocument>>(getModelToken(Employee.name));
    const agentModel = agentsApp.get<Model<AgentDocument>>(getModelToken(Agent.name));

    const issues: TierMigrationIssue[] = [];
    const stats = {
      roles: { scanned: 0, updated: 0 },
      agents: { scanned: 0, updated: 0 },
      employees: { scanned: 0, updated: 0 },
    };

    const roles = await roleModel.find().exec();
    stats.roles.scanned = roles.length;
    const roleTierById = new Map<string, string>();

    for (const role of roles) {
      const expectedTier = getTierByAgentRoleCode(role.code);
      roleTierById.set(String(role.id || '').trim(), role.tier || expectedTier);

      if (role.tier !== expectedTier) {
        role.tier = expectedTier;
        await role.save();
        stats.roles.updated += 1;
      }
    }

    const agents = await agentModel.find().select({ _id: 1, id: 1, roleId: 1, tier: 1 }).exec();
    stats.agents.scanned = agents.length;
    for (const agent of agents) {
      const roleId = String(agent.roleId || '').trim();
      if (!roleId) {
        issues.push({
          scope: 'agent',
          id: String(agent.id || agent._id || ''),
          reason: 'missing roleId',
        });
        continue;
      }

      const expectedTier = roleTierById.get(roleId) || 'operations';
      if (agent.tier !== expectedTier) {
        agent.tier = expectedTier as any;
        await agent.save();
        stats.agents.updated += 1;
      }
      if (!roleTierById.has(roleId)) {
        issues.push({
          scope: 'agent',
          id: String(agent.id || agent._id || ''),
          reason: `role not found: ${roleId}`,
        });
      }
    }

    const employees = await employeeModel.find().select({ _id: 1, id: 1, role: 1, tier: 1 }).exec();
    stats.employees.scanned = employees.length;
    for (const employee of employees) {
      const expectedTier = getTierByEmployeeRole(employee.role);
      if (employee.tier !== expectedTier) {
        employee.tier = expectedTier as any;
        await employee.save();
        stats.employees.updated += 1;
      }
    }

    console.log(
      JSON.stringify(
        {
          stats,
          issues,
        },
        null,
        2,
      ),
    );
  } finally {
    await agentsApp.close();
    await legacyApp.close();
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[tier-migration] failed: ${message}`);
  process.exit(1);
});
