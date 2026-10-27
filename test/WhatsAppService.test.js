'use strict';
// Offline tests: no token and no network. Run with `npm test`.
const test = require('node:test');
const assert = require('node:assert');
const WhatsAppService = require('../src/service/WhatsAppService');

// A service whose HTTP client records each call and returns what the test says Whapi would.
function serviceWith(responses = {}) {
  const wa = new WhatsAppService('test-token');
  const calls = [];
  const reply = (method) => async (url, a, b) => {
    calls.push({ method, url, a, b });
    return { data: responses[`${method} ${url}`] ?? {} };
  };
  wa._client = { get: reply('get'), post: reply('post'), put: reply('put'), patch: reply('patch'), delete: reply('delete') };
  return { wa, calls };
}

const GROUP = '120363411291083485@g.us';

test('sendText returns the message id at the top level (Whapi nests it under message)', async () => {
  const { wa, calls } = serviceWith({ 'post /messages/text': { sent: true, message: { id: 'abc-123' } } });
  const result = await wa.sendText(GROUP, 'hello', { quotedId: 'q-1' });
  assert.strictEqual(result.id, 'abc-123');
  assert.strictEqual(result.sent, true);
  assert.deepStrictEqual(calls[0].a, { to: GROUP, body: 'hello', quoted: 'q-1' });
});

test('getMessages puts the chat id in the path, never in ?chat_id=', async () => {
  const { wa, calls } = serviceWith({ [`get /messages/list/${encodeURIComponent(GROUP)}`]: { messages: [{ id: 'm1', text: { body: 'hi' }, from_me: true }] } });
  const messages = await wa.getMessages(GROUP, { count: 10, sort: 'asc' });
  assert.strictEqual(calls[0].url, `/messages/list/${encodeURIComponent(GROUP)}`);
  assert.ok(!('chat_id' in calls[0].a.params));
  assert.deepStrictEqual(calls[0].a.params, { count: 10, offset: 0, sort: 'asc' });
  assert.strictEqual(messages[0].text, 'hi');
});

test('getMessages passes from_me only when asked', async () => {
  const { wa, calls } = serviceWith();
  await wa.getMessages(GROUP, { fromMe: false });
  assert.strictEqual(calls[0].a.params.from_me, false);
});

test('getMessageStatuses asks for one chat by path', async () => {
  const { wa, calls } = serviceWith({ [`get /messages/list/${encodeURIComponent(GROUP)}`]: { messages: [{ id: 'm1', status: 'read', timestamp: 1 }] } });
  const statuses = await wa.getMessageStatuses(GROUP, 5);
  assert.strictEqual(calls[0].url, `/messages/list/${encodeURIComponent(GROUP)}`);
  assert.deepStrictEqual(statuses, [{ id: 'm1', status: 'read', timestamp: 1 }]);
});

test('group calls use the expected Whapi paths', async () => {
  const { wa, calls } = serviceWith({ 'post /groups': { id: GROUP, subject: 'Team' } });
  await wa.createGroup('Team', ['911111111111']);
  await wa.addMember(GROUP, ['912222222222']);
  await wa.removeMember(GROUP, ['912222222222']);
  await wa.getGroup(GROUP);
  await wa.listGroups();
  await wa.reactToMessage(GROUP, 'msg-1', '👍');
  assert.deepStrictEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'post /groups',
    `post /groups/${GROUP}/participants`,
    `delete /groups/${GROUP}/participants`,
    `get /groups/${GROUP}`,
    'get /groups',
    'put /messages/msg-1/reaction',
  ]);
});

test('updateGroup renames with `subject` (Whapi ignores `name`)', async () => {
  const { wa, calls } = serviceWith();
  await wa.updateGroup(GROUP, { subject: 'New name' });
  assert.deepStrictEqual([calls[0].method, calls[0].url, calls[0].a], ['put', `/groups/${GROUP}`, { subject: 'New name' }]);
});

test('setWebhook subscribes to groups.put as well, so member changes arrive', async () => {
  const { wa, calls } = serviceWith();
  await wa.setWebhook('https://example.com/webhook', ['messages', 'groups']);
  const events = calls[0].a.webhooks[0].events.map((e) => `${e.type}.${e.method}`);
  assert.deepStrictEqual(events, ['messages.post', 'messages.patch', 'groups.post', 'groups.patch', 'groups.put']);
});
