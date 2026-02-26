"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServiceLogger = createServiceLogger;
const common_1 = require("@nestjs/common");
function createServiceLogger(scope) {
    return new common_1.Logger(scope);
}
//# sourceMappingURL=logger.util.js.map