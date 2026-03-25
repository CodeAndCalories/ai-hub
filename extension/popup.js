'use strict';

// ── AI Definitions ────────────────────────────────────────────────────────────

const AIS = {
  chatgpt: {
    name: 'ChatGPT', color: '#10a37f', url: 'https://chatgpt.com', placeholder: 'sk-...',
    async call(key, msgs, memory) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: memory ? [{ role: 'system', content: memory }, ...msgs] : msgs })
      });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
      return (await res.json()).choices?.[0]?.message?.content || '';
    }
  },
  claude: {
    name: 'Claude', color: '#cc785c', url: 'https://claude.ai', placeholder: 'sk-ant-...',
    async call(key, msgs, memory) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: memory || undefined, messages: msgs })
      });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
      return (await res.json()).content?.[0]?.text || '';
    }
  },
  gemini: {
    name: 'Gemini', color: '#4285f4', url: 'https://gemini.google.com', placeholder: 'AIza...',
    async call(key, msgs, memory) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
      const body = { contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) };
      if (memory) body.system_instruction = { parts: [{ text: memory }] };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
      return (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
  },
  grok: {
    name: 'Grok', color: '#1d9bf0', url: 'https://grok.com', placeholder: 'xai-...',
    async call(key, msgs, memory) {
      const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'grok-3-latest', messages: memory ? [{ role: 'system', content: memory }, ...msgs] : msgs })
      });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
      return (await res.json()).choices?.[0]?.message?.content || '';
    }
  }
};

