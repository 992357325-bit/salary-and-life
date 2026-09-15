import test from 'node:test';
import assert from 'node:assert/strict';
import { SHARE_URL, copyShareLink } from '../dist/share.mjs';

test('复制内容固定为首页，无参数、个人金额或身份信息', async () => {
  let copied;
  assert.equal(await copyShareLink({ writeText: async text => { copied = text; } }), true);
  assert.equal(copied, 'https://salary-and-life.witty-moss-2962.chatgpt.site');
  assert.equal(copied, SHARE_URL);
  const url = new URL(copied);
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.equal(url.pathname, '/');
});

test('剪贴板不可用或拒绝权限时返回失败，供界面显示手动复制', async () => {
  assert.equal(await copyShareLink(undefined), false);
  assert.equal(await copyShareLink({ writeText: async () => { throw new Error('Permission denied'); } }), false);
});
