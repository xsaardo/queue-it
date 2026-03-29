'use strict';

let processingInProgress = false;

// ─── Token management ─────────────────────────────────────────────────────────

async function findSpotifyTab() {
  const tabs = await chrome.tabs.query({ url: 'https://open.spotify.com/*' });
  return tabs[0] || null;
}

function extractSpotifyTokenFromPage() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      let raw = localStorage.getItem(key);
      if (!raw || !raw.includes('accessToken')) continue;
      let parsed;
      try { parsed = JSON.parse(raw); } catch { continue; }
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { continue; }
      }
      if (parsed && typeof parsed.accessToken === 'string' && parsed.accessToken.length > 20) {
        return { accessToken: parsed.accessToken, expiresAt: parsed.expiresAt || null };
      }
    }
  } catch (_) {}
  return null;
}

async function getToken() {
  const tab = await findSpotifyTab();
  if (!tab) throw new Error('no_spotify_tab');

  let result;
  try {
    [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractSpotifyTokenFromPage,
    });
  } catch { throw new Error('no_spotify_tab'); }

  const data = result?.result;
  if (!data?.accessToken) throw new Error('no_spotify_tab');
  if (data.expiresAt && Date.now() >= data.expiresAt - 60_000) throw new Error('no_spotify_tab');

  return data.accessToken;
}

// ─── Spotify API ──────────────────────────────────────────────────────────────

async function spotifyFetch(path, options = {}, retryCount = 0) {
  const token = await getToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 401) throw new Error('no_spotify_tab');
  if (res.status === 404 && path.includes('/player/queue')) throw new Error('No active Spotify device — open Spotify on a device first');
  // Handle rate limiting with backoff (#18)
  if (res.status === 429 && retryCount < 2) {
    const retryAfter = Math.min(parseInt(res.headers.get('Retry-After') || '5', 10), 30);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return spotifyFetch(path, options, retryCount + 1);
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  return res.json().catch(() => null);
}

function normalizeStr(str) {
  return str
    .toLowerCase()
    .replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ')  // strip (feat. X), [Remix], etc.
    .replace(/\bfeat\.?\s.*/i, '')            // strip "feat ..." not caught above
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordsOverlap(a, b) {
  const wa = a.split(' ').filter(w => w.length > 1);
  const wb = new Set(b.split(' ').filter(w => w.length > 1));
  if (!wa.length || !wb.size) return true;
  const shared = wa.filter(w => wb.has(w)).length;
  return shared / Math.min(wa.length, wb.size) >= 0.5;
}

const SPOKEN_WORD_RE = /\b(audiobook|unabridged|abridged|narrated by|narrator|chapter \d|podcast|episode \d)\b/i;

function isSpokenWord(track) {
  if (track.type && track.type !== 'track') return true;
  const albumType = track.album?.album_type;
  if (albumType && albumType !== 'album' && albumType !== 'single' && albumType !== 'compilation') return true;
  const haystack = [track.name, track.album?.name, ...(track.artists?.map(a => a.name) || [])].join(' ');
  return SPOKEN_WORD_RE.test(haystack);
}

function isGoodMatch(song, track) {
  if (isSpokenWord(track)) return false;

  const reqTitle = normalizeStr(song.title);
  const spotifyTitle = normalizeStr(track.name);
  if (!wordsOverlap(reqTitle, spotifyTitle)) return false;

  if (song.artist) {
    const reqArtist = normalizeStr(song.artist);
    const spotifyArtist = normalizeStr(track.artists.map(a => a.name).join(' '));
    if (!wordsOverlap(reqArtist, spotifyArtist)) return false;
  }
  return true;
}

async function searchTrack(artist, title) {
  const strict = encodeURIComponent(`artist:${artist} track:${title}`);
  const d1 = await spotifyFetch(`/search?q=${strict}&type=track&limit=1`);
  if (d1?.tracks?.items?.length) return d1.tracks.items[0];
  const loose = encodeURIComponent(artist ? `${artist} ${title}` : title);
  const d2 = await spotifyFetch(`/search?q=${loose}&type=track&limit=1`);
  return d2?.tracks?.items?.[0] || null;
}

async function addToQueue(uri) {
  const token = await getToken();
  const res = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 401) throw new Error('no_spotify_tab');
  if (res.status === 404) throw new Error('No active Spotify device — open Spotify on a device first');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  // 204 or any other 2xx — success, body not needed
}

// ─── Processing state (written here, read by popup via storage.onChanged) ─────

function setProcessingState(state) {
  return new Promise(resolve => chrome.storage.local.set({ processingState: state }, resolve));
}

async function processSongs(songs) {
  const total = songs.length;
  await setProcessingState({ status: 'running', startedAt: Date.now(), total, current: 0, currentLabel: 'Searching…', foundCount: 0, notFound: [] });

  const found = [];
  const notFound = [];

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    const label = song.artist ? `${song.artist} – ${song.title}` : song.title;
    await setProcessingState({ status: 'running', total, current: i, currentLabel: label, foundCount: found.length, notFoundCount: notFound.length });

    try {
      const track = await searchTrack(song.artist, song.title);
      if (track && isGoodMatch(song, track)) found.push({ song, uri: track.uri });
      else notFound.push(song);
    } catch { notFound.push(song); }

    await new Promise(r => setTimeout(r, 120));
  }

  await setProcessingState({ status: 'running', total, current: total, currentLabel: `Queueing ${found.length} tracks…`, foundCount: found.length, notFoundCount: notFound.length });

  for (const f of found) {
    await addToQueue(f.uri);
    await new Promise(r => setTimeout(r, 150));
  }

  // Badge flash so user knows it finished even if popup was closed
  chrome.action.setBadgeText({ text: '✓' });
  chrome.action.setBadgeBackgroundColor({ color: '#1db954' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);

  await setProcessingState({ status: 'done', total, foundCount: found.length, notFound });
}

