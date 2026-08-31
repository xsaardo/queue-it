---
title: Non-AI Quick Queue from Selection
type: feat
status: active
date: 2026-08-30
origin: docs/brainstorms/2026-08-30-quick-queue-brainstorm.md
---

# Non-AI Quick Queue from Selection

## Overview

Add a second context-menu action — "Add to Queue with QueueIt" — that lets a
user highlight a song/artist pair on any webpage and queue it to Spotify
using only local regex parsing, no AI provider call. It's a sibling to the
existing "AI Scan with QueueIt" menu item (`background.js:441-469`), reusing
the same selection-capture and popup-handoff plumbing but skipping the LLM
round trip.

## Problem Statement / Motivation

Today the only "highlight text → queue" path goes through `AI_SCAN`
(`background.js:515-520`, `extractSongsWithAI` at `background.js:~390-428`),
which requires the user to have configured an API key for a paid AI
provider. For the common case — text that's already in a clean
"Artist - Title" shape — that's overhead for zero benefit. `extractor.js`
already contains proven regex heuristics for exactly this shape (the
"Generic text pattern matching" tier at `extractor.js:206-244`: em dash,
`by`-pattern, and hyphen matchers). This plan reuses that pattern logic
against the plain selection string instead of the DOM.

## Proposed Solution

1. **New context menu item**, sibling to `ai-scan-selection`:
   `chrome.contextMenus.create({ id: 'quick-queue-selection', title: 'Add to Queue with QueueIt', contexts: ['selection'] })`
   in the same `chrome.runtime.onInstalled` handler (`background.js:440-446`).

2. **New click handler** in `chrome.contextMenus.onClicked`
   (`background.js:448-469`) for `quick-queue-selection`:
   - Grab the full selection via the same injected
     `() => window.getSelection().toString().trim().slice(0, 15000)` pattern
     already used for `ai-scan-selection`.
   - Run it through a new local parser, `parseQuickQueueSelection(text)`
     (new function in `background.js`, next to `extractSongsWithAI`).
   - Store the result in `chrome.storage.session.set({ pendingQuickQueue: { candidates } })`
     and call `chrome.action.openPopup()` — mirrors the existing
     `pendingAiScan` handoff exactly (`background.js:465-468`).

3. **New parser function** `parseQuickQueueSelection(text)`:
   - Splits the selection into lines, trims each, and tries (in order) the
     same three regexes already proven in `extractor.js:222-243`:
     em dash/en dash (`^(.{1,70}?)\s[–—]\s(.{1,120})$`), `by`-pattern
     (`^[""']?(.{1,80}?)[""']?\s+by\s+(.{1,60})$`), and plain hyphen with the
     existing "no sentence punctuation, ≤7 words" artist heuristic.
   - Applies the same `clean()` / de-dupe / length-sanity rules as `add()`
     in `extractor.js:13-30` (duplicated here since this file has no access
     to `extractor.js` — see Technical Considerations).
   - Returns `Array<{artist, title, confidence: 'high'|'medium', source: 'quick-queue'}>`,
     capped at 50 entries (a highlighted selection, unlike a full page, won't
     realistically exceed this).

4. **Popup handling** (`popup.js`), mirroring the existing `pendingAiScan`
   handling at boot (`popup.js:443-474`) and via `chrome.storage.onChanged`
   (`popup.js:431-441`):
   - On seeing `pendingQuickQueue`, remove it from session storage, then:
     - **0 candidates** → `showScreen('scan')`, set
       `$('scan-heading').textContent = 'No song detected'` and
       `$('scan-empty-msg').textContent = 'Try highlighting text like "Artist - Title."'`,
       `show('scan-empty')`. (Same empty-state elements `doAiScan` already
       uses on failure, just different copy.)
     - **1 candidate** → skip the review screen entirely: call the same code
       path as the existing "Add to Queue" button
       (`chrome.runtime.sendMessage({ type: 'PROCESS_SONGS', songs: [candidate] })`
       plus the `showScreen('progress')` setup currently inlined in the
       `scan-queue-btn` handler, `popup.js:409-417`) — factor that setup into
       a small `startProcessing(songs)` helper shared by both call sites.
     - **2+ candidates** → `lastResultContext = 'scan'; showScanResults(candidates)`,
       i.e. exactly the existing review/select/queue flow
       (`popup.js:197-217`), unchanged.

