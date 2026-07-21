import { describe, expect, test } from 'vitest';
import { loadQqAccountExperimentConfig } from './runtime';

describe('loadQqAccountExperimentConfig', () => {
  test('支持空群列表和数组形式的好友列表', () => {
    const config = loadQqAccountExperimentConfig({
      YE_KITTY_ONEBOT_ACCESS_TOKEN: 'token',
      YE_KITTY_QQ_SELF_ID: '3860284970',
      YE_KITTY_QQ_GROUP_ALLOWLIST: '[]',
      YE_KITTY_QQ_FRIEND_ALLOWLIST: '[1463645455, 23123123]',
    });

    expect(config.allowedGroupIds).toEqual([]);
    expect(config.allowedFriendIds).toEqual(['1463645455', '23123123']);
  });
});
