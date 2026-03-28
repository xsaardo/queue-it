# Publish Checklist

Tasks to complete before publishing to the Chrome Web Store.

---

## Blockers

- [x] **Fix OAuth / CLIENT_ID for public distribution**
  Lock the extension ID by generating a private key + packaging a CRX, uploading to the store to get a stable permanent ID. Register that fixed `https://FIXED_ID.chromiumapp.org/` redirect URI in the Spotify app dashboard. Remove hardcoded `CLIENT_ID` from `popup.js` or accept that one developer-owned Spotify app serves all users (valid if the extension ID is locked).

- [x] **Add extension icons**
  Create 16×16, 48×48, 128×128 PNG icons and register them in `manifest.json` under `"icons"` and `"action.default_icon"`. Required for store submission.

- [x] **Fix setup UX — remove requirement for Spotify Developer account**
  With a locked extension ID and one centralized Spotify app (#1), users should just click "Connect to Spotify" with no redirect URI setup. Remove or replace the current setup screen instructions.

- [x] **Move `processSongs` to background.js**
  Currently runs in the popup — closing the popup kills it mid-process. Refactor to send `{ type: 'PROCESS_SONGS', songs }` from the popup and do all Spotify API calls in the service worker. Popup listens for progress messages.

- [x] **Write and host a privacy policy** (PRIVACY.md — needs to be hosted at a public URL)
  Required by the Chrome Web Store. Covers: Spotify OAuth tokens stored in `chrome.storage.local`, optional Claude API key stored in `chrome.storage.local`, no data sent to any third party except Spotify API and optionally Anthropic API. Host at a public URL (GitHub Pages is fine).

---

## Significant

- [x] **Implement Spotify token refresh**
  The current PKCE flow has no refresh token handling — users must re-authenticate every hour. Store the refresh token and use Spotify's token refresh endpoint in `background.js` when the access token is expired.

- [x] **Add store description justification for `<all_urls>` permission**
  Required for arbitrary page scanning. Add a clear explanation in the store listing: what data is read, what is sent where, and why the broad permission is needed.

- [x] **Reset `scan-empty-msg` on regular scan**
  If an AI scan fails with an error message, then the user goes back and runs a regular scan with 0 results, the previous error message persists. Reset to default text at the start of `scanPage()`.

- [x] **Make second empty-state hint context-aware**
  "Try a music review, tracklist, or playlist article." should not appear when the empty state is caused by an error. Only show it for genuine zero-result scans.

---

## Polish

- [x] **Choose a real product name**
  "Boopbot Spotify" is an internal codename. Update `manifest.json` `name`, `popup.html` `<title>`, and the store listing before submitting.

- [x] **Reduce regex extractor false positives**
  The `hyphenRe` pattern matches date ranges, navigation items, filenames. Add minimum word-count checks to both sides, expand `noiseRe`, and deselect `source: 'hyphen'` results by default.

- [x] **Show a notice when results are capped at 200**
  Silent truncation is confusing. Add a banner: "Showing first 200 of N songs found." when results hit the cap.
