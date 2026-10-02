# Second Start – WhatsApp Job & Housing Assistant

An AI-powered WhatsApp bot that helps people whose partner has just accepted a job in Abu Dhabi find work there themselves.

The bot holds a short conversation to learn the person's name, profession and languages (or reads their PDF CV), license and visa status, their partner's employer and their housing situation. It then recommends the best-matching jobs from its database and, if they haven't rented a home yet, neighborhoods that fit their budget and commute limit. On request, it researches online the licenses, certifications and legal requirements for the chosen job.

- **WhatsApp gateway:** [UltraMsg](https://ultramsg.com)
- **AI:** OpenAI (`gpt-5.5`)
- **Server:** Plain PHP, no dependencies. Runs on PHP 5.5 and later.

## How it works

```
User ──WhatsApp──> UltraMsg ──webhook (POST)──> webhook.php
                                                    │
                property_dump.json ─────────────────┤
                jobs_with_commute_times.json ───────┤
                                                    ▼
                                              OpenAI (gpt-5.5)
                                                    │
User <──WhatsApp── UltraMsg <──/messages/chat───────┘
```

1. The user taps **Görüşme Başlat** ("Start conversation") on [index.html](index.html). WhatsApp opens with this pre-filled message:
   > Hi Second Start — my partner just accepted a job in Abu Dhabi and I'm looking for work. Can you help?
2. UltraMsg forwards incoming messages to `webhook.php`. The bot **only starts a conversation on this trigger message**; it ignores other messages and all group messages.
3. The conversation history, both databases and the flow instructions are sent to OpenAI, and the reply is sent back to the user through UltraMsg.
4. A conversation closes after 24 hours without messages; the trigger message is needed to start again.

## Conversation flow

The detailed flow is described (in Turkish) in [akis.md](akis.md). The bot always replies in **English**, stays polite, and asks one question per message:

1. **Name:** Congratulates them on their partner's new job and asks for their name.
2. **Profession and languages:** Asks about their profession, experience and languages, and offers to read their CV as a PDF instead.
3. **Confirmation:** Briefly sums up what it learned and asks them to confirm.
4. **License:** Asks whether they hold the license their profession requires (ADEK for teachers, DoH for healthcare professionals).
5. **Visa:** Asks whether they have their own visa or are coming on their partner's family visa.
6. **Partner's employer:** Asks which company their partner will work for.
7. **Housing:** Asks whether they have already rented a home.
   - **Already rented:** asks only for the neighborhood, and never recommends housing.
   - **Not yet:** asks for the number of bedrooms and their annual rent budget.
8. **Commute:** Asks for their maximum morning commute in minutes.
9. **Results:** 2–3 matching jobs (with apply link and deadline) and, if needed, 2–3 matching neighborhoods.
10. **Application help:** If they want, researches online the legal requirements, licenses and certifications for the chosen job.

To change the flow, edit `build_system_prompt()` in `webhook.php` and the short reminder added before every reply (`turn_reminder()`).

## Files

| File | Purpose |
|---|---|
| [webhook.php](webhook.php) | The bot itself: the webhook UltraMsg calls. |
| [index.html](index.html) | Landing page with the "start conversation" button. |
| [jobs_with_commute_times.json](jobs_with_commute_times.json) | 60 job openings (teaching, healthcare, marketing) with morning/evening driving times from 10 neighborhoods. |
| [property_dump.json](property_dump.json) | Approximate annual rent ranges (AED) for 1–3 bedroom homes in 10 neighborhoods. |
| [akis.md](akis.md) | Conversation flow specification (Turkish). |
| [project.MD](project.MD) | Original project notes (Turkish). |
| `config.example.php` | Example settings file. |
| `config.php` | **Secrets. Not in the repository**; it only lives on the server. |
| `webhook_test.php` | Test version without AI: asks the sender for their name. Useful for checking the connection. |
| `conversations/` | Conversation histories and log. **Not in the repository.** |

## Setup

### 1. Server

- PHP 5.5 or later with the `curl` extension.
- The web server needs write access to the `conversations/` folder.
- The webhook URL must be reachable from the internet (e.g. `https://example.com/whatsapp_bot/webhook.php`).

### 2. Settings

Copy `config.example.php` to `config.php` and fill it in:

```php
define('ULTRAMSG_INSTANCE', 'instanceXXXXXX');   // UltraMsg instance ID
define('ULTRAMSG_TOKEN', '...');                 // UltraMsg token
define('OPENAI_API_KEY', 'sk-...');              // OpenAI API key
```

> ⚠️ **Never commit `config.php`.** OpenAI automatically revokes API keys it finds in public GitHub repositories, and anyone with the UltraMsg token can send messages from your number. The file is excluded in `.gitignore`, but take care when uploading files manually.

### 3. UltraMsg

In the UltraMsg dashboard (Instance → Settings):

- **Webhook URL:** the full URL of `webhook.php`.
- **Webhook on Received** (`webhook_message_received`): **must be enabled**, otherwise the bot receives nothing.

### 4. Testing

1. To check the connection, you can first point the UltraMsg webhook to `webhook_test.php`: messaging the number should get a reply asking for your name.
2. Then point it to `webhook.php` and start a conversation with the button on `index.html` (or by typing the trigger message).

## Configuration

Constants at the top of `webhook.php`:

| Constant | Default | Description |
|---|---|---|
| `OPENAI_MODEL` | `gpt-5.5` | Model for the chat and CV reading. |
| `OPENAI_SEARCH_MODEL` | `gpt-5.5` | Model for the online research in the application-help step. |
| `TRIGGER_TEXT` | "Hi Second Start — …" | The message that starts a conversation. Must match the message in `index.html`. |
| `CONVERSATION_TTL_SECONDS` | 86400 (24 h) | A conversation closes after this long without messages. |
| `MAX_HISTORY_MESSAGES` | 40 | Maximum number of messages sent to the AI. |
| `MAX_CV_BYTES` | 8 MB | Largest accepted PDF CV. |

If you change the trigger message, also update the (URL-encoded) WhatsApp link in `index.html`.

## Technical notes

- **Databases:** The jobs file is about 500 KB, too large to send as is. `build_jobs_summary()` turns it into short lines with only the needed fields (title, employer, area, deadline, license, visa, apply link, and commute times labeled by neighborhood). The rent file is sent as is.
- **PDF CVs:** When UltraMsg notifies the webhook about a file, the file URL is often still empty. The webhook then reads the message from the UltraMsg API (`/chats/messages`) a few seconds apart. This request must use a **small limit**: UltraMsg leaves out file URLs entirely for larger lists such as `limit=20`. After downloading, the PDF is summarized once by OpenAI and only the summary is added to the conversation.
- **Online research:** In the application-help step the model calls the `research_job_requirements` tool, which searches the web through the OpenAI Responses API `web_search` tool. This step can take 20–40 seconds.
- **Immediate response:** The webhook returns `200 OK` to UltraMsg right away and keeps processing in the background. If the same message arrives twice, the second one is ignored.
- **WhatsApp formatting:** Markdown from the AI such as `**bold**` and `[text](link)` is converted to WhatsApp formatting.

## Security and personal data

- Conversation histories (`*.json.php`) and the log (`webhook.log.php`) are stored in `conversations/`. These files have a `.php` extension and start with a line that stops PHP execution, so their content isn't shown even if someone opens them in a browser. (This approach is used because the server doesn't apply `.htaccess` files.)
- Conversations contain personal data such as names, CV summaries and visa status. This folder is never committed.
- The bot's number may be in WhatsApp groups; group messages are neither processed nor logged.
- `webhook_test.php` uses the old approach and writes every incoming request to a publicly readable `webhook.log`. Use it only for short tests and remove it from the server afterwards.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| No replies at all | "Webhook on Received" is disabled in UltraMsg, the webhook URL is wrong, or `config.php` is missing on the server. An empty POST to the webhook URL should return `OK`. |
| No reply to the first message | The message doesn't match the trigger message, or a previous conversation is still open. |
| "Technical issue" reply | OpenAI error: the key may be revoked or out of credit. Check the log. |
| PDF can't be read | Look for "Dosya adresi ... alinamadi" (file URL not found) or "Dosya indirilemedi" (download failed) in the log. |

Log file: `conversations/webhook.log.php` on the server (open it via FTP or a file manager; ignore the first line). Log messages are in Turkish.