// ─── AI Provider config ────────────────────────────────────────────────────────

const AI_PROVIDERS = {
  anthropic:  { name: 'Claude',      model: 'claude-haiku-4-5-20251001',                    baseUrl: 'https://api.anthropic.com' },
  openai:     { name: 'OpenAI',      model: 'gpt-4o-mini',                                  baseUrl: 'https://api.openai.com' },
  openrouter: { name: 'OpenRouter',  model: 'openrouter/free',                               baseUrl: 'https://openrouter.ai/api' },
  gemini:     { name: 'Gemini',      model: 'gemini-2.5-flash',                             baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', chatPath: '/chat/completions' },
};

function detectProvider(key) {
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-')) return 'openai';
  return null;
}

// ─── AI extraction ────────────────────────────────────────────────────────────

async function callAnthropic(apiKey, model, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }
  const json = await res.json();
  return json.content?.[0]?.text || '';
}

async function callOpenAICompat(apiKey, model, baseUrl, prompt, chatPath = '/v1/chat/completions') {
  const res = await fetch(`${baseUrl}${chatPath}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

async function extractSongsWithAI(pageText) {
  const data = await new Promise(resolve => chrome.storage.session.get(['aiApiKey'], resolve));
  const apiKey = data.aiApiKey;
  if (!apiKey) throw new Error('No API key saved');

  const provider = detectProvider(apiKey);
  if (!provider) throw new Error('Unrecognized API key format');
  const cfg = AI_PROVIDERS[provider];

  const prompt = `Extract all songs or tracks mentioned in the following webpage text. Return ONLY a JSON array of objects with "artist" and "title" fields. Use empty string for unknown artists. Only include actual songs/tracks, not albums or artist names alone.

Example output: [{"artist":"Radiohead","title":"Creep"},{"artist":"","title":"Bohemian Rhapsody"}]

Webpage text:
${pageText.slice(0, 12000)}`;

  const text = provider === 'anthropic'
    ? await callAnthropic(apiKey, cfg.model, prompt)
    : await callOpenAICompat(apiKey, cfg.model, cfg.baseUrl, prompt, cfg.chatPath);

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let songs;
  try { songs = JSON.parse(match[0]); } catch { return []; }

  return songs
    .filter(s => s?.title && typeof s.title === 'string' && s.title.length > 1)
    .map(s => ({ artist: s.artist || '', title: s.title, confidence: 'high', source: 'ai' }));
}

// ─── Message listener ─────────────────────────────────────────────────────────

// Safe error messages that can be shown to the user (#13)
const SAFE_PROCESSING_ERRORS = new Set([
  'no_spotify_tab',
  'No active Spotify device — open Spotify on a device first',
]);

// ─── Context menu ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ai-scan-selection',
    title: 'AI Scan with QueueIt',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'ai-scan-selection') return;

  // Inject to get full selection (info.selectionText is truncated by Chrome)
  let selectionText = '';
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection().toString().trim().slice(0, 15000),
    });
    selectionText = result?.result || info.selectionText || '';
  } catch {
    selectionText = info.selectionText || '';
  }

  if (!selectionText) return;

  await chrome.storage.session.set({ pendingAiScan: { selectionText } });

  // Open popup (Chrome 127+; graceful no-op on older builds)
  try { await chrome.action.openPopup(); } catch { /* user can open manually */ }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'PROCESS_SONGS') {
    // Guard against concurrent processing (#9)
    if (processingInProgress) {
      sendResponse({ ok: false, error: 'Already processing' });
      return false;
    }
    // Validate payload before processing (#11)
    if (!Array.isArray(msg.songs) || msg.songs.length > 200) {
      sendResponse({ ok: false, error: 'Invalid songs payload' });
      return false;
    }
    for (const s of msg.songs) {
      if (typeof s?.title !== 'string' || typeof s?.artist !== 'string') {
        sendResponse({ ok: false, error: 'Invalid song entry' });
        return false;
      }
    }
    processingInProgress = true;
    processSongs(msg.songs)
      .catch(err => {
        // Genericize third-party error strings before storing (#13)
        const msg = SAFE_PROCESSING_ERRORS.has(err.message) ? err.message : 'Processing failed. Please try again.';
        console.error('processSongs error:', err.message);
        return setProcessingState({ status: 'error', error: msg });
      })
      .finally(() => { processingInProgress = false; });
    sendResponse({ ok: true }); // acknowledge immediately; progress via storage
    return false;
  }

  if (msg.type === 'AI_SCAN') {
    extractSongsWithAI(msg.pageText)
      .then(songs => sendResponse({ ok: true, songs }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
