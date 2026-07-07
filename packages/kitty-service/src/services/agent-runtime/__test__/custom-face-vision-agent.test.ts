import { describe, expect, test } from 'vitest';
import {
  loadCustomFaceVisionAgentConfig,
  parseCustomFaceDescription,
  parseCustomFaceSelections,
} from '../infrastructure/openai-custom-face-vision.agent';

describe('parseCustomFaceDescription', () => {
  test('解析视觉Agent严格JSON输出', () => {
    expect(
      parseCustomFaceDescription(`
        {
          "content": "一只猫猫震惊地看着屏幕",
          "emotion": "震惊",
          "suitableScenes": ["吐槽离谱发言", "表达惊讶"],
          "avoidScenes": ["严肃通知"],
          "tags": ["猫", "震惊"],
          "confidence": 0.92
        }
      `),
    ).toEqual({
      content: '一只猫猫震惊地看着屏幕',
      emotion: '震惊',
      suitableScenes: ['吐槽离谱发言', '表达惊讶'],
      avoidScenes: ['严肃通知'],
      tags: ['猫', '震惊'],
      confidence: 0.92,
    });
  });

  test('拒绝缺少关键字段的视觉输出', () => {
    expect(() =>
      parseCustomFaceDescription('{"content":"猫猫","emotion":"震惊","tags":["猫"]}'),
    ).toThrow('视觉Agent描述字段不完整');
  });

  test('视觉Agent超时时间为空时使用默认值', () => {
    expect(
      loadCustomFaceVisionAgentConfig({
        YE_KITTY_VISION_AGENT_MODEL: 'gpt-4.1-mini',
        YE_KITTY_VISION_AGENT_API_KEY: 'sk-test',
        YE_KITTY_VISION_AGENT_TIMEOUT_MS: '',
      }),
    ).toMatchObject({
      model: 'gpt-4.1-mini',
      timeoutMs: 30000,
    });
  });
});

describe('parseCustomFaceSelections', () => {
  test('解析视觉Agent表情推荐输出', () => {
    expect(
      parseCustomFaceSelections(
        `
        {
          "selections": [
            {
              "id": "face-1",
              "reason": "适合表达震惊和吐槽",
              "score": 0.93
            }
          ]
        }
      `,
        5,
      ),
    ).toEqual([
      {
        id: 'face-1',
        reason: '适合表达震惊和吐槽',
        score: 0.93,
      },
    ]);
  });

  test('忽略缺少关键字段的推荐项', () => {
    expect(
      parseCustomFaceSelections(
        '{"selections":[{"id":"face-1"},{"id":"face-2","reason":"适合","score":2}]}',
        5,
      ),
    ).toEqual([
      {
        id: 'face-2',
        reason: '适合',
        score: 1,
      },
    ]);
  });
});
