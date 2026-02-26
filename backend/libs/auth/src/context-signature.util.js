"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeUserContext = encodeUserContext;
exports.decodeUserContext = decodeUserContext;
exports.signEncodedContext = signEncodedContext;
exports.verifyEncodedContext = verifyEncodedContext;
const crypto = require("crypto");
function encodeUserContext(context) {
    return Buffer.from(JSON.stringify(context)).toString('base64url');
}
function decodeUserContext(encoded) {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString());
}
function signEncodedContext(encoded, secret) {
    return crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
}
function verifyEncodedContext(encoded, signature, secret) {
    const expected = signEncodedContext(encoded, secret);
    return expected === signature;
}
//# sourceMappingURL=context-signature.util.js.map