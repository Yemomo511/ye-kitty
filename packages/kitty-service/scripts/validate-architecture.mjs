import { CURRENT_LEGACY_BUDGETS, findArchitectureViolations } from './architecture-rules.mjs';

const packageRoot = new URL('..', import.meta.url).pathname;
const violations = await findArchitectureViolations(packageRoot, {
  legacyBudgets: CURRENT_LEGACY_BUDGETS,
});

if (violations.length > 0) {
  console.error('❌ [Architecture-Validate] 三层架构校验失败');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  '✅ [Architecture-Validate] 三层架构边界有效，旧结构未超过迁移债务额度 ' +
    `services=${CURRENT_LEGACY_BUDGETS.topLevelFiles.services} ` +
    `forbiddenNames=${CURRENT_LEGACY_BUDGETS.forbiddenFileNames}`,
);
