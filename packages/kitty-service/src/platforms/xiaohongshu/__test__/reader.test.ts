import { describe, expect, test, vi } from 'vitest';
import { McpXiaohongshuMentionReader } from '../reader';

describe('小红书MCP被提及读取器', () => {
  test('解析通知页的message_list并转为稳定领域对象', async () => {
    const caller = {
      hasTool: vi.fn(() => true),
      callToolRaw: vi.fn(async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              data: {
                message_list: [
                  {
                    id: 'mention-1',
                    title: '在评论中提到了你',
                    content: '@叶猫猫 你怎么看',
                    time: 1_752_624_000,
                    user_info: { user_id: 'user-1', nickname: '小红薯' },
                    item_info: { note_id: 'note-1', comment_id: 'comment-1' },
                  },
                ],
                cursor: 'next',
                has_more: true,
              },
            }),
          },
        ],
      })),
    };
    const reader = new McpXiaohongshuMentionReader(caller, 'xiaohongshu');

    await expect(reader.listMentions()).resolves.toEqual({
      mentions: [
        {
          id: 'mention-1',
          actorId: 'user-1',
          actorDisplayName: '小红薯',
          content: '@叶猫猫 你怎么看',
          title: '在评论中提到了你',
          noteId: 'note-1',
          commentId: 'comment-1',
          occurredAt: new Date('2025-07-16T00:00:00.000Z'),
        },
      ],
      cursor: 'next',
      hasMore: true,
    });
    expect(caller.callToolRaw).toHaveBeenCalledWith('xiaohongshu_list_mentions', null);
  });

  test('拒绝缺失工具、上游失败和非法JSON', async () => {
    const missingReader = new McpXiaohongshuMentionReader(
      { hasTool: () => false, callToolRaw: vi.fn() },
      'xiaohongshu',
    );
    await expect(missingReader.listMentions()).rejects.toThrow('缺少内部工具');

    const failedReader = new McpXiaohongshuMentionReader(
      {
        hasTool: () => true,
        callToolRaw: vi.fn(async () => ({
          isError: true,
          content: [{ type: 'text', text: '限流' }],
        })),
      },
      'xiaohongshu',
    );
    await expect(failedReader.listMentions()).rejects.toThrow('限流');

    const invalidReader = new McpXiaohongshuMentionReader(
      {
        hasTool: () => true,
        callToolRaw: vi.fn(async () => ({ content: [{ type: 'text', text: 'not-json' }] })),
      },
      'xiaohongshu',
    );
    await expect(invalidReader.listMentions()).rejects.toThrow('JSON');
  });

  test('兼容结构化结果、字段别名和缺失通知ID', async () => {
    const reader = new McpXiaohongshuMentionReader(
      {
        hasTool: () => true,
        callToolRaw: vi.fn(async () => ({
          content: { ignored: true },
          structuredContent: {
            message_list: [
              {
                message_id: 'message-2',
                text: '备选文本',
                timestamp: '1752624000000',
                user_info: { id: 'user-2', name: '备选用户' },
                item_info: { id: 'note-2' },
                target_comment_id: 'comment-2',
                link: 'https://www.xiaohongshu.com/explore/note-2',
              },
              {
                notification_id: 'message-3',
                title: '标题',
                item_info: { title: '笔记文本' },
                created_at: 0,
                user_info: null,
              },
              {
                title: '仅有标题',
                note_id: 'note-3',
                comment_id: 'comment-3',
                url: 'https://www.xiaohongshu.com/explore/note-3',
              },
              { content: '用摘要生成ID', time: 'invalid' },
            ],
            hasMore: true,
          },
        })),
      },
      'xiaohongshu',
    );

    const page = await reader.listMentions();

    expect(page.hasMore).toBe(true);
    expect(page.cursor).toBeUndefined();
    expect(page.mentions[0]).toMatchObject({
      id: 'message-2',
      actorId: 'user-2',
      actorDisplayName: '备选用户',
      content: '备选文本',
      noteId: 'note-2',
      commentId: 'comment-2',
      url: 'https://www.xiaohongshu.com/explore/note-2',
      occurredAt: new Date('2025-07-16T00:00:00.000Z'),
    });
    expect(page.mentions[1]).toMatchObject({
      id: 'message-3',
      content: '笔记文本',
    });
    expect(page.mentions[2]).toMatchObject({
      content: '仅有标题',
      noteId: 'note-3',
      commentId: 'comment-3',
    });
    expect(page.mentions[3]?.id).toMatch(/^[a-f0-9]{24}$/);
  });

  test('兼容字符串内容并拒绝缺失内容或列表结构', async () => {
    const createReader = (result: unknown) =>
      new McpXiaohongshuMentionReader(
        {
          hasTool: () => true,
          callToolRaw: vi.fn(async () => result as { content?: unknown; isError?: boolean }),
        },
        'xiaohongshu',
      );

    await expect(createReader({ content: '{"message_list":[]}' }).listMentions()).resolves.toEqual({
      mentions: [],
      hasMore: false,
    });
    await expect(createReader({ isError: true }).listMentions()).rejects.toThrow('MCP读取');
    await expect(createReader({}).listMentions()).rejects.toThrow('没有返回可读JSON');
    await expect(createReader({ structuredContent: { other: [] } }).listMentions()).rejects.toThrow(
      'message_list',
    );
    await expect(
      createReader({ structuredContent: { message_list: [null] } }).listMentions(),
    ).rejects.toThrow('第1条');
    await expect(createReader({ structuredContent: [] }).listMentions()).rejects.toThrow(
      '缺少对象结构',
    );
  });

  test('文本内容块会忽略图片和无效文本', async () => {
    const reader = new McpXiaohongshuMentionReader(
      {
        hasTool: () => true,
        callToolRaw: vi.fn(async () => ({
          content: [
            { type: 'image', data: 'ignored' },
            { type: 'text', text: 123 },
            '{"message_list":[]}',
          ],
        })),
      },
      'xiaohongshu',
    );

    await expect(reader.listMentions()).resolves.toEqual({ mentions: [], hasMore: false });
  });
});
