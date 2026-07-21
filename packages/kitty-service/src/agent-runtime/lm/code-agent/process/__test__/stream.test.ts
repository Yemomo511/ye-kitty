/**
 * Task 3 测试 — json-line-stream
 * 4 cases: T3-1/2/3/5（单行/多行/跨 chunk/非 JSON onRawLine）
 */
import { describe, it, expect } from 'vitest';
import { createJsonLineStream } from '@kitty/agent-runtime/lm/code-agent/process/stream';

describe('createJsonLineStream', () => {
  it('T3-1: 单行完整 JSON → onMessage 一次', () => {
    const msgs: unknown[] = [];
    const stream = createJsonLineStream((parsed) => msgs.push(parsed));
    stream.feed('{"a":1}\n');
    stream.flush();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ a: 1 });
  });

  it('T3-2: 多行 JSON → onMessage 多次、顺序保持', () => {
    const msgs: unknown[] = [];
    const stream = createJsonLineStream((parsed) => msgs.push(parsed));
    stream.feed('{"a":1}\n{"b":2}\n');
    stream.flush();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ a: 1 });
    expect(msgs[1]).toEqual({ b: 2 });
  });

  it('T3-3: 一条 JSON 跨两个 chunk → 还原后 onMessage 一次', () => {
    const msgs: unknown[] = [];
    const stream = createJsonLineStream((parsed) => msgs.push(parsed));
    stream.feed('{"hel');
    stream.feed('lo": "world"}\n');
    stream.flush();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ hello: 'world' });
  });

  it('T3-5: 非 JSON 行 → onRawLine 回调', () => {
    const raw: string[] = [];
    const stream = createJsonLineStream(
      () => {},
      (line) => raw.push(line),
    );
    stream.feed('not json\n');
    stream.flush();
    expect(raw).toHaveLength(1);
    expect(raw[0]).toBe('not json');
  });

  it('T3-4: pretty-printed 多行 JSON（单行完整）→ 正确解析', () => {
    const msgs: unknown[] = [];
    const stream = createJsonLineStream((parsed) => msgs.push(parsed));
    stream.feed('{"a":1,"b":2}\n');
    stream.flush();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ a: 1, b: 2 });
  });

  it('T3-6: 半截 JSON 后 flush → 残留内容走 onRawLine', () => {
    const raw: string[] = [];
    const stream = createJsonLineStream(
      () => {},
      (line) => raw.push(line),
    );
    stream.feed('{"incomplete":');
    stream.flush();
    expect(raw.length).toBe(1);
    expect(raw[0]).toBe('{"incomplete":');
  });

  it('T3-8: 空 chunk / 仅换行符 → 无回调', () => {
    const msgs: unknown[] = [];
    const stream = createJsonLineStream((parsed) => msgs.push(parsed));
    stream.feed('\n\n\n');
    stream.flush();
    expect(msgs).toHaveLength(0);
  });
});