// Ollama call helper — used by dynamic ollama slots
async function ollamaCall(msgs, memory, model) {
  const systemMsg = memory ? [{ role: 'system', content: memory }] : [];
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || 'llama3', messages: [...systemMsg, ...msgs], stream: false })
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status} — is Ollama running?`);
  return (await res.json()).message?.content || '';
}

const CLOUD_KEYS = ['chatgpt', 'claude', 'gemini', 'grok'];

const PERSONA_PRESETS = [
  { label: 'Concise',    text: 'Be extremely concise. Answer in 1-3 sentences maximum. No preamble.' },
  { label: 'Socratic',   text: 'Respond with probing questions that challenge my assumptions rather than direct answers.' },
  { label: 'Expert',     text: 'You are a domain expert. Use precise technical language and cite tradeoffs.' },
  { label: 'ELI5',       text: 'Explain everything as if I am five years old. Use simple analogies and short sentences.' },
  { label: 'Devil\'s Advocate', text: 'Always argue the opposite of whatever I say. Be constructively contrarian.' },
];

// ── State ─────────────────────────────────────────────────────────────────────

const S = {
  modes:        {},    // key -> 'api' | 'native' | 'off'
  apiKeys:      {},
  ollamaOn:     false,
  ollamaSlots:  ['llama3'],   // array of model name strings
  ollamaKeys:   [],           // dynamic keys like ['ollama_0', 'ollama_1']
  ollamaModels: {},           // key -> model string
  histories:    {},
  loading:      {},
  unread:       {},
  memory:       '',
  memoryLabel:  '',
  templates:    {},
  view:         4,
  activeTab:    null,
  relayOn:      false,
  personas:    {},
  zoomed:      null
};

// Dynamic key helpers
function allKeys()      { return [...CLOUD_KEYS, ...S.ollamaKeys]; }
function sendableKeys() {
  return allKeys().filter(k => {
    if (!S.modes[k] || S.modes[k] === 'off' || S.modes[k] === 'native') return false;
    if (S.ollamaKeys.includes(k)) return S.ollamaOn;
    return !!S.apiKeys[k];
  });
}
function visibleKeys() { return allKeys().filter(k => S.modes[k] && S.modes[k] !== 'off'); }

// Pending images per panel: key → [{base64, mimeType}]
const pendingImages = {};
// Pinned messages per panel: key → [{text}]
const pinnedMessages = {};

function getSystemPrompt(key) {
  const parts = [S.memory, S.personas[key]].filter(Boolean);
  return parts.join('\n\n---\n\n') || '';
}

// ── Resize ────────────────────────────────────────────────────────────────────

const DEFAULT_W = 660, DEFAULT_H = 600, MIN_W = 480, MIN_H = 360;
let rs = { dragging: false, startX: 0, startY: 0, startW: 0, startH: 0 };

function initResize() {
  chrome.storage.local.get(['aihub_w', 'aihub_h'], d => applySize(d.aihub_w || DEFAULT_W, d.aihub_h || DEFAULT_H));
  const handle = document.getElementById('resizeHandle');
  handle.addEventListener('mousedown', e => {
    rs = { dragging: true, startX: e.clientX, startY: e.clientY, startW: document.body.offsetWidth, startH: document.body.offsetHeight };
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!rs.dragging) return;
    applySize(Math.max(MIN_W, rs.startW + (e.clientX - rs.startX)), Math.max(MIN_H, rs.startH + (e.clientY - rs.startY)));
  });
  document.addEventListener('mouseup', () => {
    if (!rs.dragging) return;
    rs.dragging = false;
    chrome.storage.local.set({ aihub_w: document.body.offsetWidth, aihub_h: document.body.offsetHeight });
  });
}
function applySize(w, h) { document.body.style.width = w + 'px'; document.body.style.minHeight = h + 'px'; }

// ── Setup ─────────────────────────────────────────────────────────────────────

function buildSetup(prefill) {
  const container = document.getElementById('setupRows');
  container.innerHTML = '';

  CLOUD_KEYS.forEach(key => {
    const ai = AIS[key];
    const mode = prefill?.modes?.[key] || 'api';
    S.modes[key] = mode;
    const row = document.createElement('div');
    row.className = 'setup-row';
    row.innerHTML = `
      <div class="setup-row-top">
        <div class="sdot" style="background:${ai.color}"></div>
        <span class="sname">${ai.name}</span>
        <div class="mode-switch">
          <button class="ms-btn ${mode==='api'?'active':''}" data-key="${key}" data-mode="api">API</button>
          <button class="ms-btn ${mode==='native'?'active':''}" data-key="${key}" data-mode="native">Native</button>
          <button class="ms-btn ${mode==='off'?'active':''}" data-key="${key}" data-mode="off">Off</button>
        </div>
      </div>
      <div class="key-row" id="kr-${key}" style="opacity:${mode!=='api'?'0.15':'1'}">
        <input class="key-input" id="ki-${key}" type="password" placeholder="${ai.placeholder}" ${mode!=='api'?'disabled':''} autocomplete="off"/>
      </div>
    `;
    container.appendChild(row);
  });

  container.addEventListener('click', e => {
    const btn = e.target.closest('.ms-btn[data-key]');
    if (!btn) return;
    const { key, mode } = btn.dataset;
    S.modes[key] = mode;
    btn.closest('.mode-switch').querySelectorAll('.ms-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const ki = document.getElementById('ki-' + key);
    const kr = document.getElementById('kr-' + key);
    kr.style.opacity = mode === 'api' ? '1' : '0.15';
    ki.disabled = mode !== 'api';
    if (mode !== 'api') ki.value = '';
  });

  // ── Ollama collapsible ──
  S.ollamaSlots = prefill?.ollamaSlots || ['llama3'];
  S.ollamaOn    = prefill?.ollamaOn || false;
  let ollamaOpen = S.ollamaOn;

  function syncOllamaHeader() {
    const status  = document.getElementById('ollamaStatus');
    const chevron = document.getElementById('ollamaChevron');
    if (status)  status.textContent  = S.ollamaOn ? `on · ${S.ollamaSlots.filter(Boolean).length} model(s)` : 'off — click to enable';
    if (chevron) chevron.className   = 'ollama-chevron' + (ollamaOpen ? ' open' : '');
  }

  function renderSlots() {
    const c = document.getElementById('ollamaSlots');
    c.innerHTML = '';
    S.ollamaSlots.forEach((model, i) => {
      const slot = document.createElement('div');
      slot.className = 'ollama-slot';
      slot.innerHTML = `
        <span class="slot-label">model ${i+1}</span>
        <input class="slot-input" data-idx="${i}" value="${model}" placeholder="llama3, mistral, phi3..."/>
        ${S.ollamaSlots.length > 1 ? `<button class="slot-remove" data-idx="${i}">✕</button>` : ''}
      `;
      c.appendChild(slot);
    });
    c.querySelectorAll('.slot-input').forEach(inp => {
      inp.addEventListener('input', () => { S.ollamaSlots[+inp.dataset.idx] = inp.value.trim(); syncOllamaHeader(); });
    });
    c.querySelectorAll('.slot-remove').forEach(btn => {
      btn.addEventListener('click', () => { S.ollamaSlots.splice(+btn.dataset.idx, 1); renderSlots(); syncOllamaHeader(); });
    });
    const addBtn = document.getElementById('addSlotBtn');
    if (addBtn) addBtn.style.display = S.ollamaSlots.length >= 4 ? 'none' : 'block';
  }

  document.getElementById('ollamaToggleRow').addEventListener('click', () => {
    ollamaOpen = !ollamaOpen;
    S.ollamaOn  = ollamaOpen;
    const exp = document.getElementById('ollamaExpanded');
    exp.style.display = ollamaOpen ? 'block' : 'none';
    if (ollamaOpen) renderSlots();
    syncOllamaHeader();
  });

  document.getElementById('addSlotBtn').addEventListener('click', () => {
    if (S.ollamaSlots.length >= 4) return;
    S.ollamaSlots.push('');
    renderSlots(); syncOllamaHeader();
  });

  document.getElementById('detectModels').addEventListener('click', async () => {
    const btn = document.getElementById('detectModels');
    btn.textContent = 'detecting...';
    try {
      const res  = await fetch('http://localhost:11434/api/tags');
      if (!res.ok) throw new Error();
      const data   = await res.json();
      const models = data.models?.map(m => m.name) || [];
      const chips  = document.getElementById('modelChips');
      chips.innerHTML = '';
      if (!models.length) {
        chips.innerHTML = '<span style="font-size:11px;color:#444;">No models found — run <code>ollama pull llama3</code></span>';
      } else {
        models.forEach(m => {
          const chip = document.createElement('button');
          chip.className = 'model-chip'; chip.textContent = m;
          chip.addEventListener('click', () => {
            const empty = S.ollamaSlots.findIndex(s => !s);
            if (empty >= 0) S.ollamaSlots[empty] = m;
            else if (S.ollamaSlots.length < 4) S.ollamaSlots.push(m);
            renderSlots(); syncOllamaHeader();
            chips.querySelectorAll('.model-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
          });
          chips.appendChild(chip);
        });
      }
      btn.textContent = models.length ? `${models.length} found` : 'none found';
    } catch (_) {
      btn.textContent = 'Ollama not running';
      setTimeout(() => { btn.textContent = 'detect models'; }, 2000);
    }
  });

  document.getElementById('ollamaInstallLink').addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://ollama.com/download' });
  });

  // init open state
  if (ollamaOpen) {
    document.getElementById('ollamaExpanded').style.display = 'block';
    renderSlots();
  }
  syncOllamaHeader();

  if (prefill?.memoryLabel) document.getElementById('memLabel').value = prefill.memoryLabel;
  document.getElementById('goBtn').onclick = launch;
}

// ── Launch ────────────────────────────────────────────────────────────────────

function launch() {
  // Cloud keys
  CLOUD_KEYS.forEach(key => {
    S.apiKeys[key]  = S.modes[key] === 'api' ? (document.getElementById('ki-' + key)?.value?.trim() || '') : '';
    S.histories[key] = []; S.loading[key] = false; S.unread[key] = 0;
  });

  // Ollama dynamic keys
  S.ollamaKeys   = [];
  S.ollamaModels = {};
  if (S.ollamaOn) {
    S.ollamaSlots.filter(Boolean).forEach((model, i) => {
      const key = `ollama_${i}`;
      S.ollamaKeys.push(key);
      S.ollamaModels[key] = model;
      S.modes[key]     = 'api';
      S.histories[key] = [];
      S.loading[key]   = false;
      S.unread[key]    = 0;
    });
  }

  S.memoryLabel = document.getElementById('memLabel').value.trim();
  chrome.storage.local.set({
    aihub_modes: { ...S.modes }, aihub_memLabel: S.memoryLabel,
    aihub_ollamaOn: S.ollamaOn, aihub_ollamaSlots: S.ollamaSlots
  });

  loadMemory(); loadTemplates();

  // Memstore auto-recall — silently appends top-3 results before first chat
  Memstore.recallOnLaunch().then(recalled => {
    if (recalled) S.memory = (S.memory ? S.memory + '\n\n' : '') + recalled;
  }).catch(() => {});

  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display  = 'block';
  S.activeTab = sendableKeys()[0] || visibleKeys()[0] || null;
  buildPanels(); bindMain(); setView(S.view);
}

function goToSettings() {
  document.getElementById('mainScreen').style.display  = 'none';
  document.getElementById('memDrawer').style.display   = 'none';
  document.getElementById('padDrawer').style.display   = 'none';
  document.getElementById('setupScreen').style.display = 'block';
  chrome.storage.local.get(['aihub_modes','aihub_memLabel','aihub_ollamaOn','aihub_ollamaSlots'], d => {
    buildSetup({ modes: d.aihub_modes, memoryLabel: d.aihub_memLabel, ollamaOn: d.aihub_ollamaOn, ollamaSlots: d.aihub_ollamaSlots });
  });
}

// ── Panels ────────────────────────────────────────────────────────────────────

function buildPanels() {
  const container = document.getElementById('panels');
  container.innerHTML = '';

  allKeys().forEach(key => {
    const mode     = S.modes[key];
    if (!mode || mode === 'off') return;
    const isOllama = S.ollamaKeys.includes(key);
    const ai       = isOllama ? null : AIS[key];
    const name     = isOllama ? `Ollama · ${S.ollamaModels[key]}` : ai.name;
    const color    = isOllama ? '#e8704a' : ai.color;
    const hasKey   = isOllama ? S.ollamaOn : (mode === 'api' && !!S.apiKeys[key]);

    const panel = document.createElement('div');
    panel.className = 'panel'; panel.id = 'p-' + key;
    panel.innerHTML = `
      <div class="ph">
        <div class="ph-dot" style="background:${color}"></div>
        <span class="ph-name" style="color:${color}">${name}</span>
        <span class="ph-badge ${isOllama ? 'ollama' : mode}">${isOllama ? 'local' : mode}</span>
        <div class="ph-actions" id="pha-${key}"></div>
      </div>
      ${mode === 'native' ? nativeBody(key, ai) : apiBody(key, name, hasKey, isOllama)}
    `;
    container.appendChild(panel);

    // Wire action buttons via addEventListener — NO inline onclick
    const actions = panel.querySelector('.ph-actions');
    if (mode === 'native') {
      const openBtn = makeBtn('open ↗', () => openNative(key));
      actions.appendChild(openBtn);
    } else {
      const personaBtn = makeBtn('🎭', () => togglePersona(key));
      personaBtn.id = 'pb-' + key;
      personaBtn.title = 'Set persona / system prompt';
      personaBtn.className = 'pa-btn persona-btn';
      actions.appendChild(personaBtn);

      const zoomBtn = makeBtn('⤢', () => toggleZoom(key));
      zoomBtn.id = 'zb-' + key;
      zoomBtn.title = 'Zoom panel';
      zoomBtn.className = 'pa-btn zoom-btn';
      actions.appendChild(zoomBtn);

      actions.appendChild(makeBtn('clear',     () => clearChat(key)));
      actions.appendChild(makeBtn('copy last', () => copyLast(key)));
    }

    // Wire native body open button
    const nativeOpenBtn = panel.querySelector('.native-open');
    if (nativeOpenBtn) nativeOpenBtn.addEventListener('click', () => openNative(key));

    // Persona popover
    if (mode !== 'native') {
      const ph = panel.querySelector('.ph');
      if (ph) ph.id = 'ph-' + key;

      // Insert persona popover after .ph
      const popover = document.createElement('div');
      popover.className = 'persona-popover';
      popover.id = 'pp-' + key;
      popover.style.display = 'none';
      const presetsDiv = document.createElement('div');
      presetsDiv.className = 'persona-presets';
      presetsDiv.id = 'pps-' + key;
      PERSONA_PRESETS.forEach(preset => {
        const btn = document.createElement('button');
        btn.className = 'preset-chip'; btn.textContent = preset.label;
        btn.addEventListener('click', () => { document.getElementById('pt-' + key).value = preset.text; });
        presetsDiv.appendChild(btn);
      });
      const textarea = document.createElement('textarea');
      textarea.className = 'persona-textarea'; textarea.id = 'pt-' + key;
      textarea.placeholder = 'System prompt for this panel only... (combined with global memory)';
      const footer = document.createElement('div');
      footer.className = 'persona-footer';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'pf-btn'; saveBtn.textContent = 'apply';
      saveBtn.addEventListener('click', () => {
        const text = textarea.value.trim();
        S.personas[key] = text || '';
        updatePersonaIndicator(key);
        popover.style.display = 'none';
        showToast(text ? 'Persona applied ✓' : 'Persona cleared');
      });
      const clearBtn = document.createElement('button');
      clearBtn.className = 'pf-btn'; clearBtn.textContent = 'clear persona';
      clearBtn.addEventListener('click', () => {
        S.personas[key] = ''; textarea.value = '';
        updatePersonaIndicator(key); showToast('Persona cleared');
      });
      footer.appendChild(saveBtn); footer.appendChild(clearBtn);
      popover.appendChild(presetsDiv); popover.appendChild(textarea); popover.appendChild(footer);
      // Insert between .ph and the body
      panel.insertBefore(popover, panel.children[1]);

      // Double-click header to zoom
      if (ph) ph.addEventListener('dblclick', () => toggleZoom(key));
    }

    if (mode !== 'native') bindChat(key);
  });
}

function makeBtn(label, fn) {
  const b = document.createElement('button');
  b.className = 'pa-btn'; b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function togglePersona(key) {
  const pp = document.getElementById('pp-' + key);
  if (!pp) return;
  const open = pp.style.display !== 'none';
  pp.style.display = open ? 'none' : 'block';
  if (!open) {
    const pt = document.getElementById('pt-' + key);
    if (pt && S.personas[key]) pt.value = S.personas[key];
  }
}

function updatePersonaIndicator(key) {
  const btn = document.getElementById('pb-' + key);
  if (btn) btn.classList.toggle('persona-active', !!S.personas[key]);
}

function toggleZoom(key) {
  S.zoomed = (S.zoomed === key) ? null : key;
  applyZoom();
}

function applyZoom() {
  const allVisible = visibleKeys();
  if (!S.zoomed || !allVisible.includes(S.zoomed)) {
    S.zoomed = null;
    allVisible.forEach(k => {
      const p = document.getElementById('p-' + k);
      if (p) p.classList.remove('zoomed');
      const zb = document.getElementById('zb-' + k);
      if (zb) zb.textContent = '⤢';
    });
    setView(S.view);
    return;
  }
  document.getElementById('panels').className = 'panels v4';
  allVisible.forEach(k => {
    const p = document.getElementById('p-' + k);
    if (!p) return;
    if (k === S.zoomed) {
      p.classList.add('zoomed'); p.classList.remove('hidden');
      const zb = document.getElementById('zb-' + k); if (zb) zb.textContent = '⤡';
    } else {
      p.classList.remove('zoomed'); p.classList.add('hidden');
      const zb = document.getElementById('zb-' + k); if (zb) zb.textContent = '⤢';
    }
  });
}

function nativeBody(key, ai) {
  return `<div class="native-body">
    <div class="native-label">Your real <strong style="color:${ai.color}">${ai.name}</strong> account.<br>Full memory &amp; chat history.</div>
    <button class="native-open">↗ open ${ai.name}</button>
    <div class="native-hint">Nothing goes through AI Hub.</div>
  </div>`;
}

function apiBody(key, name, hasKey, isOllama) {
  if (isOllama && !S.ollamaOn) {
    return `<div class="ollama-offline">
      <div class="ollama-offline-title">Ollama not running</div>
      <div class="ollama-offline-hint">Run <code>ollama serve</code> then reload.</div>
    </div>`;
  }
  return `
    <div class="chat-messages" id="cm-${key}">
      <div class="empty-state" id="es-${key}">
        <span class="en">${name}</span>
        <span class="eh">${hasKey ? (isOllama ? 'local · free · ready' : 'ready') : '⚠ no api key'}</span>
        <span class="ek">${hasKey ? (S.memory ? 'memory loaded' : 'no memory set') : 'go to ⚙ settings'}</span>
      </div>
    </div>
    <div class="image-preview-strip" id="ips-${key}" style="display:none;"></div>
    <div class="chat-input-row">
      <label class="img-upload-btn" title="Attach image">
        🖼
        <input type="file" accept="image/*" class="img-file-input" id="ifi-${key}" style="display:none;" multiple/>
      </label>
      <textarea class="chat-textarea" id="ct-${key}" placeholder="Message... (Enter to send)" rows="1"></textarea>
      <button class="send-btn" id="sb-${key}">send</button>
    </div>`;
}

function bindChat(key) {
  const ta = document.getElementById('ct-' + key);
  const sb = document.getElementById('sb-' + key);
  if (!ta || !sb) return;
  sb.addEventListener('click', () => send(key));
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(key); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 75) + 'px'; });

  // Image file input
  const fileInput = document.getElementById('ifi-' + key);
  if (fileInput) fileInput.addEventListener('change', e => handleImageFiles(key, Array.from(e.target.files)));

  // Paste images
  ta.addEventListener('paste', e => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(i => i.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    handleImageFiles(key, imageItems.map(i => i.getAsFile()).filter(Boolean));
  });

  // Drag-drop images
  const panel = document.getElementById('p-' + key);
  if (panel) {
    panel.addEventListener('dragover', e => { e.preventDefault(); panel.classList.add('drag-over'); });
    panel.addEventListener('dragleave', () => panel.classList.remove('drag-over'));
    panel.addEventListener('drop', e => {
      e.preventDefault(); panel.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
      if (files.length) handleImageFiles(key, files);
    });
  }
}

// ── View & Tabs ───────────────────────────────────────────────────────────────

function setView(v) {
  S.view = v;
  document.querySelectorAll('.vb').forEach(b => b.classList.toggle('active', parseInt(b.dataset.v) === v));
  chrome.storage.local.set({ aihub_view: v });
  const vk = visibleKeys();

  if (v === 4) {
    document.getElementById('tabBar').style.display = 'none';
    document.getElementById('panels').className = 'panels v4';
    allKeys().forEach(key => {
      const p = document.getElementById('p-' + key);
      if (p) p.classList.toggle('hidden', !S.modes[key] || S.modes[key] === 'off');
    });
    return;
  }

  document.getElementById('panels').className = 'panels v' + v;
  const shown = buildShownList(v);
  allKeys().forEach(key => {
    const p = document.getElementById('p-' + key);
    if (!p) return;
    p.classList.toggle('hidden', !shown.includes(key));
  });
  buildTabBar(v, vk);
}

function buildShownList(v) {
  const vk = visibleKeys();
  if (!S.activeTab || !vk.includes(S.activeTab)) S.activeTab = vk[0];
  return [S.activeTab, ...vk.filter(k => k !== S.activeTab)].slice(0, v);
}

function buildTabBar(v, vk) {
  const bar = document.getElementById('tabBar');
  if (vk.length <= v) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex'; bar.innerHTML = '';
  const shown = buildShownList(v);
  vk.forEach(key => {
    const isOllama = S.ollamaKeys.includes(key);
    const color    = isOllama ? '#e8704a' : AIS[key]?.color;
    const label    = isOllama ? `Ollama·${S.ollamaModels[key]}` : AIS[key]?.name;
    const tab = document.createElement('button');
    tab.className = 'ai-tab' + (shown.includes(key) ? ' active' : '');
    const u = S.unread[key] || 0;
    tab.innerHTML = `<div class="tab-dot" style="background:${color}"></div><span>${label}</span>${u > 0 ? `<span class="tab-unread">${u}</span>` : ''}`;
    tab.addEventListener('click', () => {
      if (S.modes[key] === 'native') { openNative(key); return; }
      S.activeTab = key; S.unread[key] = 0; setView(S.view);
    });
    bar.appendChild(tab);
  });
}

// ── Image handling ────────────────────────────────────────────────────────────

function handleImageFiles(key, files) {
  if (!files.length) return;
  if (!pendingImages[key]) pendingImages[key] = [];
  const strip = document.getElementById('ips-' + key);

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return;
      const [, mimeType, base64] = match;
      const idx = pendingImages[key].length;
      pendingImages[key].push({ base64, mimeType });

      if (strip) {
        strip.style.display = 'flex';
        const thumb = document.createElement('div');
        thumb.className = 'img-thumb';
        thumb.dataset.idx = idx;
        thumb.innerHTML = `<img src="${dataUrl}" alt=""/><button class="img-thumb-rm" data-key="${key}" data-idx="${idx}">✕</button>`;
        thumb.querySelector('.img-thumb-rm').addEventListener('click', () => {
          pendingImages[key].splice(parseInt(thumb.dataset.idx), 1);
          thumb.remove();
          if (!pendingImages[key].length) strip.style.display = 'none';
          Array.from(strip.children).forEach((t, i) => { t.dataset.idx = i; const r = t.querySelector('.img-thumb-rm'); if(r) r.dataset.idx = i; });
        });
        strip.appendChild(thumb);
      }
    };
    reader.readAsDataURL(file);
  });

  const fi = document.getElementById('ifi-' + key);
  if (fi) fi.value = '';
}

// ── Send ──────────────────────────────────────────────────────────────────────

async function send(key, textOverride, isRelay) {
  if (S.loading[key]) return;
  const mode = S.modes[key];
  if (!mode || mode === 'off' || mode === 'native') return;
  const isOllama = S.ollamaKeys.includes(key);
  if (isOllama && !S.ollamaOn) return;

  const ta = document.getElementById('ct-' + key);
  const text = textOverride !== undefined ? textOverride : ta?.value?.trim();
  if (!text) return;
  if (ta && textOverride === undefined) { ta.value = ''; ta.style.height = 'auto'; }

  if (!isOllama && !S.apiKeys[key]) { showToast(`No API key for ${AIS[key]?.name}`); return; }

  // Grab pending images and clear the strip
  const imgs = (pendingImages[key] || []).slice();
  pendingImages[key] = [];
  const strip = document.getElementById('ips-' + key);
  if (strip) { strip.style.display = 'none'; strip.innerHTML = ''; }

  document.getElementById('es-' + key)?.remove();
  if (!isRelay) {
    S.histories[key].push({ role: 'user', content: text });
    addBubble(key, 'user', text, imgs);
  }

  const tid = addTyping(key);
  S.loading[key] = true; setSend(key, true);

  try {
    const sys = getSystemPrompt(key);
    let reply;
    if (imgs.length && !isOllama) {
      reply = await callAIVision(key, S.histories[key], sys, text, imgs);
    } else {
      reply = isOllama
        ? await ollamaCall(S.histories[key], sys, S.ollamaModels[key])
        : await AIS[key].call(S.apiKeys[key], S.histories[key], sys);
    }
    removeEl(tid);
    S.histories[key].push({ role: 'assistant', content: reply });
    addBubble(key, 'assistant', reply);
    const shown = S.view === 4 ? visibleKeys() : buildShownList(S.view);
    if (!shown.includes(key)) { S.unread[key] = (S.unread[key] || 0) + 1; buildTabBar(S.view, visibleKeys()); }
    if (S.histories[key].length % 20 === 0) autoSummarizeOne(key);
    // Memstore auto-save — fire-and-forget
    const aiName = S.ollamaKeys.includes(key) ? `Ollama·${S.ollamaModels[key]}` : (AIS[key]?.name || key);
    Memstore.rememberResponse(aiName, text, reply);
  } catch (err) {
    removeEl(tid);
    addBubble(key, 'assistant', '⚠ ' + err.message);
  }
  S.loading[key] = false; setSend(key, false);
}

// ── Sharing ───────────────────────────────────────────────────────────────────

function labelFor(key) {
  return S.ollamaKeys.includes(key) ? `Ollama·${S.ollamaModels[key]}` : AIS[key]?.name;
}

function shareToAll(fromKey, text) {
  const targets = sendableKeys().filter(k => k !== fromKey);
  if (!targets.length) { showToast('No other panels to share to'); return; }
  targets.forEach(toKey => {
    document.getElementById('es-' + toKey)?.remove();
    addRelayedBubble(toKey, fromKey, text);
    S.histories[toKey].push({ role: 'user', content: `[Context from ${labelFor(fromKey)}]: ${text}` });
  });
  showToast(`Shared to ${targets.length} panel${targets.length > 1 ? 's' : ''}`);
}

function addRelayedBubble(toKey, fromKey, text) {
  const cm = document.getElementById('cm-' + toKey);
  if (!cm) return;
  const wrap = document.createElement('div');
  wrap.className = 'msg relayed';
  const lbl = document.createElement('div');
  lbl.className = 'relay-label'; lbl.textContent = `↙ from ${labelFor(fromKey)}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble'; bubble.textContent = text;
  wrap.appendChild(lbl); wrap.appendChild(bubble);
  cm.appendChild(wrap); cm.scrollTop = cm.scrollHeight;
}

