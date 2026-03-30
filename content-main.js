// Runs in MAIN world at document_start on open.spotify.com.
// Wraps fetch to capture the Spotify Bearer token from outgoing API calls,
// then sends it to the isolated-world bridge via postMessage.
(function () {
  'use strict';
  const _fetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('api.spotify.com')) {
        let auth = null;
        if (init?.headers) {
          if (init.headers instanceof Headers) {
            auth = init.headers.get('Authorization');
          } else {
            auth = init.headers['Authorization'] || init.headers['authorization'] || null;
          }
        } else if (input instanceof Request) {
          auth = input.headers.get('Authorization');
        }
        if (auth?.startsWith('Bearer ')) {
          window.postMessage({ type: '__QUEUEIT_TOKEN__', token: auth.slice(7) }, '*');
        }
      }
    } catch (_) {}
    return _fetch.apply(this, arguments);
  };
})();
