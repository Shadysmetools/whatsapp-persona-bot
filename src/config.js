import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = (key, fallback) => process.env[key] ?? fallback;
const num = (key, fallback) => Number(env(key, fallback));
const bool = (key, fallback) => String(env(key, fallback)).toLowerCase() === 'true';

export const config = {
  ownerName: env('OWNER_NAME', 'Shady'),
  ollamaUrl: env('OLLAMA_URL', 'http://localhost:11434'),
  model: env('OLLAMA_MODEL', 'gemma3:12b'),
  numCtx: num('NUM_CTX', 8192),
  historyTurns: num('HISTORY_TURNS', 20),
  research: bool('RESEARCH_ENABLED', 'true'),
  discloseAi: bool('DISCLOSE_AI', 'false'),
  quietStart: num('QUIET_HOURS_START', 1),
  quietEnd: num('QUIET_HOURS_END', 9),
  dailyCap: num('DAILY_REPLY_CAP', 150),
  burstWaitMs: num('BURST_WAIT_SECONDS', 8) * 1000,
  takeoverMs: num('TAKEOVER_PAUSE_MINUTES', 60) * 60_000,
  dryRun: process.argv.includes('--dry-run'),
  authDir: path.join(ROOT, 'auth_info'),
  dataDir: path.join(ROOT, 'data'),
  configDir: path.join(ROOT, 'config'),
};

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** Re-read on every call so edits apply without restarting the bot. */
export function loadAllowlist() {
  const file = path.join(config.configDir, 'allowlist.json');
  if (!fs.existsSync(file)) return [];
  const { contacts = [] } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return contacts.map((c) => ({ ...c, number: String(c.number).replace(/\D/g, '') }));
}

export function loadPersona() {
  return {
    aboutMe: readIfExists(path.join(config.configDir, 'about-me.md')).trim(),
    style: readIfExists(path.join(config.configDir, 'style.md')).trim(),
  };
}
