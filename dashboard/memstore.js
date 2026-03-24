'use strict';

// ── Memstore — persistent memory integration (dashboard) ─────────────────────
// Storage backend : localStorage
// Key name        : memstore_api_key

const Memstore = (() => {
  const BASE     = 'https://memstore.dev';
  const KEY_NAME = 'memstore_api_key';

  // ── Key storage ──────────────────────────────────────────────────────────────

  function getKey()     { try { return localStorage.getItem(KEY_NAME) || ''; } catch (_) { return ''; } }
  function saveKey(key) { try { localStorage.setItem(KEY_NAME, key); } catch (_) {} }
  function clearKey()   { try { localStorage.removeItem(KEY_NAME); } catch (_) {} }

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
    const data = await _req('GET', '/v1/memory/list');
    return {
      connected:    true,
      plan:         data.plan         || 'free',
      opsRemaining: data.opsRemaining ?? data.ops_remaining ?? data.operations_remaining ?? 0,
      storageUsed:  data.storageUsed  || data.storage_used  || '0 B'
    };
  }

  async function remember(content) {
    return _req('POST', '/v1/memory/remember', { content });
  }

  async function recall(query) {
    const data = await _req('GET', `/v1/memory/recall?q=${encodeURIComponent(query)}`);
    return Array.isArray(data) ? data : (data.memories || data.results || []);
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

  return { getKey, saveKey, clearKey, testConnection, remember, recall, forget, rememberResponse, recallOnLaunch };
})();
