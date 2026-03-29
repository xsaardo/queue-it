# Security Issues

## High

### 1. Claude API key stored in plaintext
- [x] **Fix**

**File:** `popup.js:48`

`chrome.storage.local` is unencrypted on disk. Any other extension with `storage` permission, or anyone with local disk access, can read `claudeApiKey`. This is a real risk since the key has billing implications.

**Fix:** Make the Claude API call from `background.js` (like Spotify auth) so the key is handled only in the service worker context, not the popup's JS context.

---

### 2. Claude API call made from popup, not background
- [x] **Fix**

**File:** `popup.js:60`

The fetch to `api.anthropic.com` is initiated directly from the popup. The key is therefore accessible in the popup's JS context. Delegating this to `background.js` would isolate credential handling to the service worker.

---

## Medium

### 3. Raw page content sent to Anthropic without user warning
- [x] **Fix**

**File:** `popup.js:78`

AI Scan sends up to 12,000 characters of arbitrary page text to `api.anthropic.com`. If the user scans a page containing sensitive information (banking, medical, private notes), that content leaves the browser. There is no disclosure in the UI.

**Fix:** Add a warning before the first AI scan explaining that page content is sent to Anthropic's API.

---

### 4. `JSON.parse` on unvalidated AI response
- [x] **Fix**

**File:** `popup.js:93`

Claude's raw response is parsed with `JSON.parse(match[0])` without a try/catch. A malformed or unexpected response will throw an unhandled exception. The `.filter()` on line 95 provides some defense downstream but doesn't prevent the parse from failing.

**Fix:** Wrap the `JSON.parse` in a try/catch and return `[]` on failure.

---

### 5. Broad `<all_urls>` host permission
- [x] **Fix**

**File:** `manifest.json:9`

Required for injecting `extractor.js` into arbitrary pages, but this grants the extension the ability to read the DOM of every site the user visits. Chrome surfaces this as "This extension can read and change all your data on all websites," which is a significant trust ask and a large attack surface if the extension were compromised.

---

## Low

### 6. `key.pem` present in repository
- [x] **Fix**

The extension signing key is present in the working directory and may be tracked by git. If this key is exposed (e.g. pushed to a public remote), someone could publish updates impersonating the extension.

**Fix:** Add `key.pem` to `.gitignore` and store it outside the repo (e.g. a password manager or secrets vault).

---

### 7. No explicit Content Security Policy
- [x] **Fix**

**File:** `manifest.json`

MV3 has a default CSP but no explicit `content_security_policy` is declared. Explicitly setting one (restricting script sources, disallowing `eval`) provides defense in depth.

---

### 8. Unbounded `notFound` array written to storage on every iteration
- [x] **Fix**

**File:** `background.js:112`

`processingState` (including the `notFound` array) is written to storage on every song iteration. On a 200-song page where all songs fail, this means 200 storage writes of a progressively larger object.

**Fix:** Defer writing `notFound` to the final `done` state only, and write a counter during processing.

---

## Critical

### 9. No guard against concurrent `authenticate()` or `processSongs()` calls
- [x] **Fix**

**File:** `background.js` message listener; `popup.js:362`

The connect button disables itself in the popup DOM, but the service worker's `onMessage` handler has no lock. If the popup is closed and reopened mid-auth, a second auth flow starts — creating two `tabs.onUpdated` listeners with different PKCE verifiers, both of which are leaked if the first wins. Similarly, rapid double-clicks on "Add to Queue" launch two concurrent `processSongs` loops that both call `addToQueue`, queueing every track twice.

**Fix:** Add a module-level boolean flag in `background.js` (`authInProgress`, `processingInProgress`) and reject duplicate requests while one is active.

---

### 10. `tabs.onUpdated` listener not scoped to auth window tab
- [x] **Fix**

**File:** `background.js` — OAuth flow

The `tabs.onUpdated` listener registered during OAuth checks only that `changeInfo.url?.startsWith(redirectUri)` — it does not verify the event is from the auth window's own tab. If two auth flows are in flight simultaneously (see above), the first redirect event matching the URI will be consumed by whichever listener registered first, resolving the wrong promise with the wrong PKCE verifier.

**Fix:** Record the auth window's tab ID and guard: `if (tab.windowId !== authWindowId) return;`

---

## High (additional)

