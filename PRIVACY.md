# Privacy Policy

**Extension:** [Extension Name]
**Last updated:** 2026-03-27

## What this extension does

[Extension Name] scans web pages you visit for song mentions and lets you add those songs to your Spotify queue.

## Data collected and stored

All data is stored locally on your device using Chrome's `chrome.storage.local` API. Nothing is sent to the developer.

| Data | Where it goes | Why |
|---|---|---|
| Spotify access token & refresh token | Your device only | Required to authenticate with the Spotify API |
| Claude API key (optional) | Your device only | Required to use the AI scan feature |

## Third-party services

When you use this extension, your browser communicates directly with:

- **Spotify API** (`api.spotify.com`) — to search for tracks and add them to your queue. Governed by [Spotify's Privacy Policy](https://www.spotify.com/legal/privacy-policy/).
- **Anthropic API** (`api.anthropic.com`) — only when you use the AI Scan feature, and only with your own API key. Page text from the tab you are scanning is sent to Anthropic for analysis. Governed by [Anthropic's Privacy Policy](https://www.anthropic.com/privacy).

## Page content

When you click "Scan Page" or "AI Scan", the extension reads the text content of the active browser tab. This text is:

- For **Scan Page**: processed entirely on your device — nothing leaves your browser.
- For **AI Scan**: sent to the Anthropic API using your own API key. Only the text of the page you choose to scan is sent.

No page content is ever sent to the developer.

## Permissions

- `activeTab` / `scripting`: to read the current tab's content when you click Scan.
- `storage`: to save your Spotify and Claude API tokens locally.
- `identity`: to run the Spotify OAuth flow.
- `tabs`: to open the Spotify dashboard and Anthropic console links.
- Access to all URLs: required so the extension can scan any page you navigate to.

## Contact

For questions or concerns, open an issue at [your GitHub repo URL].