async function broadcastAndRelay(text) {
  const targets = sendableKeys();
  if (!targets.length) { showToast('No active panels'); return; }
  await Promise.allSettled(targets.map(k => send(k, text)));
  if (!S.relayOn) return;
  await new Promise(r => setTimeout(r, 400));
  const replies = {};
  targets.forEach(k => {
    const last = [...S.histories[k]].reverse().find(m => m.role === 'assistant');
    if (last) replies[k] = last.content;
  });
  Object.entries(replies).forEach(([fromKey, reply]) => {
    targets.filter(k => k !== fromKey).forEach(toKey => {
      addRelayedBubble(toKey, fromKey, reply);
      S.histories[toKey].push({ role: 'user', content: `[${labelFor(fromKey)} responded]: ${reply}` });
    });
  });
  showToast('Responses cross-shared ✓');
}

// ── Bubble helpers ────────────────────────────────────────────────────────────

function addBubble(key, role, text, images) {
  const cm = document.getElementById('cm-' + key);
  if (!cm) return;
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (role === 'user' && images && images.length) {
    const imgRow = document.createElement('div');
    imgRow.className = 'bubble-imgs';
    images.forEach(img => {
      const im = document.createElement('img');
      im.src = `data:${img.mimeType};base64,${img.base64}`;
      im.className = 'bubble-img-thumb';
      imgRow.appendChild(im);
    });
    bubble.appendChild(imgRow);
    if (text) { const t = document.createElement('div'); t.textContent = text; bubble.appendChild(t); }
  } else {
    bubble.textContent = text;
  }

  wrap.appendChild(bubble);
  if (role === 'assistant') {
    const acts = document.createElement('div');
    acts.className = 'msg-actions';
    const c = document.createElement('button');
    c.className = 'ma-btn'; c.textContent = 'copy';
    c.addEventListener('click', () => navigator.clipboard.writeText(text).then(() => showToast('Copied!')));
    const p = document.createElement('button');
    p.className = 'ma-btn'; p.textContent = '→ pad';
    p.addEventListener('click', () => {
      const pad = document.getElementById('padText');
      pad.value += (pad.value ? '\n\n' : '') + `[${labelFor(key)}]\n${text}`;
      showToast('→ scratchpad');
    });
    const s = document.createElement('button');
    s.className = 'ma-btn share-all'; s.textContent = '→ all';
    s.title = 'Share this response to all other panels as context';
    s.addEventListener('click', () => shareToAll(key, text));
    const pinBtn = document.createElement('button');
    pinBtn.className = 'ma-btn pin-btn'; pinBtn.textContent = '📌 pin';
    pinBtn.addEventListener('click', () => pinMessage(key, text, pinBtn));
    acts.appendChild(c); acts.appendChild(p); acts.appendChild(s); acts.appendChild(pinBtn);
    wrap.appendChild(acts);
  }
  cm.appendChild(wrap); cm.scrollTop = cm.scrollHeight;
}

