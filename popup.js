'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
let scanCandidates = [];
let selectedIndices = new Set();
let lastResultContext = 'main'; // 'main' | 'scan'

// ─── Helpers ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');

const SCREENS = ['setup', 'main', 'progress', 'result', 'scan'];
function showScreen(name) {
  SCREENS.forEach(s => $(`screen-${s}`).classList.add('hidden'));
  show(`screen-${name}`);
}

// ─── Auth / Token ─────────────────────────────────────────────────────────────
async function getToken() {
  return new Promise(resolve => {
    chrome.storage.local.get(['accessToken', 'expiresAt'], data => {
      // Accept any stored token — background.js will refresh if expired on next use
      resolve(data.accessToken || null);
    });
  });
}

async function clearToken() {
  return new Promise(resolve => chrome.storage.local.remove(['accessToken', 'expiresAt', 'refreshToken'], resolve));
}

async function authenticate() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'AUTHENTICATE' }, response => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (response?.ok) resolve();
      else reject(new Error(response?.error || 'Authentication failed'));
    });
  });
}

// ─── AI Provider config ────────────────────────────────────────────────────────

const AI_PROVIDERS = {
  anthropic:  { name: 'Claude' },
  openai:     { name: 'OpenAI' },
  openrouter: { name: 'OpenRouter' },
  gemini:     { name: 'Gemini' },
};

function detectProvider(key) {
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-')) return 'openai';
  return null;
}

// ─── AI key storage ───────────────────────────────────────────────────────────
async function getApiKey() {
  return new Promise(resolve => chrome.storage.session.get(['aiApiKey'], d => resolve(d.aiApiKey || null)));
}

async function hasAiConsent() {
  return new Promise(resolve => chrome.storage.local.get(['aiScanConsented'], d => resolve(!!d.aiScanConsented)));
}

async function saveAiConsent() {
  return new Promise(resolve => chrome.storage.local.set({ aiScanConsented: true }, resolve));
}

async function saveApiKey(key) {
  return new Promise(resolve => chrome.storage.session.set({ aiApiKey: key }, resolve));
}

async function clearApiKey() {
  return new Promise(resolve => chrome.storage.session.remove(['aiApiKey'], resolve));
}

async function aiScanViaBackground(pageText) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'AI_SCAN', pageText }, response => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (response?.ok) resolve(response.songs);
      else reject(new Error(response?.error || 'AI scan failed'));
    });
  });
}

// ─── Scan state persistence ───────────────────────────────────────────────────
function saveScanState() {
  chrome.storage.local.set({
    scanState: {
      candidates: scanCandidates,
      selected: [...selectedIndices],
      capped: scanCandidates.length >= 200,
    },
  });
}

function clearScanState() {
  chrome.storage.local.remove('scanState');
}

// ─── Page Scanner ─────────────────────────────────────────────────────────────
async function scanPage() {
  lastResultContext = 'scan';
  showScreen('scan');
  $('scan-heading').textContent = 'Scanning page…';
  $('scan-empty-msg').textContent = 'No songs detected on this page.';
  show('scan-loading');
  hide('scan-empty');
  hide('scan-results');

  let candidates = [];
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractSongsFromPage,
    });
    candidates = result?.result || [];
  } catch (err) {
    candidates = [];
    console.error('Scan error:', err);
  }

  hide('scan-loading');
  showScanResults(candidates);
}

async function aiScanPage() {
  if (!(await hasAiConsent())) {
    showMain();
    show('ai-consent-banner');
    return;
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    showMain();
    show('ai-key-section');
    show('ai-key-prompt');
    $('api-key-input').focus();
    return;
  }

  lastResultContext = 'scan';
  showScreen('scan');
  $('scan-heading').textContent = 'AI scanning…';
  $('scan-empty-msg').textContent = 'No songs detected on this page.';
  show('scan-loading');
  hide('scan-empty');
  hide('scan-results');

  let candidates = [];
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: getPageTextForAI,
    });
    const pageText = result?.result || '';
    candidates = await aiScanViaBackground(pageText);
  } catch (err) {
    console.error('AI scan error:', err);
    hide('scan-loading');
    $('scan-heading').textContent = 'AI scan failed';
    $('scan-empty-msg').textContent = err.message || 'Unknown error';
    show('scan-empty');
    hide('scan-empty-hint');
    return;
  }

  hide('scan-loading');
  show('scan-empty-hint');
  showScanResults(candidates);
}

