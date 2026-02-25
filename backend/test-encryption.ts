/**
 * 加密工具测试脚本
 * 运行: npx ts-node test-encryption.ts
 */
import { EncryptionUtil } from '../src/shared/utils/encryption.util';

// 设置测试密钥
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-long!!';

console.log('=== AES-256-GCM 加密测试 ===\n');

// 测试1: 基本加密解密
console.log('测试1: 基本加密解密');
const originalText = 'sk-abcdefghijklmnopqrstuvwxyz123456789';
console.log('原文:', originalText);

const encrypted = EncryptionUtil.encrypt(originalText);
console.log('加密后:', encrypted);
console.log('加密长度:', encrypted.length);

const decrypted = EncryptionUtil.decrypt(encrypted);
console.log('解密后:', decrypted);
console.log('匹配:', originalText === decrypted ? '✓ PASS' : '✗ FAIL');
console.log();

// 测试2: 不同文本加密
console.log('测试2: 不同文本加密');
const testCases = [
  'sk-test123',
  'sk-prod-456789abcdef',
  'another-api-key-with-special-chars-!@#$%',
  'a',  // 最短测试
  'x'.repeat(1000),  // 长文本测试
];

testCases.forEach((text, index) => {
  try {
    const enc = EncryptionUtil.encrypt(text);
    const dec = EncryptionUtil.decrypt(enc);
    const pass = text === dec;
    console.log(`  用例${index + 1} (${text.length}字符):`, pass ? '✓ PASS' : '✗ FAIL');
    if (!pass) {
      console.log('    原文长度:', text.length, '解密后长度:', dec.length);
    }
  } catch (error) {
    console.log(`  用例${index + 1}: ✗ ERROR -`, error.message);
  }
});
console.log();

// 测试3: 相同文本不同加密结果（IV随机性）
console.log('测试3: IV随机性（相同文本应产生不同密文）');
const text = 'same-text-for-randomness-test';
const encrypted1 = EncryptionUtil.encrypt(text);
const encrypted2 = EncryptionUtil.encrypt(text);
const encrypted3 = EncryptionUtil.encrypt(text);

console.log('加密1:', encrypted1.substring(0, 50) + '...');
console.log('加密2:', encrypted2.substring(0, 50) + '...');
console.log('加密3:', encrypted3.substring(0, 50) + '...');

const allDifferent = encrypted1 !== encrypted2 && encrypted2 !== encrypted3 && encrypted1 !== encrypted3;
console.log('都不同:', allDifferent ? '✓ PASS' : '✗ FAIL');

// 验证都能正确解密
const dec1 = EncryptionUtil.decrypt(encrypted1);
const dec2 = EncryptionUtil.decrypt(encrypted2);
const dec3 = EncryptionUtil.decrypt(encrypted3);
const allCorrect = dec1 === text && dec2 === text && dec3 === text;
console.log('都能解密:', allCorrect ? '✓ PASS' : '✗ FAIL');
console.log();

// 测试4: 错误处理
console.log('测试4: 错误处理');
try {
  // 尝试解密无效格式
  EncryptionUtil.decrypt('invalid-format');
  console.log('  无效格式处理: ✗ FAIL（应抛出错误）');
} catch (error) {
  console.log('  无效格式处理: ✓ PASS（正确抛出错误）');
}

try {
  // 尝试解密被篡改的数据
  const tampered = encrypted.replace(/.$/, 'x'); // 修改最后一个字符
  EncryptionUtil.decrypt(tampered);
  console.log('  篡改数据处理: ✗ FAIL（应抛出错误）');
} catch (error) {
  console.log('  篡改数据处理: ✓ PASS（正确抛出错误）');
}
console.log();

// 测试5: 性能测试
console.log('测试5: 性能测试');
const iterations = 1000;
const start = Date.now();

for (let i = 0; i < iterations; i++) {
  const test = `test-key-${i}-with-some-length-to-simulate-real-api-key`;
  const enc = EncryptionUtil.encrypt(test);
  const dec = EncryptionUtil.decrypt(enc);
}

const duration = Date.now() - start;
console.log(`${iterations}次加密+解密耗时: ${duration}ms`);
console.log(`平均每次: ${(duration / iterations).toFixed(3)}ms`);
console.log();

console.log('=== 测试完成 ===');
