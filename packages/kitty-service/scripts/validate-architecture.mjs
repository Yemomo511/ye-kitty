import { findArchitectureViolations } from './architecture-rules.mjs';

const packageRoot = new URL('..', import.meta.url).pathname;
const violations = await findArchitectureViolations(packageRoot);

if (violations.length > 0) {
  console.error('❌ [Architecture-Validate] 三层架构校验失败');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('✅ [Architecture-Validate] 三层架构边界有效，旧目录与旧命名残留均为零');
