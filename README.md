<h1><img src="icons/icon128.png" alt="" width="40" /> QueueIt</h1>

A Chrome extension that scans any webpage for songs and adds them to your Spotify queue — no copy-pasting, no tab-switching.

## Features

- **Smart extraction** — 13 detection strategies: JSON-LD/Schema.org, YouTube metadata, Bandcamp, SoundCloud, Pitchfork, Resident Advisor, RateYourMusic, Reddit (r/listentothis, r/Music), Last.fm, Setlist.fm, Apple Music, Spotify Web, and generic text patterns
- **AI-enhanced scanning** — optionally use Claude, OpenAI, GPT, Gemini, or OpenRouter for harder-to-parse pages
- **Context menu** — highlight any text, right-click, and choose **AI Scan with QueueIt** to scan just that selection
- **Spotify integration** — OAuth 2.0 with PKCE, auto-search, and queue addition via the Spotify Web API
- **Privacy-first** — page content is never stored; AI scans only send content when you explicitly initiate them

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` and enable **Developer mode**
3. Click **Load unpacked** and select the `queue-it/` directory
4. Click the QueueIt icon in your toolbar and connect your Spotify account

## Self-Hosting with Your Own Spotify App

Spotify restricts apps in development mode to 25 users. To use QueueIt beyond that limit, create your own Spotify app and plug in your own client ID. This takes about 5 minutes.

**Step 1 — Find your extension ID**

After loading the extension, copy the ID shown under the extension name in `chrome://extensions/` — it looks like `abcdefghijklmnopabcdefghijklmnop`.

> The `key` field in `manifest.json` locks the extension ID so it stays the same every time you load it, on any machine. Leave that field as-is.

**Step 2 — Create a Spotify app**

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in
2. Click **Create app** and fill in the form:
   - **Redirect URI**: `https://YOUR_EXTENSION_ID.chromiumapp.org/` (use the ID from Step 1)
   - **Which API/SDKs are you planning to use?**: check **Web API**
3. Click **Settings** on the app page and copy your **Client ID**

**Step 3 — Update the client ID**

Open `background.js` and replace line 3:

```js
const CLIENT_ID = 'your_client_id_here';
```

**Step 4 — Reload the extension**

Click the refresh icon on the QueueIt card in `chrome://extensions/`. Done.

> If you need more than 25 users, apply for a [Spotify quota extension](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

## Usage

1. Navigate to any page with songs (music blog, review, Reddit thread, setlist, etc.)
2. Click the QueueIt icon and press **Scan Page**
3. Select the songs you want and click **Add to Queue**

For pages with unstructured content, use **AI Scan** — you'll be prompted to enter an API key the first time (stored in session storage, cleared when the extension closes).

You can also highlight any text on a page, right-click, and choose **AI Scan with QueueIt** to scan just that selection without opening the full popup first.

## Example Sites

Works well on pages like:

- [Metallica setlist — Ticketmaster Blog](https://blog.ticketmaster.com/metallica-setlist/)
- [The 5 Best Songs of the Week — Stereogum](https://stereogum.com/2492073/the-5-best-songs-of-the-week-617/lists/the-5-best-songs-of-the-week)
- [Vinylogue: Carl Craig — Discogs](https://www.discogs.com/digs/features/vinylogue-carl-craig/)
- [Best Rap Songs of 2025 — Pitchfork](https://pitchfork.com/features/lists-and-guides/best-rap-songs-2025/)
- [RA Features](https://ra.co/features/4493)
- [Simple Plan setlists — Setlist.fm](https://www.setlist.fm/setlists/simple-plan-53d68fa9.html?page=2)
- [r/electronicmusic — Reddit](https://www.reddit.com/r/electronicmusic/)

## AI Providers

| Provider | Key required |
|---|---|
| Anthropic Claude | Yes (from console.anthropic.com) |
| OpenAI | Yes (from platform.openai.com) |
| Google Gemini | Yes (from aistudio.google.com) |
| OpenRouter | Yes (from openrouter.ai) |

## Permissions

| Permission | Why |
|---|---|
| `activeTab` + `scripting` | Read visible page text when you click Scan |
| `storage` | Persist Spotify tokens locally |
| `tabs` | Open Spotify auth and provider console links |
| Host permissions | Limited to Spotify API, auth endpoints, and chosen AI provider |

## Privacy

- Spotify tokens are stored locally on your device and sent only to `api.spotify.com`
- AI API keys are stored in session storage and cleared when the extension closes
- Page content is processed locally or sent to your chosen AI provider only when you initiate an AI scan
- No analytics or third-party tracking

See [PRIVACY.md](PRIVACY.md) for the full policy.

## Security

This extension has undergone a comprehensive security audit. See [SECURITY.md](SECURITY.md) for details.
