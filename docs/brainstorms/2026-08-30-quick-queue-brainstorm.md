# Brainstorm: Non-AI Quick Queue

**Date:** 2026-08-30

## What We're Building

A second context-menu action, "Add to Queue with QueueIt," that sits next to
the existing "AI Scan with QueueIt." Where AI Scan sends the highlighted text
to an LLM, Quick Queue parses it locally with the same regex heuristics
`extractor.js` already uses for its page-scan fallback (em dash, hyphen,
"Title by Artist"). No network call to an AI provider, no API key required.

## Why This Approach

- The regex patterns for "Artist - Title" style text already exist and are
  proven (they're the fallback tier of `extractSongsFromPage`). Reusing them
  as a standalone parser is the smallest change that delivers the feature.
- The existing AI Scan flow already establishes the plumbing this needs:
  context menu → grab selection via injected script → stash in
  `chrome.storage.session` → open the popup → popup picks it up and renders
  results → `PROCESS_SONGS` → Spotify search/queue. Quick Queue reuses every
  piece of that except the AI call itself.
- Alternatives considered and rejected:
  - **Popup-only manual paste box** — doesn't satisfy "highlight and queue
    directly"; adds a UI surface not requested.
  - **Always show a review screen, even for one match** — adds a click the
    "directly" framing doesn't want, and the AI path already covers the
    review-then-queue case.

## Key Decisions

1. **Single confident match → queue immediately.** No confirmation screen;
   the popup opens straight to the progress/result screens (same ones
   `PROCESS_SONGS` already drives). Trade-off: a bad parse gets searched on
   Spotify before the user can stop it — mitigated by the result screen still
   showing exactly what was queued/not-found, and by Spotify's own search
   match filtering (`isGoodMatch`) as a backstop.
2. **Multiple matches in one selection → existing review screen.** If the
   highlighted block parses into more than one artist/title pair, treat it
   like a scan result set: reuse `showScanResults`, checkboxes, and the
   "Add to Queue" button already in `popup.js`.
3. **Zero matches → popup opens with a clear error**, not a silent no-op:
   "Couldn't detect a song — try highlighting text like 'Artist - Title'."
4. Parsing logic is new code, not a refactor of `extractSongsFromPage` — that
   function is DOM-oriented (queries `document`) and injected into the page.
   The new parser operates on a plain string (the selection) and needs no DOM
   access, so it lives in `background.js` where the context-menu handler
   already runs and where AI's `extractSongsWithAI` shows the equivalent
   contract (`{artist, title, confidence, source}` array in, `processSongs`
   downstream).

## Resolved Questions

- Single match → queue immediately (no confirm step). *Resolved.*
- Multiple matches → show review screen. *Resolved.*
- No match → open popup with visible error. *Resolved.*

## Scope Boundaries (what's explicitly out)

- No new AI provider or network calls.
- No manual "paste text to queue" UI in the popup.
- No changes to the existing AI Scan context-menu item or its flow.
- No settings/toggle to disable the new context-menu item (mirrors how AI
  Scan has none either).

Next: `/ce:plan`
