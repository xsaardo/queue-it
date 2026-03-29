# Privacy Policy

**Extension:** QueueIt
**Last updated:** 2026-03-28

## What this extension does

QueueIt scans web pages you visit for song mentions and lets you add those songs to your Spotify queue.

## Data collected and stored

Nothing is sent to the developer. Data is stored on your device only.

| Data | Storage | Why |
|---|---|---|
| Spotify access token & refresh token | `chrome.storage.local` (persisted) | Required to authenticate with the Spotify API |
| AI API key (optional) | `chrome.storage.session` (cleared on extension close) | Required to use the AI Scan feature |

## Third-party services

When you use this extension, your browser communicates directly with:

- **Spotify API** (`api.spotify.com`) — to search for tracks and add them to your queue. Governed by [Spotify's Privacy Policy](https://www.spotify.com/legal/privacy-policy/).
- **Anthropic API** (`api.anthropic.com`) — only when you use AI Scan with a Claude API key. Governed by [Anthropic's Privacy Policy](https://www.anthropic.com/privacy).
- **OpenAI API** (`api.openai.com`) — only when you use AI Scan with an OpenAI API key. Governed by [OpenAI's Privacy Policy](https://openai.com/policies/privacy-policy).
- **Google Gemini API** (`generativelanguage.googleapis.com`) — only when you use AI Scan with a Gemini API key. Governed by [Google's Privacy Policy](https://policies.google.com/privacy).
- **OpenRouter** (`openrouter.ai`) — only when you use AI Scan with an OpenRouter API key. Governed by [OpenRouter's Privacy Policy](https://openrouter.ai/privacy).

## Page content

When you click "Scan Page" or "AI Scan", the extension reads the text content of the active browser tab. This text is:

- For **Scan Page**: processed entirely on your device — nothing leaves your browser.
- For **AI Scan**: sent to your chosen AI provider using your own API key. Only the text of the page you choose to scan is sent.

No page content is ever sent to the developer.

## Permissions

- `activeTab` / `scripting`: to read the current tab's content when you click Scan.
- `storage`: to save your Spotify tokens and AI API key locally.
- `tabs`: to open the Spotify auth page and AI provider console links.
- Host permissions for `api.spotify.com`, `accounts.spotify.com`, and AI provider endpoints: limited to only the services this extension uses.

## Contact

For questions or concerns, open an issue at https://github.com/xsaardo/queue-it.
