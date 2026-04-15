'use strict';

/**
 * WhatsAppService
 *
 * Production-ready wrapper around the Whapi.cloud REST API.
 * Drop this file into any Node.js project. Requires:
 *   - axios  (npm install axios)
 *   - A valid WHAPI_TOKEN from whapi.cloud
 *
 * Usage:
 *   const WhatsAppService = require('./WhatsAppService');
 *   const wa = new WhatsAppService(process.env.WHAPI_TOKEN);
 *
 *   const group = await wa.createGroup('My Group', ['919876543210']);
 *   await wa.sendText(group.id, 'Hello everyone!');
 */

const axios = require('axios');

const BASE_URL = 'https://gate.whapi.cloud';

class WhatsAppService {
  /**
   * @param {string} token  - Whapi API token from your channel settings
   */
  constructor(token) {
    if (!token) throw new Error('WhatsAppService: token is required');

    this._client = axios.create({
      baseURL: BASE_URL,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    // Surface Whapi error messages cleanly
    this._client.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response) {
          const { status, data } = err.response;
          // Always stringify so objects don't become [object Object]
          const msg = typeof data === 'string' ? data : JSON.stringify(data);
          err.message = `Whapi ${status}: ${msg}`;
          err.responseData = data; // keep raw for callers that need it
        }
        return Promise.reject(err);
      }
    );
  }

  // ─── Groups ───────────────────────────────────────────────────────────────

  /**
   * Create a WhatsApp group. (C1)
   * @param {string}   subject      - Group name
   * @param {string[]} participants - Phone numbers in international format without +
   *                                  e.g. ['919876543210', '14155552671']
   * @returns {Promise<{id: string, subject: string}>}
   */
  async createGroup(subject, participants = []) {
    const res = await this._client.post('/groups', { subject, participants });
    const group = res.data;

    // Free-plan limitation: Whapi may not apply the subject on creation.
    // If the returned subject is missing or equals the raw JID, patch it now.
    if (group.id && (!group.subject || group.subject === group.id)) {
      try {
        await this._client.put(`/groups/${group.id}`, { subject });
        group.subject = subject;
      } catch (_) {
        // Best-effort — not a hard failure
        group.subject = subject; // at least keep it in memory for this response
      }
    }

    return group;
  }

  /**
   * Update group settings (subject, description, etc.)
   * @param {string} groupId
   * @param {object} fields  - e.g. { subject: 'New Name' }
   * @returns {Promise<object>}
   */
  async updateGroup(groupId, fields = {}) {
    const res = await this._client.put(`/groups/${groupId}`, fields);
    return res.data;
  }

  /**
   * Get metadata for a group including participants and admin status.
   * @param {string} groupId - Group JID e.g. "120363409844308142@g.us"
   * @returns {Promise<object>}
   */
  async getGroup(groupId) {
    const res = await this._client.get(`/groups/${groupId}`);
    return res.data;
  }

  /**
   * List all groups the connected number is part of.
   * @returns {Promise<object[]>}
   */
  async listGroups() {
    const res = await this._client.get('/groups', { params: { count: 100 } });
    return res.data?.groups || res.data || [];
  }

  // ─── Messaging ────────────────────────────────────────────────────────────

  /**
   * Send a plain text message to a group or individual. (C2 / C4)
   *
   * For groups:      to = "120363409844308142@g.us"
   * For individuals: to = "919876543210"  (phone number, no @suffix needed)
   *
   * @param {string}  to           - Group JID or phone number
   * @param {string}  text         - Message body (UTF-8, emojis supported)
   * @param {object}  [options]
   * @param {string}  [options.quotedId]    - Message ID to reply to (quoted/thread reply)
   * @param {number}  [options.typingTime]  - Seconds to simulate typing (0–60)
   * @returns {Promise<{id: string}>}
   */
  async sendText(to, text, options = {}) {
    const payload = { to, body: text };
    if (options.quotedId) payload.quoted = options.quotedId;
    if (options.typingTime) payload.typing_time = options.typingTime;
    const res = await this._client.post('/messages/text', payload);
    return res.data;
  }

  /**
   * React to a message with an emoji.
   * @param {string} groupId   - Group JID e.g. "120363409844308142@g.us"
   * @param {string} messageId - ID of the message to react to
   * @param {string} emoji     - Emoji character e.g. "✅" "👍" "🎉"
   *                             Pass empty string "" to remove a reaction.
   * @returns {Promise<object>}
   */
  async reactToMessage(groupId, messageId, emoji) {
    // PUT /messages/{MessageID}/reaction — messageId is a URL path parameter
    const res = await this._client.put(`/messages/${messageId}/reaction`, {
      to:    groupId,
      emoji: emoji,
    });
    return res.data;
  }

  // ─── Message History ─────────────────────────────────────────────────────

  /**
   * Get message history for a group or individual chat.
   * Use this to populate a chat UI with past messages.
   *
   * NOTE on C6: Whapi does not store messages on their servers permanently.
   * Messages are sourced from your linked WhatsApp device's local storage.
   * History is available as long as your device retains it (typically 30–90 days).
   * For permanent storage, save messages to your own database as they arrive
   * via the webhook (messages.post event).
   *
   * @param {string}  chatId          - Group JID e.g. "120363409844308142@g.us"
   * @param {object}  [options]
   * @param {number}  [options.count]     - Messages to fetch (default 50, max 500)
   * @param {number}  [options.offset]    - Pagination offset (default 0)
   * @param {string}  [options.sort]      - "asc" (oldest first) | "desc" (newest first, default)
   * @param {boolean} [options.fromMe]    - true = only sent, false = only received, omit = both
   * @returns {Promise<Array<{
   *   id:        string,
   *   from:      string,
   *   fromName:  string,
   *   fromMe:    boolean,
   *   text:      string|null,
   *   type:      string,
   *   timestamp: number,
   *   status:    string,
   *   quotedId:  string|null,
   *   reactions: Array
   * }>>}
   */
  async getMessages(chatId, options = {}) {
    const { count = 50, offset = 0, sort = 'asc', fromMe } = options;

    const params = { chat_id: chatId, count, offset, sort };
    if (fromMe !== undefined) params.from_me = fromMe;

    const res = await this._client.get('/messages/list', { params });
    const raw = res.data?.messages || res.data?.items || [];

    return raw.map((m) => ({
      id:        m.id,
      from:      m.from,
      fromName:  m.from_name || null,
      fromMe:    m.from_me,
      text:      m.text?.body || m.link_preview?.body || null,
      type:      m.type,
      timestamp: m.timestamp,
      status:    m.status || null,
      quotedId:  m.context?.quoted_id || null,
      reactions: m.reactions || [],
    }));
  }

  // ─── Delivery Status ──────────────────────────────────────────────────────

  /**
   * Get the delivery status of recent messages in a chat. (C5)
   *
   * Status values (in order of progression):
   *   pending → server → delivered → read → voice_message_played
   *
   * @param {string} chatId  - Group JID or phone number
   * @param {number} [count] - Number of messages to fetch (default 20, max 500)
   * @returns {Promise<Array<{id: string, status: string, timestamp: number}>>}
   */
  async getMessageStatuses(chatId, count = 20) {
    const res = await this._client.get('/messages/list', {
      params: { chat_id: chatId, count },
    });
    const messages = res.data?.messages || res.data?.items || [];
    return messages.map((m) => ({ id: m.id, status: m.status, timestamp: m.timestamp }));
  }

  // ─── Members ─────────────────────────────────────────────────────────────

  /**
   * Add one or more participants to a group.
   * @param {string}   groupId      - Group JID e.g. "120363409844308142@g.us"
   * @param {string[]} participants - Phone numbers in international format without +
   * @returns {Promise<object>}
   */
  async addMember(groupId, participants = []) {
    const res = await this._client.post(`/groups/${groupId}/participants`, { participants });
    return res.data;
  }

  /**
   * Remove one or more participants from a group.
   * @param {string}   groupId      - Group JID e.g. "120363409844308142@g.us"
   * @param {string[]} participants - Phone numbers in international format without +
   * @returns {Promise<object>}
   */
  async removeMember(groupId, participants = []) {
    const res = await this._client.delete(`/groups/${groupId}/participants`, { data: { participants } });
    return res.data;
  }

  // ─── Settings / Webhook ───────────────────────────────────────────────────

  /**
   * Configure the webhook URL that Whapi posts events to. (C7)
   *
   * Call this once during setup or whenever your server URL changes.
   *
   * @param {string}   webhookUrl - Public HTTPS URL e.g. "https://yourserver.com/webhook"
   * @param {string[]} [eventTypes] - Events to subscribe to.
   *                   Defaults to messages (incoming + status updates).
   *                   Available types: messages, statuses, chats, groups, contacts, calls
   * @returns {Promise<object>} before_update and after_update settings
   */
  async setWebhook(webhookUrl, eventTypes = ['messages']) {
    const events = [];
    for (const type of eventTypes) {
      events.push({ type, method: 'post' });
      events.push({ type, method: 'patch' });
    }
    const res = await this._client.patch('/settings', {
      webhooks: [{ url: webhookUrl, mode: 'body', events }],
    });
    return res.data;
  }

  /**
   * Get the current channel settings including configured webhooks.
   * @returns {Promise<object>}
   */
  async getSettings() {
    const res = await this._client.get('/settings');
    return res.data;
  }

  /**
   * Check if the WhatsApp session is connected and healthy.
   * @returns {Promise<{status: string, connected: boolean}>}
   */
  async healthCheck() {
    try {
      const res = await this._client.get('/health');
      return { status: res.data?.status || 'ok', connected: true };
    } catch {
      return { status: 'error', connected: false };
    }
  }
}

module.exports = WhatsAppService;
