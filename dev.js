'use strict';

/**
 * ngrok-helper.js (optional)
 *
 * Run this SEPARATELY if you need incoming webhooks locally.
 * It starts ngrok and automatically registers the tunnel URL with Whapi.
 *
 * Usage:
 *   node dev.js          ← run this in one terminal
 *   npm run dev          ← run this in another terminal
 *
 * Prerequisites: ngrok installed + authenticated (ngrok config add-authtoken TOKEN)
 */

require('dotenv').config();
const { spawn } = require('child_process');
const axios = require('axios');

const PORT = process.env.PORT || 3001;
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

if (!WHAPI_TOKEN || WHAPI_TOKEN.includes('your_')) {
  console.error('[ngrok-helper] ERROR: WHAPI_TOKEN missing in .env');
  process.exit(1);
}

console.log(`[ngrok-helper] Starting ngrok tunnel on port ${PORT}...`);

const ngrokProcess = spawn('ngrok', ['http', String(PORT), '--log=stdout'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
ngrokProcess.stderr.on('data', (d) => process.stderr.write(d));

async function getNgrokUrl(retries = 15, delayMs = 800) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get('http://localhost:4040/api/tunnels', { timeout: 2000 });
      const https = (res.data?.tunnels || []).find((t) => t.proto === 'https');
      if (https) return https.public_url;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error('ngrok did not start. Is it installed? Run: brew install ngrok');
}

(async () => {
  try {
    const publicUrl = await getNgrokUrl();
    const webhookUrl = `${publicUrl}/webhook`;
    console.log(`[ngrok-helper] Tunnel: ${publicUrl}`);

    const client = axios.create({
      baseURL: 'https://gate.whapi.cloud',
      headers: { Authorization: `Bearer ${WHAPI_TOKEN}`, 'Content-Type': 'application/json' },
    });

    await client.patch('/settings', {
      webhooks: [{
        url: webhookUrl,
        mode: 'body',
        events: [
          { type: 'messages', method: 'post' },
          { type: 'messages', method: 'patch' },
        ],
      }],
    });

    console.log(`[ngrok-helper] Webhook registered: ${webhookUrl}`);
    console.log(`[ngrok-helper] Keeping tunnel alive. Press Ctrl+C to stop.\n`);
  } catch (err) {
    console.error(`[ngrok-helper] FAILED: ${err.message}`);
    ngrokProcess.kill();
    process.exit(1);
  }
})();

process.on('SIGINT', () => { ngrokProcess.kill(); process.exit(0); });
process.on('SIGTERM', () => { ngrokProcess.kill(); process.exit(0); });
