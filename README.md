# QueueIt

A Chrome extension that scans any webpage for songs and adds them to your Spotify queue — no copy-pasting, no tab-switching.

## Features

- **Smart extraction** — 13 detection strategies: JSON-LD/Schema.org, YouTube metadata, Bandcamp, SoundCloud, Pitchfork, Resident Advisor, RateYourMusic, Reddit (r/listentothis, r/Music), Last.fm, Setlist.fm, Apple Music, Spotify Web, and generic text patterns
- **AI-enhanced scanning** — optionally use Claude, OpenAI, GPT, Gemini, or OpenRouter for harder-to-parse pages
- **Spotify integration** — OAuth 2.0 with PKCE, auto-search, and queue addition via the Spotify Web API
- **Privacy-first** — page content is never stored; AI scans only send content when you explicitly initiate them

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` and enable **Developer mode**
3. Click **Load unpacked** and select the `queue-it/` directory
4. Click the QueueIt icon in your toolbar and connect your Spotify account

## Usage

1. Navigate to any page with songs (music blog, review, Reddit thread, setlist, etc.)
2. Click the QueueIt icon and press **Scan Page**
3. Select the songs you want and click **Add to Queue**

For pages with unstructured content, use **AI Scan** — you'll be prompted to enter an API key the first time (stored in session storage, cleared when the extension closes).

## Example Sites

Works well on pages like:

- [Metallica setlist — Ticketmaster Blog](https://blog.ticketmaster.com/metallica-setlist/)
- [The 5 Best Songs of the Week — Stereogum](https://stereogum.com/2492073/the-5-best-songs-of-the-week-617/lists/the-5-best-songs-of-the-week)
- [Vinylogue: Carl Craig — Discogs](https://www.discogs.com/digs/features/vinylogue-carl-craig/)
- [Best Rap Songs of 2025 — Pitchfork](https://pitchfork.com/features/lists-and-guides/best-rap-songs-2025/)
- [RA Features](https://ra.co/features/4493)
- [Simple Plan setlists — Setlist.fm](https://www.setlist.fm/setlists/simple-plan-53d68fa9.html?page=2)

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
