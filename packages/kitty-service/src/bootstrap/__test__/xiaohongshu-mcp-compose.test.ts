import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { findNearestDirectory } from '../runtime-environment';

describe('小红书MCP Compose安全边界', () => {
  test('默认只监听本机并且不挂载宿主机敏感目录', () => {
    const deployRoot = findNearestDirectory(process.cwd(), 'deploy');
    if (!deployRoot) throw new Error('未找到项目deploy目录');
    const compose = readFileSync(join(deployRoot, 'xiaohongshu', 'compose.yml'), 'utf8');

    expect(compose).toContain('YE_KITTY_XIAOHONGSHU_MCP_HOST:-127.0.0.1');
    expect(compose).toContain('./data:/app/data');
    expect(compose).toContain('./images:/app/images');
    expect(compose).not.toContain('docker.sock');
    expect(compose).not.toContain('${HOME}');
    expect(compose).toContain('chmod 600 /app/data/cookies.json');
    expect(compose).toContain('umask 077');
  });

  test('补丁镜像与上游基础镜像分离配置', () => {
    const deployRoot = findNearestDirectory(process.cwd(), 'deploy');
    if (!deployRoot) throw new Error('未找到项目deploy目录');
    const compose = readFileSync(join(deployRoot, 'xiaohongshu', 'compose.yml'), 'utf8');

    expect(compose).toContain(
      'YE_KITTY_XIAOHONGSHU_MCP_IMAGE:-ye-kitty/xiaohongshu-mcp-mentions:local',
    );
    expect(compose).toContain(
      'YE_KITTY_XIAOHONGSHU_MCP_BASE_IMAGE:-xpzouying/xiaohongshu-mcp:latest-arm64',
    );
  });

  test('Dockerfile固定上游提交并先验证再应用补丁', () => {
    const deployRoot = findNearestDirectory(process.cwd(), 'deploy');
    if (!deployRoot) throw new Error('未找到项目deploy目录');
    const dockerfile = readFileSync(join(deployRoot, 'xiaohongshu', 'Dockerfile.mentions'), 'utf8');

    expect(dockerfile).toContain('5c5197d6867032130e850f1ae46070004689d6d5');
    expect(dockerfile).toContain('git apply --check /tmp/list-mentions.patch');
    expect(dockerfile).toContain('go test .');
  });
});
