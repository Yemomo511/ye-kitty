import { afterEach, describe, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findArchitectureViolations } from '../../scripts/architecture-rules.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('三层架构规则', () => {
  test('接受 Platform、Agent Runtime、Shared 和 Bootstrap 目标目录', async () => {
    const root = await createPackageFixture({
      'src/index.ts': "export * from './agent-runtime/index';\n",
      'src/ARCHITECTURE.md': '# 架构\n',
      'src/shared/index.ts': "export * from './ids';\n",
      'src/shared/ids.ts': 'export type Id = string;\n',
      'src/platforms/index.ts': "export * from './message';\n",
      'src/platforms/message.ts':
        "import type { Id } from '../shared/ids';\nexport interface Message { id: Id }\n",
      'src/agent-runtime/index.ts': "export * from './agent';\n",
      'src/agent-runtime/agent.ts':
        "import type { Message } from '../platforms/message';\nexport type AgentInput = Message;\n",
      'src/bootstrap/start.ts': "import '../agent-runtime/agent';\n",
    });

    await expect(findArchitectureViolations(root)).resolves.toEqual([]);
  });

  test.each(['application', 'domain', 'infrastructure', 'ports'])(
    '拒绝任意深度的 %s 目录',
    async (folder) => {
      const root = await createPackageFixture({
        'src/index.ts': '',
        'src/ARCHITECTURE.md': '# 架构\n',
        [`src/agent-runtime/${folder}/agent.ts`]: 'export const agent = true;\n',
        'src/platforms/index.ts': '',
        'src/shared/index.ts': '',
        'src/bootstrap/start.ts': '',
      });

      const violations = await findArchitectureViolations(root);

      expect(violations).toContain(`禁止架构目录: src/agent-runtime/${folder}`);
    },
  );

  test('拒绝 Platform 和 Shared 反向依赖 Agent Runtime', async () => {
    const root = await createPackageFixture({
      'src/index.ts': '',
      'src/ARCHITECTURE.md': '# 架构\n',
      'src/agent-runtime/index.ts': '',
      'src/platforms/index.ts': "import '../agent-runtime/index';\n",
      'src/shared/index.ts': "export * from '@kitty/agent-runtime';\n",
      'src/bootstrap/start.ts': '',
    });

    const violations = await findArchitectureViolations(root);

    expect(violations).toContain('非法依赖: src/platforms/index.ts -> agent-runtime');
    expect(violations).toContain('非法依赖: src/shared/index.ts -> agent-runtime');
  });

  test('拒绝业务模块依赖 Bootstrap', async () => {
    const root = await createPackageFixture({
      'src/index.ts': '',
      'src/ARCHITECTURE.md': '# 架构\n',
      'src/agent-runtime/index.ts': "import '../bootstrap/start';\n",
      'src/platforms/index.ts': '',
      'src/shared/index.ts': '',
      'src/bootstrap/start.ts': '',
    });

    const violations = await findArchitectureViolations(root);

    expect(violations).toContain('非法依赖: src/agent-runtime/index.ts -> bootstrap');
  });

  test.each([
    'src/agent-runtime/agent-runtime-harness.ts',
    'src/agent-runtime/agent.service.ts',
    'src/platforms/qq/qq-message.ts',
    'src/agent-runtime/lm/code-agent/code-agent-session.ts',
  ])('拒绝包含冗余上下文的文件名 %s', async (file) => {
    const root = await createPackageFixture({
      'src/index.ts': '',
      'src/ARCHITECTURE.md': '# 架构\n',
      [file]: 'export const value = true;\n',
      'src/platforms/index.ts': '',
      'src/shared/index.ts': '',
      'src/bootstrap/start.ts': '',
    });

    const violations = await findArchitectureViolations(root);

    expect(violations.some((violation) => violation.startsWith('禁止文件命名:'))).toBe(true);
  });

  test('迁移债务只允许减少，禁止超过登记额度', async () => {
    const root = await createPackageFixture({
      'src/index.ts': '',
      'src/ARCHITECTURE.md': '# 架构\n',
      'src/services/agent/application/agent.ts': 'export const agent = true;\n',
      'src/services/agent/application/extra.ts': 'export const extra = true;\n',
      'src/platforms/index.ts': '',
      'src/shared/index.ts': '',
      'src/bootstrap/start.ts': '',
    });

    const violations = await findArchitectureViolations(root, {
      legacyBudgets: {
        topLevelFiles: { services: 1 },
        forbiddenDirectories: { application: 1 },
        forbiddenFileNames: 0,
      },
    });

    expect(violations).toContain('旧顶层目录超额: services 当前=2 额度=1');
    expect(violations).not.toContain('禁止架构目录: src/services/agent/application');
  });
});

async function createPackageFixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kitty-architecture-'));
  temporaryDirectories.push(root);

  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      const target = join(root, file);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, content, 'utf8');
    }),
  );

  return root;
}
