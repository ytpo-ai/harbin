"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentsAppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mongoose_1 = require("@nestjs/mongoose");
const agent_module_1 = require("../../../src/modules/agents/agent.module");
const task_module_1 = require("../../../src/modules/tasks/task.module");
const model_module_1 = require("../../../src/modules/models/model.module");
const api_keys_module_1 = require("../../../src/modules/api-keys/api-keys.module");
const chat_module_1 = require("../../../src/modules/chat/chat.module");
const employee_module_1 = require("../../../src/modules/employees/employee.module");
const meeting_module_1 = require("../../../src/modules/meetings/meeting.module");
const app_config_1 = require("../../../src/config/app.config");
const database_config_1 = require("../../../src/config/database.config");
const ai_config_1 = require("../../../src/config/ai.config");
const jwt_config_1 = require("../../../src/config/jwt.config");
const infra_1 = require("@libs/infra");
const internal_context_middleware_1 = require("./security/internal-context.middleware");
const stream_controller_1 = require("./controllers/stream.controller");
const health_controller_1 = require("./controllers/health.controller");
let AgentsAppModule = class AgentsAppModule {
    configure(consumer) {
        consumer.apply(internal_context_middleware_1.InternalContextMiddleware).forRoutes('*');
    }
};
exports.AgentsAppModule = AgentsAppModule;
exports.AgentsAppModule = AgentsAppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: '.env',
                load: [app_config_1.default, database_config_1.default, ai_config_1.default, jwt_config_1.default],
            }),
            mongoose_1.MongooseModule.forRootAsync({
                imports: [config_1.ConfigModule],
                useFactory: async (configService) => {
                    const dbConfig = configService.get('database');
                    return {
                        uri: dbConfig.uri,
                        ...dbConfig.options,
                    };
                },
                inject: [config_1.ConfigService],
            }),
            infra_1.InfraModule,
            model_module_1.ModelModule,
            api_keys_module_1.ApiKeysModule,
            agent_module_1.AgentModule,
            employee_module_1.EmployeeModule,
            chat_module_1.ChatModule,
            meeting_module_1.MeetingModule,
            task_module_1.TaskModule,
        ],
        controllers: [health_controller_1.HealthController, stream_controller_1.AgentStreamController],
    })
], AgentsAppModule);
//# sourceMappingURL=app.module.js.map