'use strict';

const CLIENT_ID = 'dce75b7955954dfba134ab8cc3e98cb3';

function getRedirectUri() {
  return `https://${chrome.runtime.id}.chromiumapp.org/`;
}

function base64urlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePKCE() {
  const verifier = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64urlEncode(digest);
  return { verifier, challenge };
}

// ─── Token management ─────────────────────────────────────────────────────────

async function getStoredToken() {
  return new Promise(resolve =>
    chrome.storage.local.get(['accessToken', 'expiresAt'], data => {
      if (data.accessToken && data.expiresAt && Date.now() < data.expiresAt - 60_000) {
        resolve(data.accessToken);
      } else {
        resolve(null);
      }
    })
  );
}

async function doRefreshToken() {
  const data = await new Promise(resolve => chrome.storage.local.get(['refreshToken'], resolve));
  if (!data.refreshToken) return null;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: data.refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) return null;
  const token = await res.json().catch(() => null);
  if (!token?.access_token) return null;

  await chrome.storage.local.set({
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
  });
  return token.access_token;
}

async function getToken() {
  return (await getStoredToken()) || (await doRefreshToken());
}

// ─── Spotify API ──────────────────────────────────────────────────────────────

async function spotifyFetch(path, options = {}) {
  const token = await getToken();
  if (!token) throw new Error('not_authenticated');
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 401) throw new Error('not_authenticated');
  if (res.status === 404 && path.includes('/player/queue')) throw new Error('No active Spotify device — open Spotify on a device first');
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
  if (!token) throw new Error('not_authenticated');
  const res = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 401) throw new Error('not_authenticated');
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
  await setProcessingState({ status: 'running', total, current: 0, currentLabel: 'Searching…', foundCount: 0, notFound: [] });

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

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function authenticate() {
  const redirectUri = getRedirectUri();
  const { verifier, challenge } = await generatePKCE();

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'user-modify-playback-state');
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('show_dialog', 'true');

  return new Promise((resolve, reject) => {
    let authWindowId = null;

    function cleanup() {
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      chrome.windows.onRemoved.removeListener(onWindowRemoved);
      if (authWindowId !== null) {
        chrome.windows.remove(authWindowId, () => void chrome.runtime.lastError);
        authWindowId = null;
      }
    }

    function onWindowRemoved(windowId) {
      if (windowId === authWindowId) {
        chrome.tabs.onUpdated.removeListener(onTabUpdated);
        chrome.windows.onRemoved.removeListener(onWindowRemoved);
        authWindowId = null;
        reject(new Error('Auth window was closed'));
      }
    }

    async function onTabUpdated(tabId, changeInfo) {
      if (!changeInfo.url?.startsWith(redirectUri)) return;
      cleanup();
      try {
        const code = new URL(changeInfo.url).searchParams.get('code');
        if (!code) throw new Error('No authorization code in response');

        const res = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: CLIENT_ID,
            code_verifier: verifier,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error_description || data.error || `Token exchange failed (${res.status})`);

        await chrome.storage.local.set({
          accessToken: data.access_token,
          expiresAt: Date.now() + parseInt(data.expires_in) * 1000,
          refreshToken: data.refresh_token,
        });
        resolve();
      } catch (e) { reject(e); }
    }

    chrome.tabs.onUpdated.addListener(onTabUpdated);
    chrome.windows.onRemoved.addListener(onWindowRemoved);

    chrome.windows.create({
      url: authUrl.toString(),
      type: 'popup',
      width: 480,
      height: 700,
      focused: true,
    }, win => {
      authWindowId = win.id;
    });
  });
}

// ─── Claude AI extraction ─────────────────────────────────────────────────────

async function extractSongsWithAI(pageText) {
  const data = await new Promise(resolve => chrome.storage.local.get(['claudeApiKey'], resolve));
  const apiKey = data.claudeApiKey;
  if (!apiKey) throw new Error('No Claude API key saved');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Extract all songs or tracks mentioned in the following webpage text. Return ONLY a JSON array of objects with "artist" and "title" fields. Use empty string for unknown artists. Only include actual songs/tracks, not albums or artist names alone.

Example output: [{"artist":"Radiohead","title":"Creep"},{"artist":"","title":"Bohemian Rhapsody"}]

Webpage text:
${pageText.slice(0, 12000)}`,
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API error ${res.status}`);
  }

  const json = await res.json();
  const text = json.content?.[0]?.text || '';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let songs;
  try {
    songs = JSON.parse(match[0]);
  } catch {
    return [];
  }
  return songs
    .filter(s => s?.title && typeof s.title === 'string' && s.title.length > 1)
    .map(s => ({ artist: s.artist || '', title: s.title, confidence: 'high', source: 'ai' }));
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'AUTHENTICATE') {
    authenticate()
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'PROCESS_SONGS') {
    processSongs(msg.songs)
      .catch(err => setProcessingState({ status: 'error', error: err.message }));
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
