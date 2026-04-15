# Volunteer WhatsApp Service

A Node.js backend that connects to [Whapi.cloud](https://whapi.cloud) to manage WhatsApp groups for volunteer coordination.

---

## Architecture

The entire WhatsApp logic lives in two service files:

```
src/service/
├── WhatsAppService.js    ← All outgoing API calls (create group, send message, etc.)
└── WhatsappWebhook.js    ← Incoming message handler (webhook events from Whapi)
```

`server.js` wires these two files together — it exposes REST endpoints that call `WhatsAppService`, and mounts `WhatsappWebhook` to receive real-time events from Whapi. Socket.io then pushes those events to the frontend.

```
Frontend (UI)
    │  REST calls          │  Socket.io (real-time)
    ▼                      ▼
server.js ──────────► WhatsAppService.js ──► Whapi REST API
    │                                              │
    └──── WhatsappWebhook.js ◄─── Whapi Webhook ──┘
```

---

## WhatsAppService.js

Wraps the Whapi REST API. Instantiate once with your token:

```js
const WhatsAppService = require('./src/service/WhatsAppService');
const wa = new WhatsAppService(process.env.WHAPI_TOKEN);
```

### Methods

| Method | Description |
|--------|-------------|
| `createGroup(name, participants)` | Create a new WhatsApp group |
| `sendText(to, text, options)` | Send a text message to a group or individual |
| `addMember(groupId, participants)` | Add member(s) to an existing group |
| `removeMember(groupId, participants)` | Remove member(s) from a group |
| `updateGroup(groupId, fields)` | Update group settings (e.g. rename) |
| `getGroup(groupId)` | Get group details and participant list |
| `listGroups()` | List all groups the connected number is in |
| `getMessages(chatId, options)` | Fetch message history for a group |
| `reactToMessage(groupId, messageId, emoji)` | React to a message with an emoji |
| `setWebhook(url, eventTypes)` | Register the webhook URL with Whapi |
| `healthCheck()` | Check if the WhatsApp session is connected |

### Phone number format

All participant numbers must be in **international format without the `+`**:

| Country | Wrong | Correct |
|---------|-------|---------|
| USA | `6232636173` | `16232636173` |
| India | `9876543210` | `919876543210` |
| Mexico | `6232636173` | `526232636173` |

### Free plan note

On the Whapi free/sandbox plan, group creation may not apply the subject (name). `createGroup` handles this automatically by calling `PUT /groups/:id` to patch the name after creation.

---

## WhatsappWebhook.js

Express middleware that receives Whapi POST events and emits them as Node.js `EventEmitter` events. Mount it on your webhook route:

```js
const { whatsappWebhook, webhookEvents } = require('./src/service/WhatsappWebhook');

app.post('/webhook', whatsappWebhook);
```

### Events

| Event | When fired | Payload |
|-------|-----------|---------|
| `group:message` | Incoming message in a group | `{ groupId, id, from, fromName, text, type, timestamp, ... }` |
| `message:sent` | Outgoing message confirmed by Whapi | same shape as above |
| `message:status` | Delivery/read status update | `{ messageId, status, groupId }` |
| `message:reaction` | Emoji reaction added/changed | `{ messageId, reactions, groupId }` |
| `*` | Every event (for debugging) | `(eventType, body)` |

### Example

```js
webhookEvents.on('group:message', (message) => {
  console.log(`[${message.groupId}] ${message.fromName}: ${message.text}`);
});

webhookEvents.on('message:status', ({ messageId, status }) => {
  console.log(`Message ${messageId} → ${status}`);
});
```

### Status values (in order)
`pending` → `server` → `delivered` → `read`

---

## Setup

### 1. Install dependencies

```bash
cd test-app
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
WHAPI_TOKEN=your_token_here        # From whapi.cloud channel settings
PHONE_NUMBER=919876543210          # Your WhatsApp number (no +)
PORT=3001
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

### 3. Run the server

```bash
npm run dev        # development (nodemon)
npm start          # production
```

Server starts at `http://localhost:3001`

---

## Webhook setup (for incoming messages)

Whapi needs a public HTTPS URL to POST events to. Locally, use ngrok:

```bash
# Terminal 1 — start the server
npm run dev

# Terminal 2 — start ngrok and auto-register webhook with Whapi
node dev.js
```

`dev.js` starts ngrok and automatically calls `PUT /settings` on Whapi to register the tunnel URL. You do not need to do this manually.

In production, set your server's public URL directly in Whapi's channel settings or call:

```js
await wa.setWebhook('https://yourserver.com/webhook');
```

---

## API Endpoints

All endpoints are defined inline in `server.js`.

### Groups

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `GET` | `/api/groups` | — | List all groups |
| `POST` | `/api/groups` | `{ name, participants[] }` | Create a group |
| `GET` | `/api/groups/:id` | — | Get group details |
| `POST` | `/api/groups/:id/members` | `{ participants[] }` | Add member(s) |
| `DELETE` | `/api/groups/:id/members` | `{ participants[] }` | Remove member(s) |
| `GET` | `/api/groups/:id/messages` | — | Fetch message history |

### Messages

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `POST` | `/api/messages` | `{ to, text, quotedId? }` | Send a message |
| `PUT` | `/api/messages/reaction` | `{ groupId, messageId, emoji }` | React to a message |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/webhook` | Whapi webhook receiver |
| `GET` | `/health` | Server health check |

---

## Socket.io Events

The server broadcasts these events to all connected frontend clients:

| Event | Payload |
|-------|---------|
| `message:new` | `{ groupId, message }` — new incoming group message |
| `message:sent` | `{ groupId, message }` — outgoing message confirmed |
| `message:status` | `{ messageId, status, groupId }` — delivery update |
| `message:reaction` | `{ messageId, reactions, groupId }` — reaction update |

---

## Project Structure

```
test-app/
├── server.js                  # Express app + Socket.io + inline API routes
├── dev.js                     # ngrok helper (local webhook tunnel)
├── src/
│   └── service/
│       ├── WhatsAppService.js # Whapi REST API wrapper
│       └── WhatsappWebhook.js # Incoming webhook event handler
├── .env                       # Local secrets (gitignored)
├── .env.example               # Template for new developers
└── package.json
```