function showScanResults(candidates) {
  if (candidates.length === 0) {
    $('scan-heading').textContent = 'No songs found';
    show('scan-empty');
    return;
  }

  const capped = candidates.length >= 200;
  scanCandidates = candidates;
  // Pre-select all except low-confidence hyphen matches
  selectedIndices = new Set(
    candidates.map((c, i) => (c.source !== 'hyphen' ? i : null)).filter(i => i !== null)
  );

  const label = capped ? '200+ songs found' : `${candidates.length} song${candidates.length !== 1 ? 's' : ''} found`;
  $('scan-heading').textContent = label;
  renderCandidates();
  if (capped) show('scan-cap-notice'); else hide('scan-cap-notice');
  show('scan-results');
  saveScanState();
}

function renderCandidates() {
  const list = $('candidates-list');
  list.innerHTML = '';

  scanCandidates.forEach((c, i) => {
    const label = document.createElement('label');
    label.className = 'candidate-item';
    label.dataset.index = i;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedIndices.has(i);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedIndices.add(i);
      else selectedIndices.delete(i);
      updateSelectionCount();
      saveScanState();
    });

    const dot = document.createElement('span');
    dot.className = `dot ${c.confidence}`;

    const text = document.createElement('span');
    text.className = 'candidate-text';
    text.textContent = c.artist ? `${c.artist} – ${c.title}` : c.title;

    label.appendChild(checkbox);
    label.appendChild(dot);
    label.appendChild(text);
    list.appendChild(label);
  });

  updateSelectionCount();
}

function updateSelectionCount() {
  const n = selectedIndices.size;
  $('selected-count').textContent = `${n} selected`;
  $('scan-queue-btn').disabled = n === 0;
}

// ─── Processing state (background does the work, we watch storage) ────────────
function applyProcessingState(state) {
  if (!state) return;

  if (state.status === 'running') {
    if ($('screen-progress').classList.contains('hidden')) return; // popup not on progress screen
    const pct = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
    $('progress-bar').style.width = `${pct}%`;
    $('progress-count').textContent = `${state.current} / ${state.total}`;
    $('progress-current').textContent = state.currentLabel || 'Searching…';

  } else if (state.status === 'done') {
    lastResultContext = 'scan';
    showScreen('result');
    $('result-heading').textContent = 'Added to queue!';
    $('result-summary').textContent = '';
    const summary = document.createElement('span');
    summary.innerHTML = `<strong>${state.foundCount}</strong> tracks queued<br><strong>${state.notFound.length}</strong> not found on Spotify`;
    $('result-summary').appendChild(summary);

    if (state.notFound.length > 0) {
      show('not-found-section');
      const ul = $('not-found-list');
      ul.innerHTML = '';
      state.notFound.forEach(s => {
        const li = document.createElement('li');
        li.textContent = s.artist ? `${s.artist} – ${s.title}` : s.title;
        ul.appendChild(li);
      });
    } else {
      hide('not-found-section');
    }
    clearScanState();
    chrome.storage.local.remove('processingState');

  } else if (state.status === 'error') {
    handleError(new Error(state.error || 'Processing failed'));
    chrome.storage.local.remove('processingState');
  }
}

