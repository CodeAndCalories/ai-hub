'use strict';

// ── Memstore — persistent memory integration (extension) ─────────────────────
// Storage backend : chrome.storage.local  (key cached in memory after init)
// Key name        : memstore_api_key

const Memstore = (() => {
  const BASE     = 'https://memstore.dev';
  const KEY_NAME = 'memstore_api_key';

  let _cachedKey = '';

  // ── Key storage ──────────────────────────────────────────────────────────────

  function getKey()     { return _cachedKey; }
  function saveKey(key) { _cachedKey = key; chrome.storage.local.set({ [KEY_NAME]: key }); }
  function clearKey()   { _cachedKey = ''; chrome.storage.local.remove(KEY_NAME); }

  // Loads the key from chrome.storage into the in-memory cache — call once on startup
  function init(cb) {
    chrome.storage.local.get(KEY_NAME, d => {
      _cachedKey = d[KEY_NAME] || '';
      if (cb) cb();
    });
  }

  // ── Internal request helper ───────────────────────────────────────────────────

  async function _req(method, path, body) {
    const key = getKey();
    if (!key) throw new Error('No Memstore API key');
    const opts = {
      method,
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + path, opts);
    if (!res.ok) throw new Error(`Memstore HTTP ${res.status}`);
    return res.json();
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  async function testConnection() {
    try {
      await _req('GET', '/v1/memory/recall?q=test&top_k=1');
      return { connected: true, plan: 'connected' };
    } catch (_) {
      return { connected: false };
    }
  }

  async function remember(content) {
    return _req('POST', '/v1/memory/remember', { content });
  }

  async function recall(query) {
    const data = await _req('GET', `/v1/memory/recall?q=${encodeURIComponent(query)}`);
    return data.memories || [];
  }

  async function forget(id) {
    return _req('DELETE', `/v1/memory/forget/${encodeURIComponent(id)}`);
  }

  // ── Convenience helpers ───────────────────────────────────────────────────────

  // Called after every AI response — completely fire-and-forget, never blocks UI
  function rememberResponse(aiName, userMsg, aiResponse) {
    if (!getKey()) return;
    const content = `${aiName} on '${userMsg.slice(0, 50)}': ${aiResponse.slice(0, 150)}`;
    remember(content).catch(err => console.debug('[Memstore] remember failed:', err.message));
  }

  // Called on app launch — returns appended text or null, never throws
  async function recallOnLaunch() {
    if (!getKey()) return null;
    try {
      const results = await recall('recent context and preferences');
      if (!results.length) return null;
      const top3 = results.slice(0, 3)
        .map(m => m.content || m.text || '')
        .filter(Boolean)
        .join('\n');
      return top3 ? '--- Recalled from Memstore ---\n' + top3 : null;
    } catch (err) {
      console.debug('[Memstore] recallOnLaunch failed:', err.message);
      return null;
    }
  }

  return { getKey, saveKey, clearKey, init, testConnection, remember, recall, forget, rememberResponse, recallOnLaunch };
})();
