# WhatsApp Persona Bot: design (2026-09-16)

## Goal
Auto-reply on the owner's personal WhatsApp number, in the owner's persona, while they can't text. It must be free, human-like, multilingual (Egyptian Arabic, Franco Arabic, English), and able to research answers for contacts.

## Decisions
| Topic | Choice | Why |
|---|---|---|
| WhatsApp link | Baileys `7.0.0-rc14` (pinned), personal number | The owner wants replies from their real number. Baileys has no browser, is actively maintained, and was verified to install on Windows with Node 24. |
| Model | Local Ollama `gemma3:12b` (already at `E:\ollama-models`) | Free and private. About 5–9 s per warm reply on an RTX 4060 8 GB. `keep_alive: -1` avoids ~80 s cold loads. |
| Hosting | Owner's Windows PC + pm2 + logon scheduled task | A 12B model can't run on free cloud tiers, and a home IP carries lower ban risk than datacenter IPs. |
| Research | DuckDuckGo HTML search + fetch top 3 pages | No API key. A router call decides SEARCH vs NO first. |
| Persona | `config/style.md` (stats + ~40 real Them→Me pairs from exports) + `config/about-me.md` | Few-shot beats fine-tuning for a local 12B model. Nothing extra to train. |

## Behaviour
- Filters: skip groups, status, broadcasts and newsletters; skip messages older than 2 min; only text; reply only to allowlisted phone numbers (LID → phone number via `remoteJidAlt` / `lidMapping`).
- Human-like: 8 s burst debounce → 3–25 s "seen" delay → read receipt → typing indicator kept alive while generating → per-part typing time → up to 3 messages. `markOnlineOnConnect: false`.
- Language: the code classifies script (arabic/franco/english) and restates the target language next to the incoming message, because small models drift otherwise.
- Safety:
  - Quiet hours, a daily cap, and a global `!pause`.
  - Owner takeover: a `fromMe` message of type `notify` in a chat pauses the bot there. The bot's own sends arrive as `append` and are also tracked by ID.
  - Never commits to money, meetings or promises.
  - `[[ESCALATE: …]]` sends a note to the owner's self chat.
  - If asked whether it is a bot it sends nothing, notifies the owner and steps out of the chat.
- Failure: if Ollama is missing, the bot exits loudly at startup. A reply error notifies the owner and sends nothing to the contact. On logout it exits with code 2, which pm2 does not restart.

## Out of scope (v1)
Voice notes and images (ignored), group chats, initiating chats, and cloud hosting.

## Known limitations
- gemma3:12b sometimes flags harmless messages for escalation, which just produces an extra self-note.
- Franco spelling is imperfect until `style.md` is built from real exports.
- Ban risk remains (Meta ToS).