// ─── Error handler ─────────────────────────────────────────────────────────────
function handleError(err) {
  if (err.message === 'not_authenticated') {
    clearToken();
    showScreen('setup');
  } else {
    showScreen('result');
    $('result-heading').textContent = 'Error';
    $('result-summary').textContent = err.message;
    $('result-summary').style.color = '#e22134';
    hide('not-found-section');
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Setup screen
  $('connect-btn').addEventListener('click', async () => {
    $('connect-btn').disabled = true;
    $('connect-btn').textContent = 'Connecting…';
    hide('auth-error');
    try {
      await authenticate();
      showMain();
    } catch (err) {
      show('auth-error');
      $('auth-error').textContent = err.message || 'Authentication failed. Please try again.';
      $('connect-btn').disabled = false;
      $('connect-btn').textContent = 'Connect to Spotify';
    }
  });

  // Main screen
  $('disconnect-btn').addEventListener('click', async () => { await clearToken(); showScreen('setup'); });
  $('scan-btn').addEventListener('click', () => scanPage().catch(handleError));

  // AI Scan
  $('ai-scan-btn').addEventListener('click', () => aiScanPage().catch(handleError));
  $('api-key-save-btn').addEventListener('click', async () => {
    const key = $('api-key-input').value.trim();
    if (!key) return;
    const provider = detectProvider(key);
    if (!provider) {
      show('api-key-error');
      return;
    }
    hide('api-key-error');
    hide('ai-key-prompt');
    await saveApiKey(key);
    $('api-key-input').value = '';
    hide('ai-key-section');
    $('ai-provider-label').textContent = AI_PROVIDERS[provider].name;
    show('ai-key-status');
    aiScanPage().catch(handleError);
  });
  $('api-key-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('api-key-save-btn').click();
    else hide('api-key-error');
  });
  $('ai-key-clear-btn').addEventListener('click', async () => {
    await clearApiKey();
    hide('ai-key-status');
  });
  $('ai-consent-ok').addEventListener('click', async () => {
    await saveAiConsent();
    hide('ai-consent-banner');
    aiScanPage().catch(handleError);
  });
  $('ai-consent-cancel').addEventListener('click', () => hide('ai-consent-banner'));
  getApiKey().then(key => {
    if (key) {
      const provider = detectProvider(key);
      $('ai-provider-label').textContent = provider ? AI_PROVIDERS[provider].name : 'AI';
      show('ai-key-status');
    }
  });

  // Scan screen
  $('scan-back-btn').addEventListener('click', () => { clearScanState(); showMain(); });
  $('select-all-btn').addEventListener('click', () => {
    selectedIndices = new Set(scanCandidates.map((_, i) => i));
    $('candidates-list').querySelectorAll('input[type=checkbox]').forEach(cb => (cb.checked = true));
    updateSelectionCount();
    saveScanState();
  });
  $('deselect-all-btn').addEventListener('click', () => {
    selectedIndices.clear();
    $('candidates-list').querySelectorAll('input[type=checkbox]').forEach(cb => (cb.checked = false));
    updateSelectionCount();
    saveScanState();
  });
  $('rescan-btn').addEventListener('click', () => scanPage().catch(handleError));
  $('ai-rescan-btn').addEventListener('click', () => aiScanPage().catch(handleError));

  $('scan-queue-btn').addEventListener('click', () => {
    const songs = [...selectedIndices].map(i => scanCandidates[i]);
    showScreen('progress');
    $('progress-title').textContent = 'Adding to queue…';
    $('progress-bar').style.width = '0%';
    $('progress-count').textContent = `0 / ${songs.length}`;
    $('progress-current').textContent = 'Searching…';
    chrome.runtime.sendMessage({ type: 'PROCESS_SONGS', songs });
  });

  // Result screen
  $('back-btn').addEventListener('click', () => {
    if (lastResultContext === 'scan') showScreen('scan');
    else showMain();
  });

  // Watch background processing state
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.processingState) {
      applyProcessingState(changes.processingState.newValue);
    }
  });

  // Boot — check for in-progress or completed job from a previous popup open
  const stored = await new Promise(resolve =>
    chrome.storage.local.get(['accessToken', 'processingState', 'scanState'], resolve)
  );

  if (stored.processingState?.status === 'running') {
    showScreen('progress');
    $('progress-title').textContent = 'Adding to queue…';
    applyProcessingState(stored.processingState);
  } else if (stored.processingState?.status === 'done') {
    applyProcessingState(stored.processingState);
  } else if (stored.scanState?.candidates?.length > 0) {
    scanCandidates = stored.scanState.candidates;
    selectedIndices = new Set(stored.scanState.selected || []);
    lastResultContext = 'scan';
    showScreen('scan');
    const capped = stored.scanState.capped;
    $('scan-heading').textContent = capped
      ? '200+ songs found'
      : `${scanCandidates.length} song${scanCandidates.length !== 1 ? 's' : ''} found`;
    renderCandidates();
    if (capped) show('scan-cap-notice'); else hide('scan-cap-notice');
    show('scan-results');
  } else if (stored.accessToken) {
    showMain();
  } else {
    showScreen('setup');
  }
}

function showMain() {
  lastResultContext = 'main';
  showScreen('main');
}

document.addEventListener('DOMContentLoaded', init);
