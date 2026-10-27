'use strict';
// Live test against the real Whapi channel, through this server's own REST API.
// Needs: WHAPI_TOKEN (server), WHAPI_TEST_NUMBER (a second number, international format, no +),
// and the server running (npm start). Run with `npm run test:live`. It creates one new group
// containing only the test number, and sends a few messages to it.
require('dotenv').config();
const BASE = process.env.LIVE_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
const OTHER = process.env.WHAPI_TEST_NUMBER;
if (!OTHER) { console.error('Set WHAPI_TEST_NUMBER to a second number (international format, no +).'); process.exit(1); }

const results = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function check(name, fn) {
  try { const detail = await fn(); results.push(['PASS', name, detail || '']); }
  catch (e) { results.push(['FAIL', name, e.message.slice(0, 200)]); }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  let gid, firstId;
  await check('server is up', async () => { const r = await call('GET', '/health'); must(r.data.status === 'ok', 'health not ok'); });
  await check('create group with the test number', async () => {
    const r = await call('POST', '/api/groups', { name: 'WDG live test ' + new Date().toISOString().slice(11, 16), participants: [OTHER] });
    must(r.data.success && r.data.group.id, 'no group id: ' + JSON.stringify(r.data));
    gid = r.data.group.id; return gid;
  });
  if (!gid) return report();
  await pause(2000);
  await check('list groups includes it', async () => { const r = await call('GET', '/api/groups'); must(r.data.groups.some((g) => g.id === gid), 'not in list'); });
  const memberIds = async () => (await call('GET', '/api/groups/' + encodeURIComponent(gid))).data.group.participants.map((p) => p.id);
  await check('open group shows both members', async () => { const ids = await memberIds(); must(ids.length === 2 && ids.some((i) => i.startsWith(OTHER)), 'members: ' + ids.join(',')); return ids.length + ' members'; });
  await check('remove the test number', async () => { const r = await call('DELETE', `/api/groups/${encodeURIComponent(gid)}/members`, { participants: [OTHER] }); must(r.data.success, JSON.stringify(r.data)); await pause(2000); must(!(await memberIds()).some((i) => i.startsWith(OTHER)), 'still a member'); });
  await check('add the test number back', async () => { const r = await call('POST', `/api/groups/${encodeURIComponent(gid)}/members`, { participants: [OTHER] }); must(r.data.success, JSON.stringify(r.data)); await pause(2000); must((await memberIds()).some((i) => i.startsWith(OTHER)), 'not a member'); });
  await check('send a message and get its id back', async () => {
    const r = await call('POST', '/api/messages', { to: gid, text: 'live test: first message' });
    must(r.data.success, JSON.stringify(r.data)); must(r.data.messageId, 'messageId is empty'); firstId = r.data.messageId; return firstId;
  });
  await pause(2000);
  await check('reply to that message (quoted)', async () => { const r = await call('POST', '/api/messages', { to: gid, text: 'live test: a reply', quotedId: firstId }); must(r.data.success && r.data.messageId, JSON.stringify(r.data)); });
  await pause(2000);
  await check('react to the first message', async () => { const r = await call('PUT', '/api/messages/reaction', { groupId: gid, messageId: firstId, emoji: '👍' }); must(r.data.success, JSON.stringify(r.data)); });
  await pause(3000);
  await check('history returns only this group, oldest first', async () => {
    const r = await call('GET', `/api/groups/${encodeURIComponent(gid)}/messages?count=20`);
    must(r.data.success, JSON.stringify(r.data));
    const texts = r.data.messages.map((m) => m.text);
    must(texts.includes('live test: first message') && texts.includes('live test: a reply'), 'our messages missing: ' + JSON.stringify(texts));
    return r.data.count + ' messages';
  });
  await check('delivery status of our messages', async () => {
    const WhatsAppService = require('../src/service/WhatsAppService');
    const wa = new WhatsAppService(process.env.WHAPI_TOKEN);
    const raw = (await wa._client.get(`/messages/list/${encodeURIComponent(gid)}`, { params: { count: 20 } })).data.messages;
    must(raw.every((m) => m.chat_id === gid), 'messages from other chats');
    const s = await wa.getMessageStatuses(gid, 20);
    must(s.length > 0 && s.every((x) => x.status), 'missing statuses'); return s.map((x) => x.status).join(',');
  });
  report(gid);
})();

function report(gid) {
  console.log('\nLIVE RESULTS');
  results.forEach(([s, n, d]) => console.log(`${s}  ${n}${d ? '  ->  ' + d : ''}`));
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed. Test group: ${gid || 'none'} (leave it from WhatsApp when done).`);
  process.exit(failed ? 1 : 0);
}
