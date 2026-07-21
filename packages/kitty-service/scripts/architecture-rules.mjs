import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

const TARGET_ROOT_DIRECTORIES = new Set(['agent-runtime', 'bootstrap', 'platforms', 'shared']);
const TARGET_ROOT_FILES = new Set(['ARCHITECTURE.md', 'index.ts']);
const LEGACY_ROOT_DIRECTORIES = new Set(['contracts', 'control-plane', 'services']);
const FORBIDDEN_DIRECTORIES = new Set(['application', 'domain', 'infrastructure', 'ports']);
const ARCHITECTURE_SUFFIX_PATTERN = /\.(?:adapter|contract|controller|factory|port|service)\./i;
const IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

/**
 * 架构迁移债务额度
 *
 * 额度只允许随迁移下降，确保旧结构可以分提交删除，
 * 同时阻止新代码继续进入待废弃目录和命名体系。
 */
export const CURRENT_LEGACY_BUDGETS = Object.freeze({
  topLevelFiles: Object.freeze({ contracts: 3, 'control-plane': 0, services: 81 }),
  forbiddenDirectories: Object.freeze({
    application: 30,
    domain: 15,
    infrastructure: 22,
    ports: 20,
  }),
  forbiddenFileNames: 57,
});

/**
 * 检查 Kitty Service 三层架构
 * @param {string} packageRoot kitty-service 包目录
 * @param {{ legacyBudgets?: typeof CURRENT_LEGACY_BUDGETS }} [options] 迁移债务额度
 * @returns {Promise<string[]>} 可直接展示的违规列表
 */
export async function findArchitectureViolations(packageRoot, options = {}) {
  const sourceRoot = resolve(packageRoot, 'src');
  const entries = await collectEntries(sourceRoot);
  const files = entries.filter((entry) => entry.kind === 'file');
  const directories = entries.filter((entry) => entry.kind === 'directory');
  const legacyBudgets = options.legacyBudgets;
  const violations = [];

  validateRootEntries(files, directories, legacyBudgets, violations);
  validateForbiddenDirectories(files, directories, legacyBudgets, violations);
  validateFileNames(files, legacyBudgets, violations);
  await validateDependencies(sourceRoot, files, violations);

  return violations.toSorted();
}

// 收集目录和文件，统一使用 POSIX 风格相对路径。
async function collectEntries(sourceRoot) {
  const entries = [];

  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      children.map(async (child) => {
        const absolutePath = resolve(directory, child.name);
        const path = toSourcePath(sourceRoot, absolutePath);
        if (child.isDirectory()) {
          entries.push({ kind: 'directory', path, absolutePath });
          await visit(absolutePath);
          return;
        }
        if (child.isFile()) entries.push({ kind: 'file', path, absolutePath });
      }),
    );
  }

  await visit(sourceRoot);
  return entries;
}

// 校验 src 顶层只出现目标模块或登记中的旧模块。
function validateRootEntries(files, directories, legacyBudgets, violations) {
  const rootDirectories = directories.filter((entry) => !entry.path.slice(4).includes('/'));
  const rootFiles = files.filter((entry) => !entry.path.slice(4).includes('/'));

  for (const entry of rootFiles) {
    const name = entry.path.slice(4);
    if (!TARGET_ROOT_FILES.has(name)) violations.push(`禁止顶层文件: ${entry.path}`);
  }

  for (const entry of rootDirectories) {
    const name = entry.path.slice(4);
    if (TARGET_ROOT_DIRECTORIES.has(name)) continue;
    if (!legacyBudgets || !LEGACY_ROOT_DIRECTORIES.has(name)) {
      violations.push(`禁止顶层目录: ${entry.path}`);
    }
  }

  if (!legacyBudgets) return;
  for (const [name, budget] of Object.entries(legacyBudgets.topLevelFiles ?? {})) {
    const current = files.filter((entry) => entry.path.startsWith(`src/${name}/`)).length;
    if (current > budget) violations.push(`旧顶层目录超额: ${name} 当前=${current} 额度=${budget}`);
  }
}

