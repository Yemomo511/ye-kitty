import { describe, expect, test } from 'vitest';
import { parseCustomFaceDescription } from '../infrastructure/openai-custom-face-vision.agent';

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
});