function pinMessage(key, text, btn) {
  if (!pinnedMessages[key]) pinnedMessages[key] = [];
  if (pinnedMessages[key].some(p => p.text === text)) { showToast('Already pinned'); return; }
  pinnedMessages[key].push({ text });
  if (btn) { btn.textContent = '📌 pinned'; btn.disabled = true; }
  renderPinnedSection(key);
  showToast('Pinned ✓');
}

function renderPinnedSection(key) {
  const cm = document.getElementById('cm-' + key);
  if (!cm) return;
  let pinSection = document.getElementById('pinned-' + key);
  const pins = pinnedMessages[key] || [];
  if (!pins.length) { if (pinSection) pinSection.remove(); return; }
  if (!pinSection) {
    pinSection = document.createElement('div');
    pinSection.id = 'pinned-' + key;
    pinSection.className = 'pinned-section';
    cm.insertBefore(pinSection, cm.firstChild);
  }
  pinSection.innerHTML = `<div class="pinned-header"><span>📌 pinned (${pins.length})</span><button class="pinned-toggle" id="pt-tog-${key}">▾</button></div><div class="pinned-list" id="pl-${key}"></div>`;
  const list = pinSection.querySelector('#pl-' + key);
  pins.forEach((pin, i) => {
    const item = document.createElement('div');
    item.className = 'pinned-item';
    item.innerHTML = `<span class="pinned-text">${pin.text.slice(0, 100)}${pin.text.length > 100 ? '…' : ''}</span><button class="pinned-rm">✕</button>`;
    item.querySelector('.pinned-rm').addEventListener('click', () => { pinnedMessages[key].splice(i, 1); renderPinnedSection(key); });
    list.appendChild(item);
  });
  pinSection.querySelector('#pt-tog-' + key).addEventListener('click', () => {
    const l = pinSection.querySelector('#pl-' + key);
    l.style.display = l.style.display === 'none' ? 'block' : 'none';
    pinSection.querySelector('#pt-tog-' + key).textContent = l.style.display === 'none' ? '▸' : '▾';
  });
}

