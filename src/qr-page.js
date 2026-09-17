import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { config } from './config.js';

const page = path.join(config.dataDir, 'link-whatsapp.html');
let opened = false;

const html = (body) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Link WhatsApp</title>
<meta http-equiv="refresh" content="3">
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f0f2f5;color:#111}
main{background:#fff;padding:32px;border-radius:16px;text-align:center;max-width:420px;box-shadow:0 2px 12px #0001}
img{width:300px;height:300px}ol{text-align:left;line-height:1.6}</style></head>
<body><main>${body}</main></body></html>`;

/** Write the current QR to a self-refreshing page and open it in the browser once. */
export async function showQr(qr) {
  const dataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 1 });
  fs.writeFileSync(
    page,
    html(`<h2>Link WhatsApp</h2><img src="${dataUrl}" alt="QR code">
<ol><li>Open WhatsApp on your phone</li><li>Settings → Linked devices → Link a device</li><li>Scan this code (it refreshes automatically)</li></ol>`),
  );
  if (!opened) {
    opened = true;
    exec(`start "" "${page}"`);
  }
}

export function showConnected(user) {
  if (!fs.existsSync(page)) return;
  fs.writeFileSync(page, html(`<h2>✅ Connected</h2><p>Linked as ${user}. You can close this tab.</p>`));
}