// 严格模式禁止四层目录，迁移模式则限制其中的存量文件数。
function validateForbiddenDirectories(files, directories, legacyBudgets, violations) {
  for (const name of FORBIDDEN_DIRECTORIES) {
    const matchingDirectories = directories.filter((entry) => entry.path.split('/').includes(name));
    if (!legacyBudgets) {
      for (const entry of matchingDirectories) violations.push(`禁止架构目录: ${entry.path}`);
      continue;
    }

    const currentFiles = new Set(
      matchingDirectories.flatMap((directory) =>
        files.filter((file) => file.path.startsWith(`${directory.path}/`)).map((file) => file.path),
      ),
    ).size;
    const budget = legacyBudgets.forbiddenDirectories?.[name] ?? 0;
    if (currentFiles > budget) {
      violations.push(`旧架构目录超额: ${name} 当前=${currentFiles} 额度=${budget}`);
    }
  }
}

// 校验文件名不重复目录上下文，也不携带旧架构角色。
function validateFileNames(files, legacyBudgets, violations) {
  const invalidFiles = files.filter((entry) => isForbiddenFileName(entry.path));
  if (!legacyBudgets) {
    for (const entry of invalidFiles) violations.push(`禁止文件命名: ${entry.path}`);
    return;
  }

  const budget = legacyBudgets.forbiddenFileNames ?? 0;
  if (invalidFiles.length > budget) {
    violations.push(`旧文件命名超额: 当前=${invalidFiles.length} 额度=${budget}`);
  }
}

// 读取静态导入和动态导入，检查三层依赖方向。
async function validateDependencies(sourceRoot, files, violations) {
  const sourceFiles = files.filter((entry) => /\.(?:mjs|ts)$/.test(entry.path));
  await Promise.all(
    sourceFiles.map(async (file) => {
      const owner = readOwner(file.path);
      if (!owner || owner === 'bootstrap') return;
      const content = await readFile(file.absolutePath, 'utf8');
      const dependencies = readDependencies(sourceRoot, file.absolutePath, content);
      for (const dependency of dependencies) {
        if (!isAllowedDependency(owner, dependency)) {
          violations.push(`非法依赖: ${file.path} -> ${dependency}`);
        }
      }
    }),
  );
}

// 判断文件名是否仍携带已由目录表达的上下文。
function isForbiddenFileName(path) {
  const name = path.split('/').at(-1) ?? '';
  const lowerName = name.toLowerCase();
  if (lowerName.includes('harness')) return true;
  if (ARCHITECTURE_SUFFIX_PATTERN.test(lowerName)) return true;
  if (path.includes('/platforms/qq/') && lowerName.startsWith('qq-')) return true;
  if (path.includes('/platforms/xiaohongshu/') && lowerName.startsWith('xiaohongshu-')) return true;
  if (path.includes('/onebot/') && lowerName.startsWith('onebot-')) return true;
  return path.includes('/lm/code-agent/') && lowerName.startsWith('code-agent-');
}

// 将 import specifier 解析为目标顶层模块。
function readDependencies(sourceRoot, sourceFile, content) {
  const dependencies = new Set();
  for (const match of content.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1];
    if (specifier.startsWith('@kitty/')) {
      const owner = specifier.slice('@kitty/'.length).split('/')[0];
      dependencies.add(owner);
      continue;
    }
    if (!specifier.startsWith('.')) continue;
    const target = resolve(dirname(sourceFile), specifier);
    const relativeTarget = relative(sourceRoot, target);
    if (relativeTarget.startsWith('..')) continue;
    dependencies.add(relativeTarget.split(sep)[0]);
  }
  return dependencies;
}

// 返回目标架构中的文件 owner，旧目录留给债务额度管理。
function readOwner(path) {
  const owner = path.split('/')[1];
  return TARGET_ROOT_DIRECTORIES.has(owner) ? owner : undefined;
}

// 上层只能依赖自身或更低层，Bootstrap 不能被业务模块依赖。
function isAllowedDependency(owner, dependency) {
  if (!TARGET_ROOT_DIRECTORIES.has(dependency)) return true;
  if (owner === 'shared') return dependency === 'shared';
  if (owner === 'platforms') return dependency === 'platforms' || dependency === 'shared';
  if (owner === 'agent-runtime') {
    return dependency === 'agent-runtime' || dependency === 'platforms' || dependency === 'shared';
  }
  return true;
}

// 输出以 src 开头的稳定路径，避免平台路径分隔符差异。
function toSourcePath(sourceRoot, absolutePath) {
  const relativePath = relative(sourceRoot, absolutePath).split(sep).join('/');
  return `src/${relativePath}`;
}
