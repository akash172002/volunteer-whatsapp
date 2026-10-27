'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { whatsappWebhook, webhookEvents } = require('../src/service/WhatsappWebhook');

const GROUP = '120363000000000001@g.us';
function deliver(body) {
  const seen = [];
  const names = ['group:message', 'dm:message', 'message:sent', 'message:status', 'message:reaction'];
  const handlers = names.map((n) => { const h = (p) => seen.push([n, p]); webhookEvents.on(n, h); return [n, h]; });
  let code;
  whatsappWebhook({ body }, { sendStatus: (c) => { code = c; } });
  handlers.forEach(([n, h]) => webhookEvents.off(n, h));
  return { seen, code };
}
const post = (messages) => ({ event: { type: 'messages', event: 'post' }, messages });

test('answers 200 at once and turns a group message into group:message', () => {
  const { seen, code } = deliver(post([{ id: 'm1', chat_id: GROUP, from: '919118874020', from_name: 'Akash', from_me: false, type: 'text', text: { body: 'hello' } }]));
  assert.strictEqual(code, 200);
  assert.deepStrictEqual(seen.map((s) => s[0]), ['group:message']);
  assert.strictEqual(seen[0][1].groupId, GROUP);
  assert.strictEqual(seen[0][1].text, 'hello');
});

test('our own message becomes message:sent', () => {
  const { seen } = deliver(post([{ id: 'm2', chat_id: GROUP, from_me: true, type: 'text', text: { body: 'welcome' } }]));
  assert.deepStrictEqual(seen.map((s) => s[0]), ['message:sent']);
});

test('a direct message becomes dm:message, not group:message', () => {
  const { seen } = deliver(post([{ id: 'm3', chat_id: '919118874020@s.whatsapp.net', from_me: false, type: 'text', text: { body: 'hi' } }]));
  assert.deepStrictEqual(seen.map((s) => s[0]), ['dm:message']);
});

test('system action and reaction messages are ignored', () => {
  const { seen } = deliver(post([{ id: 'm4', chat_id: GROUP, from_me: false, type: 'action' }, { id: 'm5', chat_id: GROUP, from_me: false, type: 'reaction' }]));
  assert.strictEqual(seen.length, 0);
});

test('a status update becomes message:status', () => {
  const { seen } = deliver({ event: 'messages.patch', messages: [{ id: 'm2', after_update: { status: 'read', chat_id: GROUP } }] });
  assert.deepStrictEqual(seen[0], ['message:status', { messageId: 'm2', status: 'read', groupId: GROUP }]);
});

test('a reaction update becomes message:reaction', () => {
  const { seen } = deliver({ event: 'messages.patch', messages: [{ id: 'm1', after_update: { reactions: [{ emoji: '👍' }], chat_id: GROUP } }] });
  assert.deepStrictEqual(seen[0], ['message:reaction', { messageId: 'm1', reactions: [{ emoji: '👍' }], groupId: GROUP }]);
});
