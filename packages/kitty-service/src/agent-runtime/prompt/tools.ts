import type { RuntimeTool } from '../../services/agent-runtime/domain/tool';

/**
 * 构建Tool Prompt
 * @param tools 可见工具
 * @returns 第二章节中的Tool部分
 */
export function buildToolPrompt(tools: readonly RuntimeTool[]): string {
  if (tools.length === 0) return '## 2.2 Tool Prompt\n本轮没有可用工具。';

  return [
    '## 2.2 Tool Prompt',
    'Tool 是 Agent Runtime 暴露的外界信息和受控操作入口。下面只描述可见工具，不授予额外权限。',
    ...tools.map((tool, index) =>
      [
        `### 2.2.${index + 1} ${tool.name}`,
        `说明：${tool.description}`,
        `风险等级：${tool.riskLevel}`,
        `输入：${tool.inputSchemaDescription}`,
      ].join('\n'),
    ),
  ].join('\n\n');
}
