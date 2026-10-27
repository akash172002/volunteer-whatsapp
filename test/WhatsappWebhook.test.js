'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { whatsappWebhook, webhookEvents } = require('../src/service/WhatsappWebhook');

const GROUP = '120363000000000001@g.us';
function deliver(body) {
  const seen = [];
  const names = ['group:message', 'dm:message', 'message:sent', 'message:status', 'message:reaction', 'group:members', 'group:renamed'];
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

const members = (entries) => ({ groups_participants: entries, event: { type: 'groups', event: 'put' }, channel_id: 'CHANNEL' });

test('a member added to a group becomes group:members with plain phone numbers', () => {
  const { seen } = deliver(members([{ group_id: GROUP, participants: ['918840738327@s.whatsapp.net'], action: 'add' }]));
  assert.deepStrictEqual(seen, [['group:members', { groupId: GROUP, action: 'add', participants: ['918840738327'], performedBy: null }]]);
});

test('a member removed from a group becomes group:members with action remove', () => {
  const { seen } = deliver(members([{ group_id: GROUP, participants: ['918840738327@s.whatsapp.net'], action: 'remove' }]));
  assert.strictEqual(seen[0][1].action, 'remove');
});

test('a join through an invite link carries performed_by', () => {
  const { seen } = deliver(members([{ group_id: GROUP, participants: ['911111111111@s.whatsapp.net'], action: 'add', performed_by: 'link' }]));
  assert.strictEqual(seen[0][1].performedBy, 'link');
});

test('promote, demote and request are passed through, several entries in one event', () => {
  const { seen } = deliver(members([
    { group_id: GROUP, participants: ['911111111111@s.whatsapp.net', '912222222222@s.whatsapp.net'], action: 'promote' },
    { group_id: GROUP, participants: ['913333333333@s.whatsapp.net'], action: 'demote' },
    { group_id: GROUP, participants: ['914444444444@s.whatsapp.net'], action: 'request' },
  ]));
  assert.deepStrictEqual(seen.map((s) => s[1].action), ['promote', 'demote', 'request']);
  assert.deepStrictEqual(seen[0][1].participants, ['911111111111', '912222222222']);
});

test('a group rename becomes group:renamed with the old and new name', () => {
  const { seen } = deliver({ groups_updates: [{ before_update: { id: GROUP, name: 'Old' }, after_update: { id: GROUP, name: 'New' }, changes: ['name'] }], event: { type: 'groups', event: 'patch' } });
  assert.deepStrictEqual(seen, [['group:renamed', { groupId: GROUP, oldName: 'Old', newName: 'New' }]]);
});

test('a group update that did not change the name is ignored', () => {
  const { seen } = deliver({ groups_updates: [{ before_update: { id: GROUP, name: 'Same' }, after_update: { id: GROUP, name: 'Same' }, changes: ['description'] }], event: { type: 'groups', event: 'patch' } });
  assert.strictEqual(seen.length, 0);
});

test('a malformed group event does not throw and still answers 200', () => {
  const { seen, code } = deliver({ event: { type: 'groups', event: 'put' } });
  assert.strictEqual(code, 200);
  assert.strictEqual(seen.length, 0);
});
