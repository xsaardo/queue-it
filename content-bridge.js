// Runs in isolated world at document_start on open.spotify.com.
// Listens for tokens posted by content-main.js and stores them to session storage.
'use strict';
window.addEventListener('message', event => {
  if (event.source !== window || event.data?.type !== '__QUEUEIT_TOKEN__') return;
  const token = event.data.token;
  if (typeof token === 'string' && token.length > 20) {
    chrome.storage.session.set({ spotifyWebToken: { token, capturedAt: Date.now() } });
  }
});
