# Chrome Web Store Listing — QueueIt

---

## Short description (132 chars max)

Scan any page for songs and add them to your Spotify queue in one click.

---

## Long description

QueueIt scans web pages for song and artist mentions and adds them directly to your Spotify queue — no copy-pasting, no tab-switching.

**How it works**

1. Browse any music article, review, tracklist, or playlist page.
2. Click the QueueIt icon and hit Scan Page.
3. Review the detected songs, check the ones you want, and click Add to Queue.

Songs are searched on Spotify and queued instantly on your active device.

**AI Scan (optional)**

If you provide a Claude API key (Anthropic), QueueIt can use AI to detect songs that the standard text extractor misses — useful for pages with unconventional formatting.

**Privacy**

- QueueIt reads the visible text of the current page to find song mentions. No page content is stored or transmitted except as described below.
- Spotify OAuth tokens are stored locally in `chrome.storage.local` and sent only to `api.spotify.com` to queue tracks and search for songs.
- If you use AI Scan, the page's visible text is sent to `api.anthropic.com`. Your Claude API key is stored locally in `chrome.storage.local` and never shared.
- No analytics, no tracking, no third-party services beyond Spotify and optionally Anthropic.

---

## `activeTab` permission justification

*(Required field in the Chrome Web Store submission form — paste this into the "permission justification" box)*

**Permission:** `activeTab`
**Used for:** `chrome.scripting.executeScript` — reading the visible text of the current tab to detect song and artist names.

`activeTab` grants temporary access to the tab the user is viewing at the moment they click "Scan Page" or "AI Scan". Access is granted per-click and expires immediately. QueueIt does not read pages in the background and has no persistent access to any website.

**What is read:** visible text nodes from the current page's DOM (equivalent to selecting all text on the page).

**What is done with it:** song and artist names are parsed locally from the text. If the user initiates an AI Scan, the extracted text is sent to `api.anthropic.com`. No page content is sent to Spotify — only the song title and artist name are used as a search query.

**What is not done:** QueueIt does not read pages the user hasn't explicitly triggered a scan on, runs no background content scripts, and does not transmit page content to any server other than Anthropic (and only when AI Scan is used).

---

## Category

Music & Audio

## Language

English

## Privacy policy URL

*(Host PRIVACY.md at a public URL, e.g. GitHub Pages, and paste it here)*
