"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyEmployeeToken = verifyEmployeeToken;
const crypto = require("crypto");
function verifyEmployeeToken(token, secret) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3)
            return null;
        const [header, payload, signature] = parts;
        const expectedSig = crypto
            .createHmac('sha256', secret)
            .update(`${header}.${payload}`)
            .digest('base64url');
        if (signature !== expectedSig)
            return null;
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (!parsed.exp || parsed.exp < Date.now())
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=token.util.js.map