### 11. `PROCESS_SONGS` IPC payload not validated
- [x] **Fix**

**File:** `background.js:196`

`msg.songs` is passed directly to `processSongs()` with no checks — not whether it's an array, not its length, not whether `artist`/`title` are strings. An array of 10,000 items would trigger 10,000+ Spotify API calls and a correspondingly huge `processingState` written to storage. While Chrome MV3 only delivers `onMessage` from same-extension contexts, defense in depth requires input validation at every trust boundary.

**Fix:** Validate before processing:
```js
if (!Array.isArray(msg.songs) || msg.songs.length > 200) return sendResponse({ ok: false });
for (const s of msg.songs) {
  if (typeof s?.title !== 'string' || typeof s?.artist !== 'string') return sendResponse({ ok: false });
}
```

---

### 12. `innerHTML` used with storage-derived values on result screen
- [x] **Fix**

**File:** `popup.js:261`

```js
summary.innerHTML = `<strong>${state.foundCount}</strong> tracks queued…`
```

`state` is read from `chrome.storage.local`. If `state.foundCount` is tampered to contain an HTML string, it is injected directly into the DOM. Expected to be an integer, but not enforced.

**Fix:** Coerce to integer (`Number(state.foundCount) | 0`) before interpolation, or build the DOM with `createElement`/`textContent` instead of `innerHTML`.

---

### 13. Third-party API error strings surfaced verbatim to the user
- [x] **Fix**

**File:** `popup.js:273` → `handleError` → `$('result-summary').textContent`

Spotify API error messages (server-controlled strings) flow from `background.js` → `processingState.error` → popup UI without sanitization. A crafted Spotify error response could display a misleading message (e.g. a phishing URL) to the user. Even though `textContent` prevents HTML injection, the trust boundary is violated.

**Fix:** Truncate and genericize error messages before storing in `processingState`. Log the raw API error to the console only.

---

### 14. `scanState.confidence` unvalidated when restored from storage
- [x] **Fix**

**File:** `popup.js:214`

```js
dot.className = `dot ${c.confidence}`;
```

`confidence` is read from `chrome.storage.local` (via the persisted `scanState`) and used directly as a CSS class name. A malicious page could craft content that passes the extractor's filters with a `confidence` value like `"high malicious-class"`, which would be written to storage and applied to the DOM on next open.

**Fix:** Allowlist the value: `dot.className = \`dot ${'high medium low'.includes(c.confidence) ? c.confidence : 'low'}\`;`

---

## Medium (additional)

### 15. PKCE verifier lost if service worker is terminated mid-auth
- [x] **Fix**

**File:** `background.js` — `authenticate()`

The PKCE `verifier` lives only in the closure of `authenticate()`. MV3 service workers can be killed by Chrome at any time. If terminated after the auth window opens but before the redirect is handled, the verifier is gone and the auth silently fails with no recovery path.

**Fix:** Persist `verifier` to `chrome.storage.session` before opening the auth window, and read it back in the redirect handler.

---

### 16. AI consent flag cannot be revoked, and has no version
- [x] **Fix**

**File:** `popup.js` — `aiScanConsented`

`aiScanConsented: true` is stored permanently — it's not cleared on disconnect, and there's no UI to revoke it. Additionally, it's a bare boolean with no version number, so if the consent disclosure text changes in a future version, existing users won't be re-prompted.

**Fix:** Clear it in `clearToken()`. Store a versioned object: `{ version: 1, timestamp: Date.now() }` so future consent text changes can invalidate old consent.

---

### 17. `tabs` permission exposes all open tab URLs
- [ ] **Deferred** — `chrome.identity.launchWebAuthFlow` opens an unresizeable full Chrome window; keeping the manual popup approach (480×700) requires `tabs`. Revisit if UX requirements change.

**File:** `manifest.json`

The `tabs` permission grants access to `url` and `title` for all open tabs — not just the active one. This is needed for the custom OAuth window flow, but if the extension were compromised, it would allow real-time enumeration of all browsing activity. `chrome.tabs.create` (used to open the Anthropic console link) does not require `tabs`.

**Fix:** Replace the custom OAuth window/tab flow with `chrome.identity.launchWebAuthFlow`, which handles all of this natively and eliminates the need for the `tabs` permission and global `tabs.onUpdated` listener entirely.

