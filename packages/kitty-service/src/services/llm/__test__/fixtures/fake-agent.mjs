/**
 * Fake Agent CLI — 测试替身
 * 按 FAKE_AGENT_SCENARIO 环境变量输出预设协议流，无需真实 agent CLI。
 *
 * 场景：
 *   happy-claude：合法 claude-stream-json → exit 0
 *   happy-codex：合法 Codex JSONL → exit 0
 *   crash：两个事件后 exit 1 + stderr
 *   hang：一个事件后静默（测 inactivity 超时）
 *   garbage：乱码/半截 JSON（测 raw 兜底 + protocol_mismatch）
 *   slow-exit：收到 stdin end 后 5s 退出（测 taskkill 阶梯）
 *   busy-loop：持续输出 text_delta（测 session 总时长看门狗）
 */

const scenario = process.env['FAKE_AGENT_SCENARIO'] ?? 'happy-claude';

function output(line) {
  process.stdout.write(`${line}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  switch (scenario) {
    case 'happy-claude':
      output(JSON.stringify({ type: 'system', subtype: 'init' }));
      output(JSON.stringify({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-20250514', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } }));
      output(JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
      output(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello from fake Claude!' } }));
      output(JSON.stringify({ type: 'content_block_stop', index: 0 }));
      output(JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 10, output_tokens: 5 } }));
      output(JSON.stringify({ type: 'message_stop' }));
      break;

    case 'happy-codex':
      output(JSON.stringify({ type: 'thread.started', thread_id: 'thread_fake_1' }));
      output(JSON.stringify({ type: 'turn.started' }));
      output(JSON.stringify({ type: 'item.started', item: { id: 'item_1', type: 'agent_message' } }));
      output(JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', status: 'completed', content: [{ type: 'output_text', text: 'Hello from fake Codex!' }] } }));
      output(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }));
      output(JSON.stringify({ type: 'thread.completed' }));
      break;

    case 'crash':
      output(JSON.stringify({ type: 'message_start' }));
      output(JSON.stringify({ type: 'text_delta', text: 'partial...' }));
      process.stderr.write('Error: invalid api key\n');
      process.exit(1);
      break;

    case 'hang':
      output(JSON.stringify({ type: 'message_start' }));
      // 静默，触发 inactivity timeout
      await sleep(600_000); // 10 min — 测试会在此之前杀死进程
      break;

    case 'garbage':
      output('not valid json at all');
      output('{"incomplete":');
      output('still not json');
      process.exit(1);
      break;

    case 'slow-exit':
      output(JSON.stringify({ type: 'message_start' }));
      output(JSON.stringify({ type: 'text_delta', text: 'done' }));
      output(JSON.stringify({ type: 'message_stop' }));
      // 收到 stdin end 后 5s 才退出
      await sleep(5000);
      process.exit(0);
      break;

    case 'busy-loop':
      // 持续输出直到被外部杀死（测 session 总时长看门狗）
      let i = 0;
      const start = Date.now();
      while (Date.now() - start < 120_000) {
        output(JSON.stringify({ type: 'text_delta', text: `loop ${i++}` }));
        await sleep(100);
      }
      process.exit(0);
      break;

    default:
      process.stderr.write(`Unknown scenario: ${scenario}\n`);
      process.exit(1);
  }
}

run().catch(() => process.exit(1));