## Technical Considerations

- **Why the parser isn't a refactor of `extractSongsFromPage`:** that
  function queries `document` and is injected into the *page's* context via
  `chrome.scripting.executeScript` (`popup.js:126-129`); it must stay
  self-contained with no outside references (see the doc comment at
  `extractor.js:1-8`). The new parser operates on a plain string already
  extracted from the selection and runs in the **background service
  worker**, which has no DOM and does not currently load `extractor.js`
  (only `popup.html:139` does). So the regex logic is duplicated in
  `background.js` rather than shared — acceptable duplication given it's
  three small regexes, flagged in code comments pointing at the
  `extractor.js` origin so both stay in sync if the patterns are ever tuned.
- **Architecture impact:** none — no new permissions, no new host
  permissions, no manifest changes beyond nothing (context menu API is
  already declared via `contextMenus` permission).
- **Security:** no new external calls; selection text never leaves the
  device. Same trust boundary as the existing AI Scan selection capture.
- **Error propagation:** parser failures are just "0 candidates," handled
  as a normal UI state, not an exception path — no new error class needed.
- **State lifecycle:** `pendingQuickQueue` follows the exact same
  session-storage lifeccle as `pendingAiScan` (set once, read once, removed
  immediately after read) — no orphaned state risk.
- **API surface parity:** the popup's manual "Scan Page" / "AI Scan" buttons
  are unaffected; this plan adds no new popup button, only a context-menu
  entry point, per brainstorm scope boundaries.

## Acceptance Criteria

- [ ] Highlighting text shaped like `Artist - Title`, `Artist – Title`,
      `"Title" by Artist`, or `Title by Artist`, right-clicking, and choosing
      **Add to Queue with QueueIt** queues that track without any AI
      provider call or API key.
- [ ] Highlighting a block containing multiple such lines shows the existing
      review screen with all detected candidates pre-populated, selectable,
      and queueable via the existing "Add to Queue" button.
- [ ] Highlighting text with no recognizable pattern opens the popup with a
      visible "No song detected" message (not a silent no-op).
- [ ] The existing "AI Scan with QueueIt" menu item and flow are unchanged.
- [ ] No new manifest permissions or host permissions are required.

## Dependencies & Risks

- **Risk:** a single confident match queues immediately with no confirm
  step, so a bad parse (e.g. a sentence that happens to contain " - ")
  reaches Spotify search before the user can intervene. Mitigated by (a) the
  regex heuristics already filtering out sentence-like text (punctuation /
  word-count checks), (b) Spotify's own match-quality filtering
  (`isGoodMatch`, `background.js:130-186`) meaning a nonsense query is far
  more likely to land in "not found" than to queue something wrong, and (c)
  this was an explicit, accepted trade-off in the brainstorm.
- **No automated test harness exists in this repo** (no `package.json`, no
  test runner) — verification will be a standalone Node script exercising
  the parser directly, plus manual load-and-click testing of the full
  extension in Chrome.

## Sources & References

- **Origin brainstorm:**
  [docs/brainstorms/2026-08-30-quick-queue-brainstorm.md](../brainstorms/2026-08-30-quick-queue-brainstorm.md) —
  carries forward: queue-immediately-on-single-match, review-screen-on-multi-match,
  visible-error-on-no-match, and the explicit scope boundaries (no new AI
  provider, no manual paste UI, no toggle).
- Existing AI Scan selection flow: `background.js:440-469`, `popup.js:431-474`
- Existing regex heuristics being reused: `extractor.js:206-244`
- Existing queue pipeline reused as-is: `processSongs` (`background.js:192-245`),
  `PROCESS_SONGS` handler (`background.js:479-507`)
- Existing review screen reused as-is: `showScanResults` / `renderCandidates`
  (`popup.js:197-253`)
