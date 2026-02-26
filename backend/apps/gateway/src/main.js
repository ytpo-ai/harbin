"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.GatewayAppModule);
    app.enableCors({
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true,
    });
    const port = Number(process.env.GATEWAY_PORT || 3100);
    await app.listen(port);
    console.log(`Gateway service running on http://localhost:${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map