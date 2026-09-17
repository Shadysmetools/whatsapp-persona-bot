// One-time Google sign-in for Calendar + Gmail. Usage: npm run google-auth
import { exec } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { CREDENTIALS_FILE, loadClient, SCOPES, TOKEN_FILE } from '../src/google.js';

if (!fs.existsSync(CREDENTIALS_FILE)) {
  console.log(`Missing ${CREDENTIALS_FILE}. See README "Email & calendar" for how to download it.`);
  process.exit(1);
}

const { client_id, client_secret } = loadClient();
const PORT = 53682;
const redirect_uri = `http://127.0.0.1:${PORT}`;
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({ client_id, redirect_uri, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent' });

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, redirect_uri).searchParams.get('code');
  if (!code) return res.end('Waiting for Google...');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id, client_secret, redirect_uri, grant_type: 'authorization_code' }),
  });
  const data = await tokenRes.json();
  if (!data.refresh_token) {
    res.end('Sign-in failed, check the terminal.');
    console.log('Sign-in failed:', data);
    process.exit(1);
  }
  fs.mkdirSync(new URL('../data', import.meta.url), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: data.refresh_token }, null, 2));
  res.end('Done! Google Calendar and Gmail are connected. You can close this tab.');
  console.log(`Saved ${TOKEN_FILE}. Restart the bot: pm2 restart whatsapp-persona-bot`);
  server.close();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Opening Google sign-in in your browser...');
  exec(`start "" "${authUrl}"`);
});
