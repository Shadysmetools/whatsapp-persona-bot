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
  - Never denies being your assistant when someone sincerely asks.

> ⚠️ **Ban risk.** This uses an unofficial WhatsApp Web connection ([Baileys](https://github.com/WhiskeySockets/Baileys)). That's against WhatsApp's terms, and accounts using these libraries do get banned sometimes. The bot reduces the risk (replies only, allowlist, delays, home internet) but can't remove it.

## Requirements

- Windows PC with Node.js 20+
- [Ollama](https://ollama.com) with `gemma3:12b` (about 8 GB; a GPU with 8 GB VRAM or 32 GB RAM is recommended)

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

## Settings (`.env`)

See `.env.example`: quiet hours, daily reply cap, burst wait, takeover time, model, and `DISCLOSE_AI` (openly introduce itself as your assistant).

## Privacy

These are git-ignored and stay on your PC: `auth_info/` (your WhatsApp session, which is account-takeover material, so never share it), `exports/`, `data/` (chat memory), `config/allowlist.json`, `config/about-me.md`, `config/style.md` and `.env`.

## Development

```powershell
npm test                          # unit tests
node scripts/eval-persona.js      # sample replies from the live model
```
