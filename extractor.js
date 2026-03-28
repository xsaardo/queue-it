/**
 * extractSongsFromPage()
 *
 * Self-contained function injected via chrome.scripting.executeScript into
 * arbitrary pages. Must NOT reference anything outside its own scope.
 *
 * Returns: Array<{ artist: string, title: string, confidence: 'high'|'medium'|'low', source: string }>
 */
function extractSongsFromPage() {
  const results = [];
  const seen = new Set();

  function clean(s) {
    return (s || '').replace(/\s+/g, ' ').replace(/[""'']/g, '"').trim();
  }

  function add(artist, title, confidence, source) {
    artist = clean(artist);
    title = clean(title);
    // Basic sanity checks
    if (!title || title.length < 2 || title.length > 150) return;
    if (artist && artist.length > 100) return;
    // Skip obvious noise
    if (/^(home|menu|back|next|previous|login|sign\s?in|sign\s?up|close|cancel|search|loading|undefined|null)$/i.test(title)) return;
    if (/^https?:\/\//.test(title)) return;
    const key = `${(artist || '').toLowerCase()}::${title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ artist: artist || '', title, confidence, source });
  }

  // ── 1. JSON-LD / Schema.org ──────────────────────────────────────────────
  document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
    try {
      const parse = item => {
        if (!item || typeof item !== 'object') return;
        const type = [].concat(item['@type'] || []);
        if (type.some(t => /MusicRecording|MusicComposition|MusicTrack/i.test(t))) {
          const artist = item.byArtist
            ? [].concat(item.byArtist).map(a => a.name || a).join(', ')
            : '';
          add(artist, item.name, 'high', 'schema-ld');
        }
        if (type.some(t => /MusicAlbum|MusicPlaylist/i.test(t))) {
          const albumArtist = [].concat(item.byArtist || []).map(a => a.name || a).join(', ');
          [].concat(item.track || []).forEach(t => {
            const ta = [].concat(t.byArtist || []).map(a => a.name || a).join(', ') || albumArtist;
            add(ta, t.name, 'high', 'schema-album');
          });
        }
        // Recurse into @graph
        [].concat(item['@graph'] || []).forEach(parse);
        if (Array.isArray(item)) item.forEach(parse);
      };
      parse(JSON.parse(el.textContent));
    } catch (_) {}
  });

  // ── 2. YouTube ───────────────────────────────────────────────────────────
  if (/youtube\.com|youtu\.be/.test(location.hostname)) {
    // Primary title from page
    const ytTitle = document.querySelector('h1.ytd-video-primary-info-renderer, yt-formatted-string.ytd-watch-metadata')?.textContent?.trim()
      || document.title.replace(/ - YouTube$/, '');
    const m = ytTitle?.match(/^(.+?)\s[-–—]\s(.+)$/);
    if (m) add(m[1], m[2], 'high', 'youtube-title');
    else if (ytTitle && ytTitle.length < 120) add('', ytTitle, 'medium', 'youtube-title');

    // Sidebar / playlist items
    document.querySelectorAll('ytd-playlist-panel-video-renderer, ytd-compact-video-renderer').forEach(el => {
      const t = el.querySelector('#video-title')?.textContent?.trim();
      const m2 = t?.match(/^(.+?)\s[-–—]\s(.+)$/);
      if (m2) add(m2[1], m2[2], 'medium', 'youtube-sidebar');
    });
  }

  // ── 3. Bandcamp ──────────────────────────────────────────────────────────
  if (/bandcamp\.com/.test(location.hostname)) {
    const albumArtist = document.querySelector('.artist-title, span[itemprop="byArtist"]')?.textContent?.trim()
      || document.querySelector('#band-name-location .title')?.textContent?.trim()
      || '';
    document.querySelectorAll('.track_row_view, tr.track_row_view').forEach(el => {
      const t = el.querySelector('.title span, .track-title')?.textContent?.trim();
      if (t) add(albumArtist, t, 'high', 'bandcamp');
    });
    // Single track page
    const singleTitle = document.querySelector('.trackTitle')?.textContent?.trim();
    if (singleTitle) add(albumArtist, singleTitle, 'high', 'bandcamp-single');
  }

  // ── 4. SoundCloud ────────────────────────────────────────────────────────
  if (/soundcloud\.com/.test(location.hostname)) {
    document.querySelectorAll('.trackItem__trackTitle, .soundTitle__title').forEach(el => {
      const text = el.textContent.trim();
      const m = text.match(/^(.+?)\s[-–—]\s(.+)$/);
      if (m) add(m[1], m[2], 'medium', 'soundcloud');
      else add('', text, 'medium', 'soundcloud');
    });
  }

  // ── 5. Pitchfork ─────────────────────────────────────────────────────────
  if (/pitchfork\.com/.test(location.hostname)) {
    document.querySelectorAll('[class*="TrackList"], [class*="tracklist"]').forEach(el => {
      const artist = el.querySelector('[class*="artist"]')?.textContent?.trim();
      const title = el.querySelector('[class*="title"]')?.textContent?.trim();
      if (title) add(artist || '', title, 'high', 'pitchfork');
    });
  }

  // ── 6. Resident Advisor ──────────────────────────────────────────────────
  if (/ra\.co/.test(location.hostname)) {
    // Reviews / features with structured track info
    document.querySelectorAll('article, [class*="track"], [class*="Track"]').forEach(el => {
      const title = el.querySelector('h2, h3, [class*="title"], [class*="Title"]')?.textContent?.trim();
      const artist = el.querySelector('[class*="artist"], [class*="Artist"]')?.textContent?.trim();
      if (title && title.length < 100) add(artist || '', title, 'high', 'ra');
    });
  }

  // ── 7. Last.fm / Setlist.fm ──────────────────────────────────────────────
  if (/last\.fm/.test(location.hostname)) {
    document.querySelectorAll('.chartlist-name, .track-scrobble-name').forEach(el => {
      const title = el.textContent.trim();
      const artist = el.closest('tr, li')?.querySelector('.chartlist-artist, .track-artist')?.textContent?.trim() || '';
      if (title) add(artist, title, 'high', 'lastfm');
    });
  }
  if (/setlist\.fm/.test(location.hostname)) {
    document.querySelectorAll('.setlistParts li').forEach(el => {
      const title = el.querySelector('.song span')?.textContent?.trim();
      const artist = document.querySelector('.setlistHeadline h1 span[itemprop="name"]')?.textContent?.trim() || '';
      if (title) add(artist, title, 'high', 'setlistfm');
    });
  }

  // ── 8. Apple Music / Spotify Web ────────────────────────────────────────
  if (/music\.apple\.com/.test(location.hostname)) {
    document.querySelectorAll('[class*="track-cell"], [class*="song-cell"]').forEach(el => {
      const title = el.querySelector('[class*="title"]')?.textContent?.trim();
      const artist = el.querySelector('[class*="artist"]')?.textContent?.trim() || '';
      if (title) add(artist, title, 'high', 'apple-music');
    });
  }
  if (/open\.spotify\.com/.test(location.hostname)) {
    document.querySelectorAll('[data-testid="tracklist-row"]').forEach(el => {
      const title = el.querySelector('[data-testid="internal-track-link"] div')?.textContent?.trim();
      const artist = [...el.querySelectorAll('[data-testid="artist-link"]')].map(a => a.textContent.trim()).join(', ');
      if (title) add(artist, title, 'high', 'spotify-web');
    });
  }

  // ── 9. Generic: microdata / itemprop ─────────────────────────────────────
  document.querySelectorAll('[itemtype*="MusicRecording"], [itemtype*="MusicTrack"]').forEach(el => {
    const name = el.querySelector('[itemprop="name"]')?.textContent?.trim();
    const artist = el.querySelector('[itemprop="byArtist"]')?.textContent?.trim() || '';
    if (name) add(artist, name, 'high', 'microdata');
  });

  // ── 10. Generic text pattern matching (fallback) ──────────────────────────
  const skipSelectors = 'nav, footer, header, aside, [role="navigation"], [role="banner"], script, style, noscript';
  const skipEls = new Set(document.querySelectorAll(skipSelectors));

  function isSkipped(el) {
    let node = el;
    while (node) {
      if (skipEls.has(node)) return true;
      node = node.parentElement;
    }
    return false;
  }

  // Focus on meaningful content elements (paragraphs, list items, headings)
  const contentEls = document.querySelectorAll('p, li, h2, h3, h4, td, dt, dd, [class*="title"], [class*="track"], [class*="song"]');

  const emDashRe = /^(.{1,70}?)\s[–—]\s(.{1,120})$/;
  const hyphenRe = /^(.{2,60}?)\s-\s(.{2,120})$/;
  const byRe = /^[""']?(.{1,80}?)[""']?\s+by\s+(.{1,60})$/i;
  const noiseRe = /^(https?:\/\/|www\.|©|\d{4}\s*[-–]|all rights|terms|privacy|cookie|subscribe|follow|share|comments?|reply|like|loading)/i;

  contentEls.forEach(el => {
    if (isSkipped(el)) return;
    const text = el.textContent.trim().replace(/\s+/g, ' ');
    if (text.length < 3 || text.length > 200 || noiseRe.test(text)) return;

    let m;
    if ((m = text.match(emDashRe))) {
      add(m[1], m[2], 'medium', 'em-dash');
    } else if ((m = text.match(byRe))) {
      add(m[2], m[1], 'medium', 'by-pattern');
    } else if ((m = text.match(hyphenRe))) {
      const a = m[1].trim(), t = m[2].trim();
      // Heuristic: artist names rarely have sentence punctuation
      if (!/[.?!]/.test(a) && a.split(' ').length <= 7) {
        add(a, t, 'low', 'hyphen');
      }
    }
  });

  // ── Sort & cap ─────────────────────────────────────────────────────────────
  const order = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => order[a.confidence] - order[b.confidence]);

  return results.slice(0, 200);
}

/**
 * getPageTextForAI()
 *
 * Self-contained function injected via chrome.scripting.executeScript.
 * Returns cleaned main-content text for sending to an LLM.
 */
function getPageTextForAI() {
  const skip = 'nav, footer, header, aside, script, style, noscript, [role="navigation"], [role="banner"], [role="complementary"]';
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll(skip).forEach(el => el.remove());
  const text = (clone.innerText || clone.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.slice(0, 15000);
}
