"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const encryption_util_1 = require("../src/shared/utils/encryption.util");
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-long!!';
console.log('=== AES-256-GCM 加密测试 ===\n');
console.log('测试1: 基本加密解密');
const originalText = 'sk-abcdefghijklmnopqrstuvwxyz123456789';
console.log('原文:', originalText);
const encrypted = encryption_util_1.EncryptionUtil.encrypt(originalText);
console.log('加密后:', encrypted);
console.log('加密长度:', encrypted.length);
const decrypted = encryption_util_1.EncryptionUtil.decrypt(encrypted);
console.log('解密后:', decrypted);
console.log('匹配:', originalText === decrypted ? '✓ PASS' : '✗ FAIL');
console.log();
console.log('测试2: 不同文本加密');
const testCases = [
    'sk-test123',
    'sk-prod-456789abcdef',
    'another-api-key-with-special-chars-!@#$%',
    'a',
    'x'.repeat(1000),
];
testCases.forEach((text, index) => {
    try {
        const enc = encryption_util_1.EncryptionUtil.encrypt(text);
        const dec = encryption_util_1.EncryptionUtil.decrypt(enc);
        const pass = text === dec;
        console.log(`  用例${index + 1} (${text.length}字符):`, pass ? '✓ PASS' : '✗ FAIL');
        if (!pass) {
            console.log('    原文长度:', text.length, '解密后长度:', dec.length);
        }
    }
    catch (error) {
        console.log(`  用例${index + 1}: ✗ ERROR -`, error.message);
    }
});
console.log();
console.log('测试3: IV随机性（相同文本应产生不同密文）');
const text = 'same-text-for-randomness-test';
const encrypted1 = encryption_util_1.EncryptionUtil.encrypt(text);
const encrypted2 = encryption_util_1.EncryptionUtil.encrypt(text);
const encrypted3 = encryption_util_1.EncryptionUtil.encrypt(text);
console.log('加密1:', encrypted1.substring(0, 50) + '...');
console.log('加密2:', encrypted2.substring(0, 50) + '...');
console.log('加密3:', encrypted3.substring(0, 50) + '...');
const allDifferent = encrypted1 !== encrypted2 && encrypted2 !== encrypted3 && encrypted1 !== encrypted3;
console.log('都不同:', allDifferent ? '✓ PASS' : '✗ FAIL');
const dec1 = encryption_util_1.EncryptionUtil.decrypt(encrypted1);
const dec2 = encryption_util_1.EncryptionUtil.decrypt(encrypted2);
const dec3 = encryption_util_1.EncryptionUtil.decrypt(encrypted3);
const allCorrect = dec1 === text && dec2 === text && dec3 === text;
console.log('都能解密:', allCorrect ? '✓ PASS' : '✗ FAIL');
console.log();
console.log('测试4: 错误处理');
try {
    encryption_util_1.EncryptionUtil.decrypt('invalid-format');
    console.log('  无效格式处理: ✗ FAIL（应抛出错误）');
}
catch (error) {
    console.log('  无效格式处理: ✓ PASS（正确抛出错误）');
}
try {
    const tampered = encrypted.replace(/.$/, 'x');
    encryption_util_1.EncryptionUtil.decrypt(tampered);
    console.log('  篡改数据处理: ✗ FAIL（应抛出错误）');
}
catch (error) {
    console.log('  篡改数据处理: ✓ PASS（正确抛出错误）');
}
console.log();
console.log('测试5: 性能测试');
const iterations = 1000;
const start = Date.now();
for (let i = 0; i < iterations; i++) {
    const test = `test-key-${i}-with-some-length-to-simulate-real-api-key`;
    const enc = encryption_util_1.EncryptionUtil.encrypt(test);
    const dec = encryption_util_1.EncryptionUtil.decrypt(enc);
}
const duration = Date.now() - start;
console.log(`${iterations}次加密+解密耗时: ${duration}ms`);
console.log(`平均每次: ${(duration / iterations).toFixed(3)}ms`);
console.log();
console.log('=== 测试完成 ===');
//# sourceMappingURL=test-encryption.js.map