---

### 18. No handling for Spotify 429 rate limit responses
- [x] **Fix**

**File:** `background.js` — `spotifyFetch`, `processSongs`

HTTP 429 responses from Spotify are treated the same as any other error — the song is added to `notFound` and processing continues. This means rate-limited tracks are reported as "not found" (false negative), and the extension continues hammering the API even while being throttled.

**Fix:** Check `res.status === 429`, read the `Retry-After` header, and implement backoff with a retry.

---

### 19. Missing `connect-src` in Content Security Policy
- [x] **Fix**

**File:** `manifest.json` — `content_security_policy`

The declared CSP restricts `script-src` and `object-src` but omits `connect-src`. Without it, popup-context JavaScript can fetch any origin (subject to host permissions). An XSS in the popup could exfiltrate stored tokens to an arbitrary destination.

**Fix:**
```json
"extension_pages": "script-src 'self'; object-src 'none'; connect-src https://api.spotify.com https://accounts.spotify.com https://api.anthropic.com;"
```

---

### 20. `getPageTextForAI` captures hidden and off-screen DOM content
- [x] **Fix**

**File:** `extractor.js` — `getPageTextForAI`

The function strips `nav`, `footer`, `header`, `aside`, etc. but does not remove `[aria-hidden="true"]`, `[hidden]`, `<template>`, or `display:none` elements. On sensitive pages (banking, healthcare portals), hidden DOM nodes may contain pre-populated account data or session metadata the user cannot see and would not expect to be sent to Anthropic.

**Fix:** Extend the skip selector to include: `[aria-hidden="true"], template, [hidden]`.

---

## Low (additional)

### 21. Stuck `running` state if service worker is killed mid-processing
- [x] **Fix**

**File:** `background.js` / `popup.js:376`

If Chrome kills the service worker during `processSongs`, `processingState` remains `{ status: 'running' }` forever. The popup reopens to an infinite progress screen with no escape.

**Fix:** Write a `startedAt` timestamp to `processingState`. On popup init, if the state is `running` and `Date.now() - state.startedAt > 10 minutes`, treat it as stale and clear it.

---

### 22. `expires_in` from token exchange not validated
- [x] **Fix**

**File:** `background.js:54` and `background.js:209`

`expires_in` is used with inconsistent coercion (`* 1000` vs `parseInt(...) * 1000`). If Spotify returns `null` or a negative value, `expiresAt` becomes `NaN` or a past timestamp, causing `getStoredToken` to return `null` on every call and hammering the refresh endpoint on every API request.

**Fix:** Validate before use: `const expiresIn = parseInt(token.expires_in, 10); if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('Invalid token expiry');`

---

### 23. Stale tokens not cleared on refresh failure
- [x] **Fix**

**File:** `background.js` — `doRefreshToken`

When token refresh fails with a non-retryable error (e.g. 400 from Spotify, indicating a revoked refresh token), the stale `accessToken` and `refreshToken` remain in storage indefinitely. On disk, these can be read by anyone with filesystem access.

**Fix:** On a 400 response from the refresh endpoint, call `chrome.storage.local.remove(['accessToken', 'expiresAt', 'refreshToken'])` before returning `null`.

---

### 24. Restored `scanState.selected` indices not bounds-checked
- [x] **Fix**

**File:** `popup.js:383`

`selectedIndices` is restored from storage without checking that each value is a valid integer within `candidates` bounds. An out-of-bounds index causes `scanCandidates[i]` to return `undefined`, which is then passed to `processSongs` and causes a `TypeError` on `song.artist`.

**Fix:** Filter on restore:
```js
selectedIndices = new Set(
  (stored.scanState.selected || []).filter(i =>
    Number.isInteger(i) && i >= 0 && i < stored.scanState.candidates.length
  )
);
```

---

### 25. `key` field should be removed before Chrome Web Store submission
- [ ] **Fix** (defer until CWS submission)

**File:** `manifest.json`

The `"key"` field pins the extension ID during development. It is unnecessary in a published package (the Web Store assigns a stable ID from the uploaded CRX's signing key) and pre-announces the extension ID, which could allow a bad actor to pre-register a lookalike extension targeting the same ID before publication.

**Fix:** Remove the `"key"` field before submitting to the Chrome Web Store.
