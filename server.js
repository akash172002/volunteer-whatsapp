'use strict';

require('dotenv').config();
const http    = require('http');
const express = require('express');
const cors    = require('cors');
const { Server } = require('socket.io');

const WhatsAppService  = require('./src/service/WhatsAppService');
const { whatsappWebhook, webhookEvents } = require('./src/service/WhatsappWebhook');

const app        = express();
const httpServer = http.createServer(app);
const PORT       = process.env.PORT || 3001;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173,http://localhost:8080')
  .split(',').map((o) => o.trim());

// ─── WhatsApp service ─────────────────────────────────────────────────────────
const wa = new WhatsAppService(process.env.WHAPI_TOKEN);

// ─── Socket.io ───────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: '*', credentials: false },
});

io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`[Socket.io] Client disconnected: ${socket.id}`));
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── Webhook (Whapi → server) ─────────────────────────────────────────────────
app.post('/webhook', whatsappWebhook);

// ─── Groups ───────────────────────────────────────────────────────────────────

// POST /api/groups — create a group
// Body: { name: string, participants: string[] }
app.post('/api/groups', async (req, res) => {
  try {
    const { name, participants = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const group = await wa.createGroup(name, participants);
    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups — list all groups
app.get('/api/groups', async (_req, res) => {
  try {
    const groups = await wa.listGroups();
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id — get group details + participant list
app.get('/api/groups/:id', async (req, res) => {
  try {
    const group = await wa.getGroup(req.params.id);
    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/members — add member(s) to a group
// Body: { participants: string[] }
app.post('/api/groups/:id/members', async (req, res) => {
  try {
    const { participants = [] } = req.body;
    if (!participants.length) return res.status(400).json({ error: 'participants array is required' });
    const result = await wa.addMember(req.params.id, participants);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/groups/:id/members — remove member(s) from a group
// Body: { participants: string[] }
app.delete('/api/groups/:id/members', async (req, res) => {
  try {
    const { participants = [] } = req.body;
    if (!participants.length) return res.status(400).json({ error: 'participants array is required' });
    const result = await wa.removeMember(req.params.id, participants);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Messages ─────────────────────────────────────────────────────────────────

// POST /api/messages — send a message to a group
// Body: { to: string, text: string, quotedId?: string }
app.post('/api/messages', async (req, res) => {
  try {
    const { to, text, quotedId } = req.body;
    if (!to)   return res.status(400).json({ error: 'to is required' });
    if (!text) return res.status(400).json({ error: 'text is required' });
    const result = await wa.sendText(to, text, { quotedId });
    res.json({ success: true, messageId: result?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/messages/reaction — react to a message with an emoji
// Body: { groupId: string, messageId: string, emoji: string }
app.put('/api/messages/reaction', async (req, res) => {
  try {
    const { groupId, messageId, emoji } = req.body;
    if (!groupId || !messageId || !emoji)
      return res.status(400).json({ error: 'groupId, messageId, and emoji are required' });
    const result = await wa.reactToMessage(groupId, messageId, emoji);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id/messages — fetch message history
// Query: count, offset, sort
app.get('/api/groups/:id/messages', async (req, res) => {
  try {
    const { count = 50, offset = 0, sort = 'asc' } = req.query;
    const messages = await wa.getMessages(req.params.id, {
      count:  parseInt(count),
      offset: parseInt(offset),
      sort,
    });
    res.json({ success: true, count: messages.length, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bridge webhook events → Socket.io ───────────────────────────────────────

webhookEvents.on('group:message', (message) => {
  console.log(`[WhatsApp] ← ${message.fromName}: ${message.text || `[${message.type}]`}`);
  io.emit('message:new', { groupId: message.groupId, message });
});

webhookEvents.on('message:sent', (message) => {
  io.emit('message:sent', { groupId: message.groupId, message });
});

webhookEvents.on('message:status', (update) => {
  console.log(`[WhatsApp] ✓ ${update.messageId?.slice(-16)} → ${update.status}`);
  io.emit('message:status', update);
});

webhookEvents.on('message:reaction', (update) => {
  console.log(`[WhatsApp] 😊 reaction on ${update.messageId?.slice(-16)}:`, update.reactions);
  io.emit('message:reaction', update);
});

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n[Server] Running on http://localhost:${PORT}`);
  console.log(`[Server] Webhook  → POST http://localhost:${PORT}/webhook`);
  console.log(`[Server] Groups   → GET  http://localhost:${PORT}/api/groups`);
  console.log(`[Server] Messages → POST http://localhost:${PORT}/api/messages\n`);
});

module.exports = { app, io };
