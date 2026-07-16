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

  test('允许显式选择上游镜像以适配ARM64或固定版本', () => {
    const deployRoot = findNearestDirectory(process.cwd(), 'deploy');
    if (!deployRoot) throw new Error('未找到项目deploy目录');
    const compose = readFileSync(join(deployRoot, 'xiaohongshu', 'compose.yml'), 'utf8');

    expect(compose).toContain('YE_KITTY_XIAOHONGSHU_MCP_IMAGE:-xpzouying/xiaohongshu-mcp');
  });
});
