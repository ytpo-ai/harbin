"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
const infra_1 = require("@libs/infra");
const model_service_1 = require("../../../src/modules/models/model.service");
async function bootstrap() {
    await (0, infra_1.initializeNetworkProxy)();
    const app = await core_1.NestFactory.create(app_module_1.AgentsAppModule);
    app.useGlobalPipes(new common_1.ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
    }));
    app.setGlobalPrefix('api');
    const modelService = app.get(model_service_1.ModelService);
    modelService.initializeDefaultModels();
    const port = Number(process.env.AGENTS_PORT || 3002);
    await app.listen(port);
    console.log(`Agents service running on http://localhost:${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map