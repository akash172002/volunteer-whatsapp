'use strict';

/**
 * WhatsappWebhook
 *
 * Express middleware that receives Whapi webhook events and emits them
 * as Node.js EventEmitter events, focused on incoming group messages.
 *
 * Usage:
 *   const { whatsappWebhook, webhookEvents } = require('./WhatsappWebhook');
 *
 *   app.post('/webhook', whatsappWebhook);
 *
 *   // Incoming group message
 *   webhookEvents.on('group:message', (message) => {
 *     console.log(`[${message.groupId}] ${message.fromName}: ${message.text}`);
 *   });
 *
 *   // Status update (delivered / read)
 *   webhookEvents.on('message:status', (update) => {
 *     console.log(`Message ${update.messageId} → ${update.status}`);
 *   });
 */

const EventEmitter = require('events');

const webhookEvents = new EventEmitter();
webhookEvents.setMaxListeners(50);

/**
 * Normalise the Whapi event type field.
 * Whapi sends event as either a string ("messages.post")
 * or an object ({ type: "messages", event: "post" }).
 */
function normaliseEventType(raw) {
  if (!raw) return 'unknown';
  if (typeof raw === 'string') return raw;
  return `${raw.type}.${raw.event}`;
}

/**
 * Normalise a raw Whapi message into a clean shape for the UI.
 */
function normaliseMessage(msg, groupId) {
  return {
    groupId:   groupId || msg.chat_id,
    id:        msg.id,
    from:      msg.from,
    fromName:  msg.from_name || msg.from,
    fromMe:    msg.from_me || false,
    text:      msg.text?.body || msg.link_preview?.body || null,
    type:      msg.type,
    timestamp: msg.timestamp,
    status:    msg.status || null,
    quotedId:  msg.context?.quoted_id || null,
    reactions: msg.reactions || [],
  };
}

/**
 * Express middleware — mount on your webhook route.
 * Responds 200 immediately (Whapi requires a fast ack).
 */
function whatsappWebhook(req, res) {
  res.sendStatus(200);

  const body      = req.body;
  const eventType = normaliseEventType(body.event);

  // ── Incoming messages ────────────────────────────────────────────────────
  if (eventType === 'messages.post') {
    const messages = body.messages || [];

    for (const msg of messages) {
      const isGroup    = msg.chat_id?.endsWith('@g.us');
      const isIncoming = !msg.from_me;

      // Skip internal Whapi action/reaction events
      if (msg.type === 'action' || msg.type === 'reaction') continue;

      if (isGroup && isIncoming) {
        webhookEvents.emit('group:message', normaliseMessage(msg));
      }

      if (isGroup && msg.from_me) {
        webhookEvents.emit('message:sent', normaliseMessage(msg));
      }
    }
  }

  // ── Status / reaction updates ────────────────────────────────────────────
  if (eventType === 'messages.patch') {
    const updates = body.messages_updates || body.messages || [];

    for (const u of updates) {
      const after = u.after_update || {};

      if (after.status) {
        webhookEvents.emit('message:status', {
          messageId: u.id,
          status:    after.status,
          groupId:   after.chat_id,
        });
      }

      const reactions = after.reactions ?? (after.reaction ? [after.reaction] : null);
      if (reactions !== null && reactions !== undefined) {
        webhookEvents.emit('message:reaction', {
          messageId: u.id,
          reactions,
          groupId:   after.chat_id,
        });
      }
    }
  }

  // Catch-all for debugging
  webhookEvents.emit('*', eventType, body);
}

module.exports = { whatsappWebhook, webhookEvents };