function addTyping(key) {
  const cm = document.getElementById('cm-' + key);
  if (!cm) return null;
  const id = 'ty' + key + Date.now();
  const el = document.createElement('div');
  el.id = id; el.className = 'typing-wrap';
  el.innerHTML = '<div class="typing"><div class="td"></div><div class="td"></div><div class="td"></div></div>';
  cm.appendChild(el); cm.scrollTop = cm.scrollHeight;
  return id;
}
function removeEl(id) { if (id) document.getElementById(id)?.remove(); }
function setSend(key, d) { const sb = document.getElementById('sb-' + key); if (sb) sb.disabled = d; }

// ── Native tab — uses background service worker ───────────────────────────────
// FIX: window.open is blocked in extension popups. Must use chrome.runtime.sendMessage.

function openNative(key) {
  const url = AIS[key]?.url;
  if (!url) return;
  // Send to background.js which has chrome.tabs access
  chrome.runtime.sendMessage({ action: 'focusTab', aiKey: key }, () => {
    // If no existing tab, background opens a new one
    if (chrome.runtime.lastError) {
      // Fallback: open directly
      chrome.tabs.create({ url, active: true });
    }
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────

function clearChat(key) {
  S.histories[key] = [];
  pinnedMessages[key] = [];
  pendingImages[key] = [];
  const cm = document.getElementById('cm-' + key);
  if (!cm) return;
  const name = S.ollamaKeys.includes(key) ? `Ollama·${S.ollamaModels[key]}` : AIS[key]?.name;
  cm.innerHTML = `<div class="empty-state" id="es-${key}"><span class="en">${name}</span><span class="eh">cleared</span></div>`;
  const strip = document.getElementById('ips-' + key);
  if (strip) { strip.style.display = 'none'; strip.innerHTML = ''; }
  showToast('Chat cleared');
}

function copyLast(key) {
  const last = [...(S.histories[key] || [])].reverse().find(m => m.role === 'assistant');
  if (last) navigator.clipboard.writeText(last.content).then(() => showToast('Copied!'));
  else showToast('No response yet');
}

// ── Memory ────────────────────────────────────────────────────────────────────

function loadMemory() {
  if (!S.memoryLabel) return;
  try { S.memory = localStorage.getItem('aihub5_mem_' + S.memoryLabel) || ''; } catch (_) {}
}

function saveMemory() {
  S.memory = document.getElementById('memText').value;
  if (!S.memoryLabel) { showToast('Add a memory label in ⚙ settings first'); return; }
  try {
    localStorage.setItem('aihub5_mem_' + S.memoryLabel, S.memory);
    setMemStatus('Saved ✓');
  } catch (_) { showToast('Save failed'); }
}

function setMemStatus(msg) {
  const el = document.getElementById('memAutosave');
  if (el) { el.textContent = msg; setTimeout(() => { el.textContent = ''; }, 2500); }
}

async function autoSummarizeAll() {
  const active = sendableKeys().filter(k => (S.histories[k] || []).length > 0);
  if (!active.length) { showToast('No conversations to summarize'); return; }
  setMemStatus('Summarizing...');
  const summaries = [];
  for (const key of active) { const s = await summarizeHistory(key); if (s) summaries.push(`[${labelFor(key)}]: ${s}`); }
  if (summaries.length) {
    S.memory = (S.memory ? S.memory + '\n\n' : '') + '--- Auto-summary ---\n' + summaries.join('\n');
    document.getElementById('memText').value = S.memory;
    if (S.memoryLabel) { try { localStorage.setItem('aihub5_mem_' + S.memoryLabel, S.memory); } catch (_) {} }
    setMemStatus('Summaries appended ✓');
  }
}

async function autoSummarizeOne(key) {
  const s = await summarizeHistory(key); if (!s) return;
  S.memory = (S.memory ? S.memory + '\n' : '') + `[${labelFor(key)} summary]: ${s}`;
  const mt = document.getElementById('memText'); if (mt) mt.value = S.memory;
  if (S.memoryLabel) { try { localStorage.setItem('aihub5_mem_' + S.memoryLabel, S.memory); } catch (_) {} }
  setMemStatus(`Auto-saved ${labelFor(key)} summary`);
}

async function summarizeHistory(key) {
  const hist = S.histories[key] || []; if (!hist.length) return null;
  const sk = sendableKeys()[0]; if (!sk) return null;
  const prompt = `Summarize the key points of this conversation in 2-3 sentences:\n\n${hist.map(m => `${m.role}: ${m.content}`).join('\n')}`;
  try {
    if (S.ollamaKeys.includes(sk)) return await ollamaCall([{ role: 'user', content: prompt }], null, S.ollamaModels[sk]);
    return await AIS[sk].call(S.apiKeys[sk], [{ role: 'user', content: prompt }], null);
  } catch (_) { return null; }
}

// ── Templates ─────────────────────────────────────────────────────────────────

function loadTemplates() {
  try { S.templates = JSON.parse(localStorage.getItem('aihub5_templates') || '{}'); } catch (_) { S.templates = {}; }
}
function saveTemplates() { try { localStorage.setItem('aihub5_templates', JSON.stringify(S.templates)); } catch (_) {} }

function renderTemplates() {
  const list  = document.getElementById('tplList');
  const names = Object.keys(S.templates);
  if (!names.length) { list.innerHTML = '<span class="tpl-empty">No templates yet.</span>'; return; }
  list.innerHTML = '';
  names.forEach(name => {
    const chip = document.createElement('div');
    chip.className = 'tpl-chip';
    chip.innerHTML = `<span>${name}</span><button class="tpl-del">✕</button>`;
    chip.querySelector('span').addEventListener('click', () => {
      S.memory = S.templates[name];
      document.getElementById('memText').value = S.memory;
      showToast(`Loaded "${name}"`);
    });
    chip.querySelector('.tpl-del').addEventListener('click', e => {
      e.stopPropagation(); delete S.templates[name]; saveTemplates(); renderTemplates();
    });
    list.appendChild(chip);
  });
}

function bindTemplates() {
  document.getElementById('tplBtn').addEventListener('click', () => {
    const p = document.getElementById('tplPanel');
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
    renderTemplates();
  });
  document.getElementById('closeTplBtn').addEventListener('click', () => { document.getElementById('tplPanel').style.display = 'none'; });
  document.getElementById('saveTplBtn').addEventListener('click', () => {
    const name = document.getElementById('tplNameInput').value.trim();
    if (!name) { showToast('Enter a template name'); return; }
    S.templates[name] = document.getElementById('memText').value;
    saveTemplates(); renderTemplates();
    document.getElementById('tplNameInput').value = '';
    showToast(`"${name}" saved`);
  });
}

// ── Drawers ───────────────────────────────────────────────────────────────────

function bindDrawers() {
  const memD = document.getElementById('memDrawer');
  const padD = document.getElementById('padDrawer');
  const toggle = (show, hide) => {
    hide.style.display = 'none';
    const open = show.style.display !== 'none';
    show.style.display = open ? 'none' : 'flex';
    if (!open) show.style.flexDirection = 'column';
  };
  document.getElementById('memBtn').addEventListener('click', () => {
    toggle(memD, padD);
    document.getElementById('memText').value = S.memory;
    const lbl = document.getElementById('memLabelDisplay');
    if (lbl) lbl.textContent = S.memoryLabel ? `· ${S.memoryLabel}` : '';
  });
  document.getElementById('saveMemBtn').addEventListener('click', saveMemory);
  document.getElementById('autoSumBtn').addEventListener('click', autoSummarizeAll);
  document.getElementById('closeMemBtn').addEventListener('click', () => { memD.style.display = 'none'; });
  document.getElementById('memText').addEventListener('input', e => { S.memory = e.target.value; });
  document.getElementById('padBtn').addEventListener('click', () => toggle(padD, memD));
  document.getElementById('clearPadBtn').addEventListener('click', () => { document.getElementById('padText').value = ''; showToast('Cleared'); });
  document.getElementById('closePadBtn').addEventListener('click', () => { padD.style.display = 'none'; });
  bindMemstore();
}

// ── Memstore UI ───────────────────────────────────────────────────────────────

function renderMemstoreUI() {
  const connected = !!Memstore.getKey();
  document.getElementById('memstoreDisconnected').style.display = connected ? 'none' : 'block';
  document.getElementById('memstoreConnected').style.display    = connected ? 'block' : 'none';
}

function bindMemstore() {
  renderMemstoreUI();

  document.getElementById('memstoreConnectBtn').addEventListener('click', async () => {
    const btn = document.getElementById('memstoreConnectBtn');
    const raw = document.getElementById('memstoreKeyInput').value.trim();
    if (!raw) { showToast('Paste your Memstore key first'); return; }
    btn.disabled = true; btn.textContent = 'Connecting...';
    Memstore.saveKey(raw);
    try {
      const info = await Memstore.testConnection();
      document.getElementById('memstoreKeyInput').value = '';
      document.getElementById('memstoreOps').textContent     = info.opsRemaining;
      document.getElementById('memstoreStorage').textContent = info.storageUsed;
      document.getElementById('memstorePlan').textContent    = info.plan;
      renderMemstoreUI();
      showToast('Memstore connected ✓');
    } catch (err) {
      Memstore.clearKey();
      renderMemstoreUI();
      showToast('Connection failed — check your key');
      console.debug('[Memstore] connect error:', err.message);
    }
    btn.disabled = false; btn.textContent = 'Connect';
  });

  document.getElementById('memstoreDisconnectBtn').addEventListener('click', () => {
    Memstore.clearKey();
    renderMemstoreUI();
    showToast('Memstore disconnected');
  });

  document.getElementById('memstoreRecallBtn').addEventListener('click', async () => {
    const btn = document.getElementById('memstoreRecallBtn');
    btn.disabled = true; btn.textContent = 'Recalling...';
    try {
      const query = S.memoryLabel || 'recent context and preferences';
      const results = await Memstore.recall(query);
      if (!results.length) { showToast('No memories found'); }
      else {
        const text = results.slice(0, 3).map(m => m.content || m.text || '').filter(Boolean).join('\n');
        if (text) {
          const mt = document.getElementById('memText');
          mt.value = mt.value ? mt.value + '\n\n--- Recalled from Memstore ---\n' + text : '--- Recalled from Memstore ---\n' + text;
          S.memory = mt.value;
          showToast(`Recalled ${Math.min(results.length, 3)} memories ✓`);
        }
      }
    } catch (err) {
      showToast('Recall failed');
      console.debug('[Memstore] recall error:', err.message);
    }
    btn.disabled = false; btn.textContent = 'Recall recent memories';
  });
}

// ── Debate Engine ─────────────────────────────────────────────────────────────

const D = { running: false, rounds: 2, currentRound: 0, topic: '', lastReplies: {} };

function bindDebate() {
  const debateBtn  = document.getElementById('debateBtn');
  const debateBar  = document.getElementById('debateBar');
  const broadcastBar = document.getElementById('broadcastBar');

  // toggle debate mode
  debateBtn.addEventListener('click', () => {
    const open = debateBar.style.display !== 'none';
    debateBar.style.display  = open ? 'none' : 'flex';
    broadcastBar.style.display = open ? 'flex' : 'none';
    debateBtn.classList.toggle('active', !open);
    document.getElementById('summaryBar').style.display = 'none';
  });

  // round selector
  document.querySelectorAll('.round-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      D.rounds = parseInt(btn.dataset.rounds);
      document.querySelectorAll('.round-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // start debate
  document.getElementById('debateStartBtn').addEventListener('click', startDebate);
  document.getElementById('debateInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') startDebate();
  });

  // summary
  document.getElementById('summaryBtn').addEventListener('click', summarizeDebate);
  document.getElementById('summaryCloseBtn').addEventListener('click', () => {
    document.getElementById('summaryBar').style.display = 'none';
  });
}

async function startDebate() {
  if (D.running) return;
  const topic = document.getElementById('debateInput').value.trim();
  if (!topic) { showToast('Enter a debate topic'); return; }
  const targets = sendableKeys();
  if (targets.length < 2) { showToast('Need at least 2 active API panels to debate'); return; }

  D.running = true; D.topic = topic; D.currentRound = 0; D.lastReplies = {};
  document.getElementById('debateInput').value = '';
  document.getElementById('debateStartBtn').disabled = true;
  document.getElementById('summaryBar').style.display = 'none';

  // inject round header into all panels
  const addRoundHeader = (round) => {
    targets.forEach(key => {
      const cm = document.getElementById('cm-' + key);
      if (!cm) return;
      document.getElementById('es-' + key)?.remove();
      const hdr = document.createElement('div');
      hdr.className = 'round-header';
      hdr.textContent = round === 1 ? `round 1 — initial response` : `round ${round} — reactions`;
      cm.appendChild(hdr);
      cm.scrollTop = cm.scrollHeight;
    });
  };

  setDebateStatus('Round 1…');
  addRoundHeader(1);

  // Round 1 — everyone answers the topic independently
  const round1Prompt = topic;
  await Promise.all(targets.map(async key => {
    S.histories[key].push({ role: 'user', content: round1Prompt });
    addDebateBubble(key, 'user', round1Prompt, 1);
    const reply = await callAI(key, S.histories[key]);
    if (reply) {
      S.histories[key].push({ role: 'assistant', content: reply });
      addDebateBubble(key, 'assistant', reply, 1);
      D.lastReplies[key] = reply;
    }
  }));

  // Rounds 2+ — everyone reacts to everyone else's previous answers
  for (let round = 2; round <= D.rounds; round++) {
    setDebateStatus(`Round ${round}…`);
    addRoundHeader(round);
    const prevReplies = { ...D.lastReplies };

    await Promise.all(targets.map(async key => {
      const others = Object.entries(prevReplies)
        .filter(([k]) => k !== key)
        .map(([k, reply]) => `${labelFor(k)}: "${reply}"`)
        .join('\n\n');

      const reactPrompt = `The topic is: "${D.topic}"\n\nHere is what the other AIs said:\n\n${others}\n\nPlease respond to these perspectives. You can agree, disagree, build on them, or offer a different angle. Be concise.`;

      S.histories[key].push({ role: 'user', content: reactPrompt });
      const reply = await callAI(key, S.histories[key]);
      if (reply) {
        S.histories[key].push({ role: 'assistant', content: reply });
        addDebateBubble(key, 'assistant', reply, round);
        D.lastReplies[key] = reply;
      }
    }));
  }

  D.running = false;
  setDebateStatus('done');
  document.getElementById('debateStartBtn').disabled = false;
  document.getElementById('summaryBar').style.display = 'flex';
  showToast('Debate complete — summarize?');
}

async function summarizeDebate() {
  const targets = sendableKeys();
  if (!targets.length) return;
  document.getElementById('summaryBtn').disabled = true;
  setDebateStatus('summarizing…');

  const allResponses = targets.map(key => {
    const msgs = S.histories[key].filter(m => m.role === 'assistant').map(m => m.content);
    return `${labelFor(key)}:\n${msgs.join('\n')}`;
  }).join('\n\n---\n\n');

  const summaryPrompt = `Here is a multi-AI debate on the topic: "${D.topic}"\n\n${allResponses}\n\nPlease write a concise synthesis: what did they agree on, where did they differ, and what's the most useful takeaway?`;

  // use first available AI for summary
  const summaryKey = targets[0];
  try {
    S.histories[summaryKey].push({ role: 'user', content: summaryPrompt });
    const summary = await callAI(summaryKey, S.histories[summaryKey]);
    if (summary) {
      S.histories[summaryKey].push({ role: 'assistant', content: summary });
      addSummaryBubble(summaryKey, summary);
    }
  } catch (_) { showToast('Summary failed'); }

  document.getElementById('summaryBtn').disabled = false;
  setDebateStatus('');
}

function addDebateBubble(key, role, text, round) {
  const cm = document.getElementById('cm-' + key);
  if (!cm) return;
  const wrap = document.createElement('div');
  wrap.className = `msg ${role} debate-round r${round}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble'; bubble.textContent = text;
  wrap.appendChild(bubble);
  if (role === 'assistant') {
    const acts = document.createElement('div');
    acts.className = 'msg-actions';
    const c = document.createElement('button');
    c.className = 'ma-btn'; c.textContent = 'copy';
    c.addEventListener('click', () => navigator.clipboard.writeText(text).then(() => showToast('Copied!')));
    const p = document.createElement('button');
    p.className = 'ma-btn'; p.textContent = '→ pad';
    p.addEventListener('click', () => {
      const pad = document.getElementById('padText');
      pad.value += (pad.value ? '\n\n' : '') + `[${labelFor(key)} · R${round}]\n${text}`;
      showToast('→ scratchpad');
    });
    acts.appendChild(c); acts.appendChild(p);
    wrap.appendChild(acts);
  }
  cm.appendChild(wrap); cm.scrollTop = cm.scrollHeight;
}

function addSummaryBubble(key, text) {
  const cm = document.getElementById('cm-' + key);
  if (!cm) return;
  const hdr = document.createElement('div');
  hdr.className = 'round-header'; hdr.textContent = '✦ debate summary';
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant summary-msg';
  const bubble = document.createElement('div');
  bubble.className = 'bubble'; bubble.textContent = text;
  wrap.appendChild(bubble);
  const acts = document.createElement('div');
  acts.className = 'msg-actions';
  const c = document.createElement('button');
  c.className = 'ma-btn'; c.textContent = 'copy';
  c.addEventListener('click', () => navigator.clipboard.writeText(text).then(() => showToast('Copied!')));
  const p = document.createElement('button');
  p.className = 'ma-btn'; p.textContent = '→ pad';
  p.addEventListener('click', () => {
    const pad = document.getElementById('padText');
    pad.value += (pad.value ? '\n\n' : '') + `[Debate Summary: ${D.topic}]\n${text}`;
    showToast('→ scratchpad');
  });
  acts.appendChild(c); acts.appendChild(p);
  wrap.appendChild(acts);
  cm.appendChild(hdr); cm.appendChild(wrap);
  cm.scrollTop = cm.scrollHeight;
}

function setDebateStatus(msg) {
  const el = document.getElementById('debateStatus');
  if (el) el.textContent = msg;
}

// helper: call the right AI without mutating history
async function callAI(key, msgs) {
  try {
    const sys = getSystemPrompt(key);
    if (S.ollamaKeys.includes(key)) return await ollamaCall(msgs, sys, S.ollamaModels[key]);
    const apiKey = S.apiKeys[key];
    if (!apiKey) return null;
    return await AIS[key].call(apiKey, msgs, sys);
  } catch (err) {
    addDebateBubble(key, 'assistant', '⚠ ' + err.message, 0);
    return null;
  }
}

async function callAIVision(key, msgs, systemPrompt, lastText, images) {
  const apiKey = S.apiKeys[key];
  if (!apiKey) return null;

  if (key === 'chatgpt' || key === 'grok') {
    const parts = images.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } }));
    if (lastText) parts.push({ type: 'text', text: lastText });
    const msgsForCall = [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...msgs.slice(0, -1),
      { role: 'user', content: parts }
    ];
    const endpoint = key === 'chatgpt' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions';
    const model = key === 'chatgpt' ? 'gpt-4o' : 'grok-2-vision-1212';
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: msgsForCall }) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
    return (await res.json()).choices?.[0]?.message?.content || '';

  } else if (key === 'claude') {
    const parts = images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } }));
    if (lastText) parts.push({ type: 'text', text: lastText });
    const msgsForCall = [...msgs.slice(0, -1), { role: 'user', content: parts }];
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt || undefined, messages: msgsForCall }) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
    return (await res.json()).content?.[0]?.text || '';

  } else if (key === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const parts = images.map(img => ({ inline_data: { mime_type: img.mimeType, data: img.base64 } }));
    if (lastText) parts.push({ text: lastText });
    const prevMsgs = msgs.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const body = { contents: [...prevMsgs, { role: 'user', parts }] };
    if (systemPrompt) body.system_instruction = { parts: [{ text: systemPrompt }] };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
    return (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function bindMain() {
  document.querySelectorAll('.vb').forEach(b => b.addEventListener('click', () => setView(parseInt(b.dataset.v))));

  const bBtn = document.getElementById('broadcastBtn');
  const bInput = document.getElementById('broadcastInput');
  const fire = () => { const t = bInput.value.trim(); if (!t) return; bInput.value = ''; broadcastAndRelay(t); };
  bBtn.addEventListener('click', fire);
  bInput.addEventListener('keydown', e => { if (e.key === 'Enter') fire(); });

  const relayBtn = document.getElementById('relayBtn');
  relayBtn.addEventListener('click', () => {
    S.relayOn = !S.relayOn;
    relayBtn.textContent = S.relayOn ? 'relay on' : 'relay off';
    relayBtn.classList.toggle('on', S.relayOn);
    showToast(S.relayOn ? 'Auto-relay on' : 'Auto-relay off');
  });

  bindDebate();
  bindDrawers(); bindTemplates();
  document.getElementById('settingsBtn').addEventListener('click', goToSettings);
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2000);
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initResize();
  // Init Memstore key cache, then load app settings
  Memstore.init(() => {
    chrome.storage.local.get(['aihub_view','aihub_modes','aihub_memLabel','aihub_ollamaOn','aihub_ollamaSlots'], d => {
      if (d.aihub_view) S.view = d.aihub_view;
      buildSetup({ modes: d.aihub_modes, memoryLabel: d.aihub_memLabel, ollamaOn: d.aihub_ollamaOn, ollamaSlots: d.aihub_ollamaSlots });
    });
  });
});
