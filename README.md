# WhatsApp Persona Bot

Replies to your WhatsApp chats **as you**, in your own texting style, while you're busy. It runs 100% free on your PC with a local Ollama model.

- Texts like you: learns your style, slang and emoji from your exported chats.
- Speaks your languages: Egyptian Arabic, **Franco Arabic** and English, matching the language and alphabet each contact uses.
- Actually helps: searches the web (DuckDuckGo, no key needed) when someone asks about prices, products, places or how-to, then answers in your voice.
- Human-like: waits before reading, shows "typing…" for a realistic time, answers a burst of messages with one reply, keeps quiet hours, and doesn't appear online all day.
- Safe by default:
  - Replies **only to contacts on your allowlist** and never in groups.
  - Never starts chats or agrees to money, meetings or promises.
  - Flags anything important to your **Message yourself** chat.
  - Steps aside for an hour when you type in a chat yourself.
  - If someone asks whether they're talking to a bot, it doesn't answer: it pings you and steps out of that chat so you reply yourself.

> ⚠️ **Ban risk.** This uses an unofficial WhatsApp Web connection ([Baileys](https://github.com/WhiskeySockets/Baileys)). That's against WhatsApp's terms, and accounts using these libraries do get banned sometimes. The bot reduces the risk (replies only, allowlist, delays, home internet) but can't remove it.

## Requirements

- Windows PC with Node.js 20+
- [Ollama](https://ollama.com) with `gemma3:12b` (about 8 GB; a GPU with 8 GB VRAM or 32 GB RAM is recommended)
  - If your models live on another drive, set **Ollama app → Settings → Model location** (e.g. `E:\ollama-models`). The tray app ignores the `OLLAMA_MODELS` environment variable. Check with `curl http://localhost:11434/api/tags`.

## Setup

```powershell
npm install
copy .env.example .env                                   # optional tweaks
copy config\allowlist.example.json config\allowlist.json # add your contacts
copy config\about-me.example.md config\about-me.md       # describe yourself
```

**1. Allowlist.** In `config/allowlist.json`, add each contact's number in international format with no `+` (e.g. `201001234567`), plus notes on who they are and how you talk. The bot re-reads this file on every message.

**2. Teach it your style.** For a few chats with lots of your messages, go to WhatsApp → open chat → ⋮ More → **Export chat** → **Without media**. Put the `.txt` files in `exports/`, then run:

```powershell
npm run persona                  # shows sender names found
npm run persona -- --me "Shady"  # use your name exactly as shown -> writes config/style.md
```

**3. Try it in the terminal** (no WhatsApp):

```powershell
npm run try -- --name Ahmed --notes "best friend, talks Franco"
```

**4. Link WhatsApp in dry-run mode first.** It connects and logs what it would reply, but sends nothing:

```powershell
npm run dry-run
```

Scan the QR code: WhatsApp → Settings → Linked devices → Link a device. Watch the log for a while.

**5. Go live:** `npm start`. To keep it running and auto-start at login, run `powershell -File scripts\install-autostart.ps1`.

## Control it from your phone

Send these in your **Message yourself** chat:

| Command | Effect |
|---|---|
| `!pause` | Stop all replies |
| `!resume` | Start again, and clear chat takeovers |
| `!status` | Show running/paused state, today's replies, quiet hours and allowlist |
| `!help` | List commands |

If you type in any chat yourself, the bot leaves that chat alone for `TAKEOVER_PAUSE_MINUTES` (default 60).

## Email & calendar (Gmail + Google Calendar)

Only you can use this, from **Message yourself** or your own "bot …" messages in a group. The bot always shows a draft first and does nothing until you reply **yes**. It never invents email addresses: if you don't write the address, it asks for it.

Examples:
- `send an email to alex@example.com saying I'll be 30 minutes late tomorrow`
- `add movie night at Hana's to my calendar tonight 8:45pm at D61 Stone Park`
- `remind me to call mom tomorrow at 5pm`

One-time setup (about 10 minutes):
1. Go to https://console.cloud.google.com, sign in with the Google account you want to use, and create a project (e.g. "whatsapp-bot").
2. **APIs & Services → Library**: enable **Google Calendar API** and **Gmail API**.
3. **APIs & Services → OAuth consent screen**: choose *Internal* (Google Workspace) or *External*. If you chose External, add your own email under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID → Desktop app**. Download the JSON and save it as `config/google-credentials.json`.
5. Run `npm run google-auth`, sign in in the browser, and allow access.
6. Run `pm2 restart whatsapp-persona-bot`.

Both files are git-ignored. To disconnect, delete `data/google-token.json` and remove the app at https://myaccount.google.com/permissions.

## Settings (`.env`)

See `.env.example`: quiet hours, daily reply cap, burst wait, takeover time, model, and `DISCLOSE_AI` (openly introduce itself as your assistant).

## Privacy

These are git-ignored and stay on your PC: `auth_info/` (your WhatsApp session, which is account-takeover material, so never share it), `exports/`, `data/` (chat memory), `config/allowlist.json`, `config/about-me.md`, `config/style.md` and `.env`.

## Development

```powershell
npm test                          # unit tests
node scripts/eval-persona.js      # sample replies from the live model
```

---

**Built by [Shady Al-Halawani](https://github.com/Shadysmetools)**, AI Product Manager & Tech Lead · [LinkedIn](https://www.linkedin.com/in/shady-al-halawani-333a5419a) · [Book a call](https://calendly.com/shady-al-halawani)
