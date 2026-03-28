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
  const token = await res.json();
  if (!token.access_token) return null;

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
  return res.json();
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
  return spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: 'POST' });
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
    await setProcessingState({ status: 'running', total, current: i, currentLabel: label, foundCount: found.length, notFound });

    try {
      const track = await searchTrack(song.artist, song.title);
      if (track) found.push({ song, uri: track.uri });
      else notFound.push(song);
    } catch { notFound.push(song); }

    await new Promise(r => setTimeout(r, 120));
  }

  await setProcessingState({ status: 'running', total, current: total, currentLabel: `Queueing ${found.length} tracks…`, foundCount: found.length, notFound });

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

  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'user-modify-playback-state');
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('show_dialog', 'true');

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true }, async responseUrl => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      try {
        const code = new URL(responseUrl).searchParams.get('code');
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
    });
  });
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
  }
});
