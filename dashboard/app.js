'use strict';

// ── Demo Mode ─────────────────────────────────────────────────────────────────

let DEMO_MODE = false;

// Cycling counters so each panel rotates through its responses
const DEMO_COUNTERS = { chatgpt: 0, claude: 0, gemini: 0, grok: 0 };

const DEMO_RESPONSES = {
  chatgpt: [
    "AI Hub is a great example of multi-model orchestration. By routing the same prompt to multiple models simultaneously, you get diverse perspectives that a single model can't provide. The broadcast feature alone saves significant context-switching time.",
    "The relay feature is particularly powerful for iterative thinking. When I see what Claude or Gemini said, I can build on their strongest points rather than repeating the same ground. It's closer to how a real team thinks.",
    "From an architecture standpoint, keeping API calls client-side is the right call for a privacy-first tool. No server means no attack surface for key theft. The tradeoff is no server-side memory, which is exactly what Memstore solves.",
  ],
  claude: [
    "What I find interesting about AI Hub's approach is the structured debate mode. Most multi-AI tools just show parallel responses, but giving each model the others' answers and asking for a reaction produces genuinely better synthesis. The disagreements are often more useful than the agreements.",
    "The memory injection system is the hidden feature here. Most users underestimate how much a well-written memory context improves every response. It's essentially a persistent system prompt that evolves with your work.",
    "I'd argue the scratchpad is underrated. Having a neutral space to collect the best fragments from four different models — without committing to any one thread — mirrors how good research actually works.",
  ],
  gemini: [
    "Multi-model comparison is increasingly important as different models develop distinct strengths. GPT-4o tends to be more direct, Claude more nuanced, and I tend to pull in broader context. AI Hub makes those differences visible and useful rather than forcing you to pick one.",
    "The Ollama integration is a smart addition. For sensitive or proprietary work, being able to route queries to a local model while still comparing with cloud models gives users real control over data exposure.",
    "The debate round structure — independent answers first, then reactions — is actually how structured thinking works. You want unanchored initial responses before introducing social influence. AI Hub does this correctly.",
  ],
  grok: [
    "Honestly? The tab switching chaos of managing four browser tabs is one of those daily friction points nobody talks about. AI Hub removes it cleanly. Small thing, huge quality of life improvement.",
    "The relay mode is where it gets interesting. After a broadcast, automatically sharing all responses as context for the next message turns four parallel conversations into one collaborative thread. That's actually novel.",
    "The free local model support via Ollama is the right move for privacy-conscious users. Running Mistral or Llama3 locally for sensitive queries while using cloud models for general work is a genuinely useful workflow.",
  ]
};

// ── AI Definitions ────────────────────────────────────────────────────────────

const AIS = {
  chatgpt: {
    name: 'ChatGPT', color: '#10a37f', url: 'https://chatgpt.com',
    placeholder: 'sk-...', type: 'cloud',
    async call(key, msgs, memory) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: memory ? [{ role: 'system', content: memory }, ...msgs] : msgs })
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
      return (await res.json()).choices?.[0]?.message?.content || '';
    }
  },
  claude: {
    name: 'Claude', color: '#cc785c', url: 'https://claude.ai',
    placeholder: 'sk-ant-...', type: 'cloud',
    async call(key, msgs, memory) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: memory || undefined, messages: msgs })
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
      return (await res.json()).content?.[0]?.text || '';
    }
  },
  gemini: {
    name: 'Gemini', color: '#4285f4', url: 'https://gemini.google.com',
    placeholder: 'AIza...', type: 'cloud',
    async call(key, msgs, memory) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
      const body = { contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) };
      if (memory) body.system_instruction = { parts: [{ text: memory }] };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
      return (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
  },
  grok: {
    name: 'Grok', color: '#1d9bf0', url: 'https://grok.com',
    placeholder: 'xai-...', type: 'cloud',
    async call(key, msgs, memory) {
      const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'grok-3-latest', messages: memory ? [{ role: 'system', content: memory }, ...msgs] : msgs })
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
      return (await res.json()).choices?.[0]?.message?.content || '';
    }
  },
  ollama: {
    name: 'Ollama', color: '#e8704a', url: null,
    placeholder: null, type: 'local',
    async call(key, msgs, memory, model) {
      const systemMsg = memory ? [{ role: 'system', content: memory }] : [];
      const res = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || 'llama3', messages: [...systemMsg, ...msgs], stream: false })
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status} — is Ollama running?`);
      return (await res.json()).message?.content || '';
    }
  }
};

const CLOUD_KEYS = ['chatgpt', 'claude', 'gemini', 'grok'];
const ALL_KEYS   = [...CLOUD_KEYS, 'ollama'];

// ── Storage helpers (localStorage instead of chrome.storage) ──────────────────

const store = {
  get(keys) {
    const result = {};
    keys.forEach(k => {
      try { const v = localStorage.getItem('aihub5d_' + k); result[k] = v ? JSON.parse(v) : undefined; } catch (_) {}
    });
    return result;
  },
  set(obj) {
    Object.entries(obj).forEach(([k, v]) => {
      try { localStorage.setItem('aihub5d_' + k, JSON.stringify(v)); } catch (_) {}
    });
  }
};

// ── State ─────────────────────────────────────────────────────────────────────

const S = {
  modes:       { chatgpt: 'api', claude: 'api', gemini: 'api', grok: 'api', ollama: 'off' },
  apiKeys:     {},
  ollamaModel: 'llama3',
  ollamaOn:    false,
  histories:   { chatgpt: [], claude: [], gemini: [], grok: [], ollama: [] },
  loading:     { chatgpt: false, claude: false, gemini: false, grok: false, ollama: false },
  unread:      { chatgpt: 0, claude: 0, gemini: 0, grok: 0, ollama: 0 },
  memory:      '',
  memoryLabel: '',
  templates:   {},
  view:        4,
  activeTab:   null,
  relayOn:     false,
  personas:    {},
  zoomed:      null
};

const sendableKeys = () => ALL_KEYS.filter(k => {
  if (S.modes[k] === 'off' || S.modes[k] === 'native') return false;
  if (k === 'ollama') return S.ollamaOn;
  return !!S.apiKeys[k];
});
const visibleKeys = () => ALL_KEYS.filter(k => S.modes[k] !== 'off');

// Returns combined memory + per-panel persona for a given key
function getSystemPrompt(key) {
  const parts = [S.memory, S.personas[key]].filter(Boolean);
  return parts.join('\n\n---\n\n') || '';
}

// Brainstorm state (mirrors debate's D object)
const BS = { running: false, rounds: 1, topic: '', lastReplies: {} };

// Pending images per panel: key → [{base64, mimeType}]
const pendingImages = {};

// Pinned messages per panel: key → [{text, label}]
const pinnedMessages = {};

// Prompt library state + defaults pre-loaded on first run
let S_prompts = [];
const DEFAULT_PROMPTS = [
  { name: 'Compare approaches', text: 'What are the tradeoffs between [X] and [Y]? Give a concrete recommendation.' },
  { name: "Devil's advocate",   text: 'What are the strongest arguments AGAINST this idea: [idea]' },
  { name: 'Simplify',           text: 'Explain [topic] as simply as possible. Use an analogy.' },
  { name: 'Action plan',        text: 'Turn this into a concrete 5-step action plan: [goal]' },
  { name: 'Find the flaw',      text: 'What could go wrong with this plan? What am I missing: [plan]' },
];

const PERSONA_PRESETS = [
  { label: 'Concise',    text: 'Be extremely concise. Answer in 1-3 sentences maximum. No preamble.' },
  { label: 'Socratic',   text: 'Respond with probing questions that challenge my assumptions rather than direct answers.' },
  { label: 'Expert',     text: 'You are a domain expert. Use precise technical language and cite tradeoffs.' },
  { label: 'ELI5',       text: 'Explain everything as if I am five years old. Use simple analogies and short sentences.' },
  { label: "Devil's Advocate", text: 'Always argue the opposite of whatever I say. Be constructively contrarian.' },
];

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
      ${key === 'gemini' ? `
      <div class="free-badge-row" id="fbr-gemini" style="opacity:${mode!=='api'?'0.15':'1'}">
        <span class="free-badge">✓ Free tier available</span>
        <a class="free-badge-link" href="https://aistudio.google.com/app/apikey" target="_blank">Get a free Gemini key in 30 seconds →</a>
      </div>` : ''}
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
    // Also toggle the Gemini free badge row opacity
    const fbr = document.getElementById('fbr-gemini');
    if (fbr && key === 'gemini') fbr.style.opacity = mode === 'api' ? '1' : '0.15';
  });

  // Ollama
  const ollamaOn = prefill?.ollamaOn || false;
  S.ollamaOn = ollamaOn;
  S.modes.ollama = ollamaOn ? 'api' : 'off';
  document.querySelectorAll('[data-olmode]').forEach(btn => {
    btn.classList.toggle('active', (btn.dataset.olmode === 'on') === ollamaOn);
    btn.addEventListener('click', () => {
      const on = btn.dataset.olmode === 'on';
      S.ollamaOn = on; S.modes.ollama = on ? 'api' : 'off';
      document.querySelectorAll('[data-olmode]').forEach(b => b.classList.toggle('active', b.dataset.olmode === btn.dataset.olmode));
      document.getElementById('ollamaKeyRow').style.opacity = on ? '1' : '0.4';
    });
  });
  document.getElementById('ollamaKeyRow').style.opacity = ollamaOn ? '1' : '0.4';
  if (prefill?.ollamaModel) { document.getElementById('ollamaModel').value = prefill.ollamaModel; S.ollamaModel = prefill.ollamaModel; }

  document.getElementById('detectModels').addEventListener('click', async () => {
    const btn = document.getElementById('detectModels');
    btn.textContent = 'detecting...';
    try {
      const res = await fetch('http://localhost:11434/api/tags');
      if (!res.ok) throw new Error();
      const data = await res.json();
      const models = data.models?.map(m => m.name) || [];
      const chips = document.getElementById('modelChips');
      chips.style.display = 'flex'; chips.innerHTML = '';
      if (!models.length) { chips.innerHTML = '<span style="font-size:12px;color:#444;">No models found — run <code>ollama pull llama3</code></span>'; }
      models.forEach(m => {
        const chip = document.createElement('button');
        chip.className = 'model-chip'; chip.textContent = m;
        chip.addEventListener('click', () => {
          document.getElementById('ollamaModel').value = m; S.ollamaModel = m;
          chips.querySelectorAll('.model-chip').forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
        });
        chips.appendChild(chip);
      });
      btn.textContent = `${models.length} model${models.length !== 1 ? 's' : ''} found`;
    } catch (_) {
      btn.textContent = 'Ollama not running';
      setTimeout(() => { btn.textContent = 'detect models'; }, 2500);
    }
  });

  if (prefill?.memoryLabel) document.getElementById('memLabel').value = prefill.memoryLabel;
  document.getElementById('goBtn').onclick = launch;
  document.getElementById('demoBtn').onclick = launchDemo;
}

function launch() {
  CLOUD_KEYS.forEach(key => {
    S.apiKeys[key] = S.modes[key] === 'api' ? (document.getElementById('ki-' + key)?.value?.trim() || '') : '';
    S.histories[key] = []; S.loading[key] = false; S.unread[key] = 0;
  });
  S.ollamaModel = document.getElementById('ollamaModel').value.trim() || 'llama3';
  S.histories.ollama = []; S.loading.ollama = false; S.unread.ollama = 0;
  S.memoryLabel = document.getElementById('memLabel').value.trim();

  store.set({ modes: { ...S.modes }, memLabel: S.memoryLabel, ollamaOn: S.ollamaOn, ollamaModel: S.ollamaModel });
  loadMemory(); loadTemplates();

  // Memstore auto-recall — silently appends top-3 results before first chat
  Memstore.recallOnLaunch().then(recalled => {
    if (recalled) S.memory = (S.memory ? S.memory + '\n\n' : '') + recalled;
  }).catch(() => {});

  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = 'flex';
  S.activeTab = sendableKeys()[0] || visibleKeys()[0] || null;
  buildPanels(); bindMain(); setView(S.view);
}

function goToSettings() {
  document.getElementById('mainScreen').style.display = 'none';
  document.getElementById('memDrawer').style.display = 'none';
  document.getElementById('padDrawer').style.display = 'none';
  document.getElementById('setupScreen').style.display = 'flex';
  const d = store.get(['modes', 'memLabel', 'ollamaOn', 'ollamaModel']);
  buildSetup({ modes: d.modes, memoryLabel: d.memLabel, ollamaOn: d.ollamaOn, ollamaModel: d.ollamaModel });
}

// ── Panels ────────────────────────────────────────────────────────────────────

function buildPanels() {
  const container = document.getElementById('panels');
  container.innerHTML = '';
  ALL_KEYS.forEach(key => {
    const mode = S.modes[key];
    if (mode === 'off') return;
    const ai = AIS[key];
    const isOllama = key === 'ollama';
    const hasKey = isOllama ? S.ollamaOn : (mode === 'api' && !!S.apiKeys[key]);
    const panel = document.createElement('div');
    panel.className = 'panel'; panel.id = 'p-' + key;
    panel.innerHTML = `
      <div class="ph" id="ph-${key}">
        <div class="ph-dot" style="background:${ai.color}"></div>
        <span class="ph-name" style="color:${ai.color}">${ai.name}${isOllama ? ` <span style="font-size:11px;color:#666;">${S.ollamaModel}</span>` : ''}</span>
        <span class="ph-badge ${isOllama ? 'ollama' : mode}">${isOllama ? 'local · free' : mode}</span>
        <div class="ph-actions">
          ${mode === 'native'
            ? `<button class="pa-btn" onclick="openNative('${key}')">open ↗</button>`
            : `<button class="pa-btn persona-btn" id="pb-${key}" onclick="togglePersona('${key}')" title="Set persona / system prompt">🎭</button>
               <button class="pa-btn zoom-btn" id="zb-${key}" onclick="toggleZoom('${key}')" title="Zoom panel">⤢</button>
               <button class="pa-btn" onclick="clearChat('${key}')">clear</button>
               <button class="pa-btn" onclick="copyLast('${key}')">copy last</button>`
          }
        </div>
      </div>
      ${mode !== 'native' ? `
      <div class="persona-popover" id="pp-${key}" style="display:none;">
        <div class="persona-presets" id="pps-${key}"></div>
        <textarea class="persona-textarea" id="pt-${key}" placeholder="System prompt for this panel only... (combined with global memory)"></textarea>
        <div class="persona-footer">
          <button class="pf-btn" id="ppsave-${key}">apply</button>
          <button class="pf-btn" id="ppclear-${key}">clear persona</button>
        </div>
      </div>` : ''}
      ${mode === 'native' ? nativeBody(key, ai) : apiBody(key, ai, hasKey, isOllama)}
    `;
    container.appendChild(panel);
    if (mode !== 'native') {
      bindChat(key);
      bindPersonaPopover(key);
      // Double-click header to zoom
      const ph = panel.querySelector('#ph-' + key);
      if (ph) ph.addEventListener('dblclick', () => toggleZoom(key));
    }
  });
}

function nativeBody(key, ai) {
  return `<div class="native-body">
    <div class="native-label">Your real <strong style="color:${ai.color}">${ai.name}</strong> account.<br>Full memory &amp; chat history.</div>
    <button class="native-open" onclick="openNative('${key}')">↗ open ${ai.name}</button>
    <div class="native-hint">Nothing goes through AI Hub.</div>
  </div>`;
}

function apiBody(key, ai, hasKey, isOllama) {
  if (isOllama && !hasKey) {
    return `<div class="ollama-offline">
      <div class="ollama-offline-title">Ollama not detected</div>
      <div class="ollama-offline-hint">
        Install from <strong style="color:#7a5a3a;">ollama.com</strong> then run:<br>
        <code>ollama pull ${S.ollamaModel}</code><br>
        <code>ollama serve</code>
      </div>
    </div>`;
  }
  return `
    <div class="chat-messages" id="cm-${key}">
      <div class="empty-state" id="es-${key}">
        <span class="en">${ai.name}</span>
        <span class="eh">${hasKey ? (isOllama ? 'local · free · ready' : 'ready') : '⚠ no api key — go to settings'}</span>
        <span class="ek">${hasKey ? (S.memory ? 'memory loaded' : 'no memory set') : ''}</span>
      </div>
    </div>
    <div class="image-preview-strip" id="ips-${key}" style="display:none;"></div>
    <div class="chat-input-row">
      <label class="img-upload-btn" title="Attach image">
        🖼
        <input type="file" accept="image/*" class="img-file-input" id="ifi-${key}" style="display:none;" multiple/>
      </label>
      <textarea class="chat-textarea" id="ct-${key}" placeholder="Message ${ai.name}... (Enter to send, Shift+Enter for newline)" rows="1"></textarea>
      <button class="send-btn" id="sb-${key}">send</button>
    </div>`;
}

function bindChat(key) {
  const ta = document.getElementById('ct-' + key);
  const sb = document.getElementById('sb-' + key);
  if (!ta || !sb) return;
  sb.addEventListener('click', () => send(key));
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(key); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 100) + 'px'; });

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
  store.set({ view: v });
  document.querySelectorAll('.vb').forEach(b => b.classList.toggle('active', parseInt(b.dataset.v) === v));
  const vk = visibleKeys();

  if (v === 4) {
    document.getElementById('tabBar').style.display = 'none';
    document.getElementById('panels').className = 'panels v4';
    ALL_KEYS.forEach(key => {
      const p = document.getElementById('p-' + key);
      if (p) p.classList.toggle('hidden', S.modes[key] === 'off');
    });
    return;
  }

  document.getElementById('panels').className = 'panels v' + v;
  const shown = buildShownList(v);
  ALL_KEYS.forEach(key => {
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
    const ai = AIS[key];
    const tab = document.createElement('button');
    tab.className = 'ai-tab' + (shown.includes(key) ? ' active' : '');
    const u = S.unread[key];
    tab.innerHTML = `<div class="tab-dot" style="background:${ai.color}"></div><span>${ai.name}</span>${u > 0 ? `<span class="tab-unread">${u}</span>` : ''}`;
    tab.addEventListener('click', () => {
      if (S.modes[key] === 'native') { openNative(key); return; }
      S.activeTab = key; S.unread[key] = 0; setView(S.view);
    });
    bar.appendChild(tab);
  });
}

// ── Send ──────────────────────────────────────────────────────────────────────

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
          // Re-index remaining thumbs
          Array.from(strip.children).forEach((t, i) => { t.dataset.idx = i; t.querySelector('.img-thumb-rm').dataset.idx = i; });
        });
        strip.appendChild(thumb);
      }
    };
    reader.readAsDataURL(file);
  });

  // Reset file input
  const fi = document.getElementById('ifi-' + key);
  if (fi) fi.value = '';
}

async function send(key, textOverride, isRelay) {
  if (S.loading[key] || S.modes[key] === 'off' || S.modes[key] === 'native') return;
  if (key === 'ollama' && !S.ollamaOn) return;
  const ta = document.getElementById('ct-' + key);
  const text = textOverride !== undefined ? textOverride : ta?.value?.trim();
  if (!text) return;
  if (ta && textOverride === undefined) { ta.value = ''; ta.style.height = 'auto'; }

  // Demo mode — skip real API calls entirely
  if (DEMO_MODE) { sendDemoMessage(key, text, isRelay); return; }

  const apiKey = key === 'ollama' ? null : S.apiKeys[key];
  if (key !== 'ollama' && !apiKey) { showToast(`No API key for ${AIS[key].name}`); return; }

  // Grab pending images and clear the strip
  const imgs = (pendingImages[key] || []).slice();
  pendingImages[key] = [];
  const strip = document.getElementById('ips-' + key);
  if (strip) strip.style.display = 'none';
  if (strip) strip.innerHTML = '';

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
    if (imgs.length && key !== 'ollama') {
      reply = await callAIVision(key, S.histories[key], sys, text, imgs);
    } else {
      reply = key === 'ollama'
        ? await AIS.ollama.call(null, S.histories[key], sys, S.ollamaModel)
        : await AIS[key].call(apiKey, S.histories[key], sys);
    }
    removeEl(tid);
    S.histories[key].push({ role: 'assistant', content: reply });
    addBubble(key, 'assistant', reply);
    const shown = S.view === 4 ? visibleKeys() : buildShownList(S.view);
    if (!shown.includes(key)) { S.unread[key]++; buildTabBar(S.view, visibleKeys()); }
    if (S.histories[key].length % 20 === 0) autoSummarizeOne(key);
    // Memstore auto-save — fire-and-forget
    const aiName = key.startsWith('ollama') ? `Ollama` : (AIS[key]?.name || key);
    Memstore.rememberResponse(aiName, text, reply);
  } catch (err) {
    removeEl(tid);
    addBubble(key, 'assistant', '⚠ ' + err.message);
  }
  S.loading[key] = false; setSend(key, false);
}

// ── Sharing ───────────────────────────────────────────────────────────────────

function shareToAll(fromKey, text) {
  const targets = sendableKeys().filter(k => k !== fromKey);
  if (!targets.length) { showToast('No other panels to share to'); return; }
  targets.forEach(key => {
    document.getElementById('es-' + key)?.remove();
    addRelayedBubble(key, fromKey, text);
    S.histories[key].push({ role: 'user', content: `[Context from ${AIS[fromKey].name}]: ${text}` });
  });
  showToast(`Shared to ${targets.length} panel${targets.length > 1 ? 's' : ''}`);
}

function addRelayedBubble(toKey, fromKey, text) {
  const cm = document.getElementById('cm-' + toKey);
  if (!cm) return;
  const wrap = document.createElement('div');
  wrap.className = 'msg relayed';
  const label = document.createElement('div');
  label.className = 'relay-label';
  label.textContent = `↙ from ${AIS[fromKey].name}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble'; bubble.textContent = text;
  wrap.appendChild(label); wrap.appendChild(bubble);
  cm.appendChild(wrap); cm.scrollTop = cm.scrollHeight;
}

async function broadcastAndRelay(text) {
  const targets = sendableKeys();
  if (!targets.length) { showToast('No active panels'); return; }

  // Demo mode — fire demo responses for each panel and stop
  if (DEMO_MODE) { targets.forEach(k => sendDemoMessage(k, text)); return; }

  // Hide any stale conflict banner from a previous broadcast
  document.getElementById('conflictBanner').style.display = 'none';

  await Promise.allSettled(targets.map(k => send(k, text)));

  // Fire-and-forget conflict detection (≥2 real API panels, never blocks UI)
  const apiTargets = targets.filter(k => S.modes[k] === 'api' && (k === 'ollama' ? S.ollamaOn : !!S.apiKeys[k]));
  if (apiTargets.length >= 2) checkConflict(text, apiTargets);

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
      S.histories[toKey].push({ role: 'user', content: `[${AIS[fromKey].name} responded]: ${reply}` });
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

  // For user messages with images, show thumbnails
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
    if (text) {
      const textNode = document.createElement('div');
      textNode.textContent = text;
      bubble.appendChild(textNode);
    }
  } else if (role === 'assistant' && typeof marked !== 'undefined') {
    bubble.innerHTML = marked.parse(text);
  } else {
    bubble.textContent = text;
  }

  wrap.appendChild(bubble);
  if (role === 'assistant') {
    const acts = document.createElement('div');
    acts.className = 'msg-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'ma-btn'; copyBtn.textContent = 'copy';
    copyBtn.onclick = () => navigator.clipboard.writeText(text).then(() => showToast('Copied!'));
    const padBtn = document.createElement('button');
    padBtn.className = 'ma-btn'; padBtn.textContent = '→ pad';
    padBtn.onclick = () => {
      const pad = document.getElementById('padText');
      pad.value += (pad.value ? '\n\n' : '') + `[${AIS[key]?.name || key}]\n${text}`;
      showToast('→ scratchpad');
    };
    const shareBtn = document.createElement('button');
    shareBtn.className = 'ma-btn share-all'; shareBtn.textContent = '→ all';
    shareBtn.title = 'Share to all other panels as context';
    shareBtn.onclick = () => shareToAll(key, text);
    const pinBtn = document.createElement('button');
    pinBtn.className = 'ma-btn pin-btn'; pinBtn.textContent = '📌 pin';
    pinBtn.onclick = () => pinMessage(key, text, pinBtn);
    acts.appendChild(copyBtn); acts.appendChild(padBtn); acts.appendChild(shareBtn); acts.appendChild(pinBtn);
    wrap.appendChild(acts);
  }
  cm.appendChild(wrap); cm.scrollTop = cm.scrollHeight;
}

function pinMessage(key, text, btn) {
  if (!pinnedMessages[key]) pinnedMessages[key] = [];
  // Prevent duplicate pins
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

  if (!pins.length) {
    if (pinSection) pinSection.remove();
    return;
  }

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
    item.innerHTML = `<span class="pinned-text">${pin.text.slice(0, 120)}${pin.text.length > 120 ? '…' : ''}</span><button class="pinned-rm">✕</button>`;
    item.querySelector('.pinned-rm').addEventListener('click', () => {
      pinnedMessages[key].splice(i, 1);
      renderPinnedSection(key);
    });
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
  const id = 'ty-' + key + Date.now();
  const el = document.createElement('div');
  el.id = id; el.className = 'typing-wrap';
  el.innerHTML = '<div class="typing"><div class="td"></div><div class="td"></div><div class="td"></div></div>';
  cm.appendChild(el); cm.scrollTop = cm.scrollHeight;
  return id;
}
function removeEl(id) { if (id) document.getElementById(id)?.remove(); }
function setSend(key, d) { const sb = document.getElementById('sb-' + key); if (sb) sb.disabled = d; }

// ── Actions ───────────────────────────────────────────────────────────────────

function openNative(key) { window.open(AIS[key].url, '_blank'); }

function clearChat(key) {
  S.histories[key] = [];
  pinnedMessages[key] = [];
  pendingImages[key] = [];
  const cm = document.getElementById('cm-' + key);
  if (!cm) return;
  cm.innerHTML = `<div class="empty-state" id="es-${key}"><span class="en">${AIS[key].name}</span><span class="eh">cleared</span></div>`;
  const strip = document.getElementById('ips-' + key);
  if (strip) { strip.style.display = 'none'; strip.innerHTML = ''; }
  showToast('Chat cleared');
}

function copyLast(key) {
  const last = [...S.histories[key]].reverse().find(m => m.role === 'assistant');
  if (last) navigator.clipboard.writeText(last.content).then(() => showToast('Copied!'));
  else showToast('No response yet');
}

// ── Memory ────────────────────────────────────────────────────────────────────

function loadMemory() {
  if (!S.memoryLabel) return;
  try { S.memory = localStorage.getItem('aihub5d_mem_' + S.memoryLabel) || ''; } catch (_) {}
}

function saveMemory() {
  S.memory = document.getElementById('memText').value;
  if (!S.memoryLabel) { showToast('Add a memory label in settings first'); return; }
  try {
    localStorage.setItem('aihub5d_mem_' + S.memoryLabel, S.memory);
    setMemStatus('Saved ✓');
  } catch (_) { showToast('Save failed'); }
}

function setMemStatus(msg) {
  const el = document.getElementById('memAutosave');
  if (el) { el.textContent = msg; setTimeout(() => { el.textContent = ''; }, 2500); }
}

async function autoSummarizeAll() {
  const active = sendableKeys().filter(k => S.histories[k].length > 0);
  if (!active.length) { showToast('No conversations to summarize'); return; }
  setMemStatus('Summarizing...');
  const summaries = [];
  for (const key of active) { const s = await summarizeHistory(key); if (s) summaries.push(`[${AIS[key].name}]: ${s}`); }
  if (summaries.length) {
    S.memory = (S.memory ? S.memory + '\n\n' : '') + '--- Auto-summary ---\n' + summaries.join('\n');
    document.getElementById('memText').value = S.memory;
    if (S.memoryLabel) { try { localStorage.setItem('aihub5d_mem_' + S.memoryLabel, S.memory); } catch (_) {} }
    setMemStatus('Summaries appended ✓');
  }
}

async function autoSummarizeOne(key) {
  const s = await summarizeHistory(key); if (!s) return;
  S.memory = (S.memory ? S.memory + '\n' : '') + `[${AIS[key].name} summary]: ${s}`;
  const mt = document.getElementById('memText'); if (mt) mt.value = S.memory;
  if (S.memoryLabel) { try { localStorage.setItem('aihub5d_mem_' + S.memoryLabel, S.memory); } catch (_) {} }
  setMemStatus(`Auto-saved ${AIS[key].name} summary`);
}

async function summarizeHistory(key) {
  const hist = S.histories[key]; if (!hist.length) return null;
  const sk = sendableKeys()[0]; if (!sk) return null;
  const prompt = `Summarize the key points of this conversation in 2-3 sentences:\n\n${hist.map(m => `${m.role}: ${m.content}`).join('\n')}`;
  try {
    if (sk === 'ollama') return await AIS.ollama.call(null, [{ role: 'user', content: prompt }], null, S.ollamaModel);
    return await AIS[sk].call(S.apiKeys[sk], [{ role: 'user', content: prompt }], null);
  } catch (_) { return null; }
}

// ── Templates ─────────────────────────────────────────────────────────────────

function loadTemplates() {
  try { S.templates = JSON.parse(localStorage.getItem('aihub5d_templates') || '{}'); } catch (_) { S.templates = {}; }
}
function saveTemplates() { try { localStorage.setItem('aihub5d_templates', JSON.stringify(S.templates)); } catch (_) {} }

function renderTemplates() {
  const list = document.getElementById('tplList');
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

function bindPersonaPopover(key) {
  const saveBtn  = document.getElementById('ppsave-'  + key);
  const clearBtn = document.getElementById('ppclear-' + key);
  const ppsEl    = document.getElementById('pps-'     + key);
  if (!saveBtn || !ppsEl) return;

  // Render presets
  PERSONA_PRESETS.forEach(preset => {
    const btn = document.createElement('button');
    btn.className = 'preset-chip';
    btn.textContent = preset.label;
    btn.addEventListener('click', () => {
      document.getElementById('pt-' + key).value = preset.text;
    });
    ppsEl.appendChild(btn);
  });

  saveBtn.addEventListener('click', () => {
    const text = document.getElementById('pt-' + key)?.value?.trim();
    S.personas[key] = text || '';
    updatePersonaIndicator(key);
    document.getElementById('pp-' + key).style.display = 'none';
    showToast(text ? 'Persona applied ✓' : 'Persona cleared');
  });

  clearBtn.addEventListener('click', () => {
    S.personas[key] = '';
    const pt = document.getElementById('pt-' + key);
    if (pt) pt.value = '';
    updatePersonaIndicator(key);
    showToast('Persona cleared');
  });
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
  const zb = k => document.getElementById('zb-' + k);

  if (!S.zoomed || !allVisible.includes(S.zoomed)) {
    S.zoomed = null;
    allVisible.forEach(k => {
      const p = document.getElementById('p-' + k);
      if (p) { p.classList.remove('zoomed'); }
      if (zb(k)) zb(k).textContent = '⤢';
    });
    setView(S.view);
    return;
  }

  const panels = document.getElementById('panels');
  panels.className = 'panels v4'; // use v4 grid as base

  allVisible.forEach(k => {
    const p = document.getElementById('p-' + k);
    if (!p) return;
    if (k === S.zoomed) {
      p.classList.add('zoomed');
      p.classList.remove('hidden');
      if (zb(k)) zb(k).textContent = '⤡';
    } else {
      p.classList.remove('zoomed');
      p.classList.add('hidden');
      if (zb(k)) zb(k).textContent = '⤢';
    }
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
    if (!name) { showToast('Enter a name'); return; }
    S.templates[name] = document.getElementById('memText').value;
    saveTemplates(); renderTemplates();
    document.getElementById('tplNameInput').value = '';
    showToast(`Template "${name}" saved`);
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
    document.getElementById('promptsDrawer').style.display = 'none';
    document.getElementById('workflowsDrawer').style.display = 'none';
    document.getElementById('memText').value = S.memory;
    const lbl = document.getElementById('memLabelDisplay');
    if (lbl) lbl.textContent = S.memoryLabel ? `· ${S.memoryLabel}` : '';
  });
  document.getElementById('saveMemBtn').addEventListener('click', saveMemory);
  document.getElementById('autoSumBtn').addEventListener('click', autoSummarizeAll);
  document.getElementById('closeMemBtn').addEventListener('click', () => { memD.style.display = 'none'; });
  document.getElementById('memText').addEventListener('input', e => { S.memory = e.target.value; });
  document.getElementById('padBtn').addEventListener('click', () => {
    toggle(padD, memD);
    document.getElementById('promptsDrawer').style.display = 'none';
    document.getElementById('workflowsDrawer').style.display = 'none';
  });
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

const D = { running: false, rounds: 2, topic: '', lastReplies: {} };

function labelFor(key) {
  const isOllama = key.startsWith('ollama');
  return isOllama ? `Ollama` : AIS[key]?.name || key;
}

function bindDebate() {
  const debateBtn   = document.getElementById('debateBtn');
  const debateBar   = document.getElementById('debateBar');

  debateBtn.addEventListener('click', () => {
    const open = debateBar.style.display !== 'none';
    debateBar.style.display = open ? 'none' : 'flex';
    debateBtn.classList.toggle('active', !open);
    document.getElementById('summaryBar').style.display = 'none';
  });

  document.querySelectorAll('.round-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      D.rounds = parseInt(btn.dataset.rounds);
      document.querySelectorAll('.round-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('debateStartBtn').addEventListener('click', startDebate);
  document.getElementById('debateInput').addEventListener('keydown', e => { if (e.key === 'Enter') startDebate(); });
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
  if (targets.length < 2) { showToast('Need at least 2 active API panels'); return; }

  // Demo mode — simulate debate with canned responses and realistic delays
  if (DEMO_MODE) { await runDemoDebate(topic); return; }

  D.running = true; D.topic = topic; D.lastReplies = {};
  document.getElementById('debateInput').value = '';
  document.getElementById('debateStartBtn').disabled = true;
  document.getElementById('summaryBar').style.display = 'none';

  const addRoundHeader = (round) => {
    targets.forEach(key => {
      const cm = document.getElementById('cm-' + key);
      if (!cm) return;
      document.getElementById('es-' + key)?.remove();
      const hdr = document.createElement('div');
      hdr.className = 'round-header';
      hdr.textContent = round === 1 ? 'round 1 — initial response' : `round ${round} — reactions`;
      cm.appendChild(hdr); cm.scrollTop = cm.scrollHeight;
    });
  };

  setDebateStatus('Round 1…');
  addRoundHeader(1);

  // Round 1 — independent answers
  await Promise.all(targets.map(async key => {
    S.histories[key].push({ role: 'user', content: topic });
    addDebateBubble(key, 'user', topic, 1);
    const reply = await callAI(key);
    if (reply) {
      S.histories[key].push({ role: 'assistant', content: reply });
      addDebateBubble(key, 'assistant', reply, 1);
      D.lastReplies[key] = reply;
    }
  }));

  // Round 2+ — react to others
  for (let round = 2; round <= D.rounds; round++) {
    setDebateStatus(`Round ${round}…`);
    addRoundHeader(round);
    const prev = { ...D.lastReplies };

    await Promise.all(targets.map(async key => {
      const others = Object.entries(prev)
        .filter(([k]) => k !== key)
        .map(([k, r]) => `${labelFor(k)}: "${r}"`)
        .join('\n\n');
      const prompt = `Topic: "${D.topic}"\n\nOther AI responses:\n\n${others}\n\nReact to these perspectives — agree, disagree, or build on them. Be concise.`;
      S.histories[key].push({ role: 'user', content: prompt });
      const reply = await callAI(key);
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
    const msgs = (S.histories[key] || []).filter(m => m.role === 'assistant').map(m => m.content);
    return `${labelFor(key)}:\n${msgs.join('\n')}`;
  }).join('\n\n---\n\n');

  const prompt = `Debate topic: "${D.topic}"\n\n${allResponses}\n\nWrite a concise synthesis: what did they agree on, where did they differ, and what's the most useful takeaway?`;
  const sk = targets[0];

  try {
    S.histories[sk].push({ role: 'user', content: prompt });
    const summary = await callAI(sk);
    if (summary) {
      S.histories[sk].push({ role: 'assistant', content: summary });
      addSummaryBubble(sk, summary);
    }
  } catch (_) { showToast('Summary failed'); }

  document.getElementById('summaryBtn').disabled = false;
  setDebateStatus('');
}

async function callAI(key) {
  try {
    const hist = S.histories[key] || [];
    const sys = getSystemPrompt(key);
    if (key.startsWith('ollama')) return await AIS.ollama.call(null, hist, sys, S.ollamaModel);
    return await AIS[key].call(S.apiKeys[key], hist, sys);
  } catch (err) { return '⚠ ' + err.message; }
}

// Makes a vision API call with image attachments (replaces last user message with multipart content)
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

function addDebateBubble(key, role, text, round) {
  const cm = document.getElementById('cm-' + key);
  if (!cm) return;
  const wrap = document.createElement('div');
  wrap.className = `msg ${role} debate-round r${round}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (role === 'assistant' && typeof marked !== 'undefined') { bubble.innerHTML = marked.parse(text); } else { bubble.textContent = text; }
  wrap.appendChild(bubble);
  if (role === 'assistant') {
    const acts = document.createElement('div'); acts.className = 'msg-actions';
    const c = document.createElement('button'); c.className = 'ma-btn'; c.textContent = 'copy';
    c.addEventListener('click', () => navigator.clipboard.writeText(text).then(() => showToast('Copied!')));
    const p = document.createElement('button'); p.className = 'ma-btn'; p.textContent = '→ pad';
    p.addEventListener('click', () => {
      const pad = document.getElementById('padText');
      pad.value += (pad.value ? '\n\n' : '') + `[${labelFor(key)} · R${round}]\n${text}`;
      showToast('→ scratchpad');
    });
    acts.appendChild(c); acts.appendChild(p); wrap.appendChild(acts);
  }
  cm.appendChild(wrap); cm.scrollTop = cm.scrollHeight;
}

function addSummaryBubble(key, text) {
  const cm = document.getElementById('cm-' + key);
  if (!cm) return;
  const hdr = document.createElement('div');
  hdr.className = 'round-header'; hdr.textContent = '✦ debate summary';
  const wrap = document.createElement('div'); wrap.className = 'msg assistant summary-msg';
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  if (typeof marked !== 'undefined') { bubble.innerHTML = marked.parse(text); } else { bubble.textContent = text; }
  wrap.appendChild(bubble);
  const acts = document.createElement('div'); acts.className = 'msg-actions';
  const c = document.createElement('button'); c.className = 'ma-btn'; c.textContent = 'copy';
  c.addEventListener('click', () => navigator.clipboard.writeText(text).then(() => showToast('Copied!')));
  const p = document.createElement('button'); p.className = 'ma-btn'; p.textContent = '→ pad';
  p.addEventListener('click', () => {
    const pad = document.getElementById('padText');
    pad.value += (pad.value ? '\n\n' : '') + `[Debate Summary: ${D.topic}]\n${text}`;
    showToast('→ scratchpad');
  });
  acts.appendChild(c); acts.appendChild(p); wrap.appendChild(acts);
  cm.appendChild(hdr); cm.appendChild(wrap); cm.scrollTop = cm.scrollHeight;
}

function setDebateStatus(msg) {
  const el = document.getElementById('debateStatus');
  if (el) el.textContent = msg;
}

// ── Brainstorm Engine ─────────────────────────────────────────────────────────

function bindBrainstorm() {
  const bsBtn = document.getElementById('brainstormBtn');
  const bsBar = document.getElementById('brainstormBar');
  const dbBar = document.getElementById('debateBar');

  bsBtn.addEventListener('click', () => {
    const open = bsBar.style.display !== 'none';
    // Close debate bar if open (mutual exclusivity)
    dbBar.style.display = 'none';
    document.getElementById('debateBtn').classList.remove('active');
    bsBar.style.display = open ? 'none' : 'flex';
    bsBtn.classList.toggle('active', !open);
    document.getElementById('brainstormSummaryBar').style.display = 'none';
  });

  document.querySelectorAll('.bs-round-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      BS.rounds = parseInt(btn.dataset.bsrounds);
      document.querySelectorAll('.bs-round-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('brainstormStartBtn').addEventListener('click', startBrainstorm);
  document.getElementById('brainstormInput').addEventListener('keydown', e => { if (e.key === 'Enter') startBrainstorm(); });
  document.getElementById('brainstormSumBtn').addEventListener('click', summarizeBrainstorm);
  document.getElementById('brainstormSumCloseBtn').addEventListener('click', () => {
    document.getElementById('brainstormSummaryBar').style.display = 'none';
  });
}

async function startBrainstorm() {
  if (BS.running) return;
  const topic = document.getElementById('brainstormInput').value.trim();
  if (!topic) { showToast('Enter a brainstorm topic'); return; }
  const targets = sendableKeys();
  if (!targets.length) { showToast('No active API panels'); return; }

  BS.running = true; BS.topic = topic; BS.lastReplies = {};
  document.getElementById('brainstormInput').value = '';
  document.getElementById('brainstormStartBtn').disabled = true;
  document.getElementById('brainstormSummaryBar').style.display = 'none';

  const roundLabels = ['round 1 — ideas', 'round 2 — build on others', 'round 3 — synthesize'];

  const addRoundHeader = (round) => {
    targets.forEach(key => {
      const cm = document.getElementById('cm-' + key);
      if (!cm) return;
      document.getElementById('es-' + key)?.remove();
      const hdr = document.createElement('div');
      hdr.className = 'round-header';
      hdr.textContent = roundLabels[round - 1] || `round ${round}`;
      cm.appendChild(hdr); cm.scrollTop = cm.scrollHeight;
    });
  };

  // Round 1 — independent ideas, no anchoring
  setBrainstormStatus('Round 1…');
  addRoundHeader(1);
  await Promise.all(targets.map(async key => {
    const prompt = `Generate 3-5 creative, distinct ideas for: ${topic}\nBe specific and practical. Avoid obvious answers.`;
    S.histories[key].push({ role: 'user', content: prompt });
    addDebateBubble(key, 'user', prompt, 1);
    const reply = await callAI(key);
    if (reply) {
      S.histories[key].push({ role: 'assistant', content: reply });
      addDebateBubble(key, 'assistant', reply, 1);
      BS.lastReplies[key] = reply;
    }
  }));

  // Round 2 — each AI sees the others' round-1 ideas and builds on them
  if (BS.rounds >= 2) {
    setBrainstormStatus('Round 2…');
    addRoundHeader(2);
    const round1 = { ...BS.lastReplies };
    await Promise.all(targets.map(async key => {
      const others = Object.entries(round1)
        .filter(([k]) => k !== key)
        .map(([k, r]) => `${labelFor(k)}: "${r}"`)
        .join('\n\n');
      const prompt = `Here are ideas from other AIs:\n\n${others}\n\nBuild on the strongest ideas. Combine concepts from different responses. Add what's missing.`;
      S.histories[key].push({ role: 'user', content: prompt });
      const reply = await callAI(key);
      if (reply) {
        S.histories[key].push({ role: 'assistant', content: reply });
        addDebateBubble(key, 'assistant', reply, 2);
        BS.lastReplies[key] = reply;
      }
    }));
  }

  // Round 3 — synthesize all round-2 thinking into a final recommendation
  if (BS.rounds >= 3) {
    setBrainstormStatus('Round 3…');
    addRoundHeader(3);
    const round2 = { ...BS.lastReplies };
    await Promise.all(targets.map(async key => {
      const allR2 = Object.entries(round2)
        .map(([k, r]) => `${labelFor(k)}: "${r}"`)
        .join('\n\n');
      const prompt = `Here is the refined thinking so far:\n\n${allR2}\n\nSynthesize into a final recommended approach. Be concrete and actionable.`;
      S.histories[key].push({ role: 'user', content: prompt });
      const reply = await callAI(key);
      if (reply) {
        S.histories[key].push({ role: 'assistant', content: reply });
        addDebateBubble(key, 'assistant', reply, 3);
        BS.lastReplies[key] = reply;
      }
    }));
  }

  BS.running = false;
  setBrainstormStatus('done');
  document.getElementById('brainstormStartBtn').disabled = false;
  document.getElementById('brainstormSummaryBar').style.display = 'flex';
  showToast('Brainstorm complete — synthesize?');
}

async function summarizeBrainstorm() {
  const targets = sendableKeys();
  if (!targets.length) return;
  document.getElementById('brainstormSumBtn').disabled = true;
  setBrainstormStatus('synthesizing…');

  const allResponses = targets.map(key => {
    const msgs = (S.histories[key] || []).filter(m => m.role === 'assistant').map(m => m.content);
    return `${labelFor(key)}:\n${msgs.join('\n')}`;
  }).join('\n\n---\n\n');

  const prompt = `Brainstorm topic: "${BS.topic}"\n\n${allResponses}\n\nSynthesize these ideas into a clear, prioritized action plan. Remove duplicates. Keep only the most actionable suggestions.`;
  const sk = targets[0];

  try {
    S.histories[sk].push({ role: 'user', content: prompt });
    const summary = await callAI(sk);
    if (summary) {
      S.histories[sk].push({ role: 'assistant', content: summary });
      addSummaryBubble(sk, summary);
    }
  } catch (_) { showToast('Synthesis failed'); }

  document.getElementById('brainstormSumBtn').disabled = false;
  setBrainstormStatus('');
}

function setBrainstormStatus(msg) {
  const el = document.getElementById('brainstormStatus');
  if (el) el.textContent = msg;
}

// ── Conflict Detection ────────────────────────────────────────────────────────

// Called after every broadcast with ≥2 real API panels.
// Silent on failure — never blocks or throws to the caller.
async function checkConflict(question, targets) {
  const sk = sendableKeys()[0];
  if (!sk) return;

  const responses = targets
    .map(k => {
      const last = [...(S.histories[k] || [])].reverse().find(m => m.role === 'assistant');
      return last ? `${labelFor(k)}: "${last.content.slice(0, 300)}"` : null;
    })
    .filter(Boolean)
    .join('\n\n');

  if (!responses) return;

  const prompt = `Here are responses from different AI models to the question '${question}':\n\n${responses}\n\nIn one sentence: do these responses significantly disagree on any key facts or recommendations? Answer only: 'CONFLICT: [brief description]' or 'AGREE: responses are broadly consistent'`;

  try {
    const reply = sk === 'ollama'
      ? await AIS.ollama.call(null, [{ role: 'user', content: prompt }], null, S.ollamaModel)
      : await AIS[sk].call(S.apiKeys[sk], [{ role: 'user', content: prompt }], null);

    if (reply && /^CONFLICT:/i.test(reply.trim())) {
      const desc = reply.trim().replace(/^CONFLICT:\s*/i, '');
      document.getElementById('conflictMsg').textContent = desc;
      document.getElementById('conflictBanner').style.display = 'flex';
    }
  } catch (_) { /* silent — conflict detection is best-effort */ }
}

// ── Prompt Library ────────────────────────────────────────────────────────────

function loadPrompts() {
  try {
    const saved = JSON.parse(localStorage.getItem('aihub_prompts') || 'null');
    S_prompts = saved || DEFAULT_PROMPTS.slice();
    if (!saved) savePrompts(); // persist defaults on first run
  } catch (_) { S_prompts = DEFAULT_PROMPTS.slice(); }
}

function savePrompts() {
  try { localStorage.setItem('aihub_prompts', JSON.stringify(S_prompts)); } catch (_) {}
}

function renderPrompts() {
  const list = document.getElementById('promptList');
  list.innerHTML = '';
  if (!S_prompts.length) {
    list.innerHTML = '<p class="prompt-empty">No prompts saved. Type in the broadcast bar and save it above.</p>';
    return;
  }
  S_prompts.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'prompt-item';
    const textDiv = document.createElement('div');
    textDiv.className = 'prompt-item-text';
    textDiv.innerHTML = `<div class="prompt-item-name">${p.name}</div><div class="prompt-item-preview">${p.text.slice(0, 60)}${p.text.length > 60 ? '…' : ''}</div>`;
    // Click the text area → fill broadcast input
    textDiv.addEventListener('click', () => {
      document.getElementById('broadcastInput').value = p.text;
      showToast(`Loaded "${p.name}"`);
    });
    const del = document.createElement('button');
    del.className = 'prompt-del'; del.textContent = '✕';
    del.addEventListener('click', e => {
      e.stopPropagation();
      S_prompts.splice(i, 1);
      savePrompts(); renderPrompts();
    });
    item.appendChild(textDiv); item.appendChild(del);
    list.appendChild(item);
  });
}

function bindPromptLibrary() {
  const promptsD = document.getElementById('promptsDrawer');

  document.getElementById('promptsBtn').addEventListener('click', () => {
    const open = promptsD.style.display !== 'none';
    document.getElementById('memDrawer').style.display = 'none';
    document.getElementById('padDrawer').style.display = 'none';
    document.getElementById('workflowsDrawer').style.display = 'none';
    promptsD.style.display = open ? 'none' : 'flex';
    if (!open) { promptsD.style.flexDirection = 'column'; renderPrompts(); }
  });

  document.getElementById('closePromptsBtn').addEventListener('click', () => {
    promptsD.style.display = 'none';
  });

  document.getElementById('savePromptBtn').addEventListener('click', () => {
    const name = document.getElementById('promptNameInput').value.trim();
    const text = document.getElementById('broadcastInput').value.trim();
    if (!name) { showToast('Enter a prompt name'); return; }
    if (!text) { showToast('Type something in the broadcast bar first'); return; }
    S_prompts.push({ name, text });
    savePrompts(); renderPrompts();
    document.getElementById('promptNameInput').value = '';
    showToast(`Prompt "${name}" saved`);
  });
}

// ── Export ────────────────────────────────────────────────────────────────────

function exportSession() {
  const now      = new Date();
  const dateStr  = now.toISOString().slice(0, 10);  // YYYY-MM-DD for filename
  const dateTime = now.toLocaleString();

  let md = `# AI Hub Session Export\nDate: ${dateTime}\n\n`;

  if (S.memory.trim()) {
    md += `## Memory Context\n${S.memory.trim()}\n\n`;
  }

  md += `## Conversations\n\n`;

  ALL_KEYS.forEach(key => {
    const hist = S.histories[key];
    if (!hist || !hist.length) return;
    const name = key === 'ollama' ? `Ollama (${S.ollamaModel})` : AIS[key].name;
    md += `### ${name}\n\n`;
    hist.forEach(msg => {
      if (msg.role === 'user') md += `**You:** ${msg.content}\n\n`;
      else                     md += `**${name}:** ${msg.content}\n\n`;
    });
  });

  md += `---\nExported from AI Hub · https://codeandcalories.github.io/ai-hub/dashboard/`;

  const blob = new Blob([md], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `aihub-export-${dateStr}.md`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast('Session exported ✓');
}

// ── Demo Functions ────────────────────────────────────────────────────────────

// Simulates a single AI response: shows user bubble, typing indicator,
// waits a realistic delay, then shows the canned demo reply.
async function sendDemoMessage(key, text, isRelay) {
  if (!DEMO_RESPONSES[key] || S.loading[key]) return;
  document.getElementById('es-' + key)?.remove();
  if (!isRelay) {
    S.histories[key].push({ role: 'user', content: text });
    addBubble(key, 'user', text);
  }
  const tid = addTyping(key);
  S.loading[key] = true; setSend(key, true);
  // Realistic thinking delay: 800–2000ms
  await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
  removeEl(tid);
  const responses = DEMO_RESPONSES[key];
  const reply = responses[DEMO_COUNTERS[key] % responses.length];
  DEMO_COUNTERS[key]++;
  S.histories[key].push({ role: 'assistant', content: reply });
  addBubble(key, 'assistant', reply);
  S.loading[key] = false; setSend(key, false);
}

// Activates demo mode: skips setup, loads all 4 panels with fake keys,
// shows the demo banner, and drops straight into the 4-panel view.
function launchDemo() {
  DEMO_MODE = true;
  // Give all 4 cloud AIs 'api' mode + a placeholder key so sendableKeys() returns them
  CLOUD_KEYS.forEach(key => {
    S.modes[key] = 'api';
    S.apiKeys[key] = 'demo-placeholder';
    S.histories[key] = []; S.loading[key] = false; S.unread[key] = 0;
  });
  S.modes.ollama = 'off';
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = 'flex';
  const banner = document.getElementById('demoBanner');
  banner.style.display = 'flex';
  document.getElementById('demoExitBtn').addEventListener('click', () => location.reload());
  S.activeTab = sendableKeys()[0];
  buildPanels(); bindMain(); setView(4);
}

// Runs a simulated debate using DEMO_RESPONSES instead of real API calls.
async function runDemoDebate(topic) {
  const targets = CLOUD_KEYS.filter(k => DEMO_RESPONSES[k]);
  D.running = true; D.topic = topic; D.lastReplies = {};
  document.getElementById('debateInput').value = '';
  document.getElementById('debateStartBtn').disabled = true;
  document.getElementById('summaryBar').style.display = 'none';

  const addRoundHeader = (round) => {
    targets.forEach(key => {
      const cm = document.getElementById('cm-' + key);
      if (!cm) return;
      document.getElementById('es-' + key)?.remove();
      const hdr = document.createElement('div');
      hdr.className = 'round-header';
      hdr.textContent = round === 1 ? 'round 1 — initial response' : `round ${round} — reactions`;
      cm.appendChild(hdr); cm.scrollTop = cm.scrollHeight;
    });
  };

  setDebateStatus('Round 1…');
  addRoundHeader(1);

  // Round 1 — each panel gets an independent demo response
  await Promise.all(targets.map(async key => {
    S.histories[key].push({ role: 'user', content: topic });
    addDebateBubble(key, 'user', topic, 1);
    const tid = addTyping(key);
    await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
    removeEl(tid);
    const reply = DEMO_RESPONSES[key][DEMO_COUNTERS[key] % DEMO_RESPONSES[key].length];
    DEMO_COUNTERS[key]++;
    S.histories[key].push({ role: 'assistant', content: reply });
    addDebateBubble(key, 'assistant', reply, 1);
    D.lastReplies[key] = reply;
  }));

  // Round 2+ — reactions with staggered delays between rounds
  for (let round = 2; round <= D.rounds; round++) {
    setDebateStatus(`Round ${round}…`);
    addRoundHeader(round);
    await new Promise(r => setTimeout(r, 400));
    await Promise.all(targets.map(async key => {
      const tid = addTyping(key);
      await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
      removeEl(tid);
      const reply = DEMO_RESPONSES[key][DEMO_COUNTERS[key] % DEMO_RESPONSES[key].length];
      DEMO_COUNTERS[key]++;
      S.histories[key].push({ role: 'assistant', content: reply });
      addDebateBubble(key, 'assistant', reply, round);
      D.lastReplies[key] = reply;
    }));
  }

  D.running = false;
  setDebateStatus('done');
  document.getElementById('debateStartBtn').disabled = false;
  document.getElementById('summaryBar').style.display = 'flex';
  showToast('Debate complete — summarize?');
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
  bindBrainstorm();
  bindDrawers();
  bindTemplates();
  bindPromptLibrary();
  loadPrompts();
  bindKeyboardShortcuts();
  bindWorkflows();
  document.getElementById('exportBtn').addEventListener('click', exportSession);
  document.getElementById('conflictDismiss').addEventListener('click', () => {
    document.getElementById('conflictBanner').style.display = 'none';
  });
  document.getElementById('settingsBtn').addEventListener('click', goToSettings);
  document.getElementById('shortcutsBtn').addEventListener('click', () => {
    document.getElementById('shortcutsModal').style.display = 'flex';
  });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200);
}

// ── Keyboard Shortcuts ────────────────────────────────────────────────────────

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const modal = document.getElementById('shortcutsModal');

    // Escape — close any open drawer or modal
    if (e.key === 'Escape') {
      if (modal && modal.style.display !== 'none') { modal.style.display = 'none'; return; }
      ['memDrawer','padDrawer','tplPanel','debateBar','brainstormBar','promptsDrawer','workflowsDrawer'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.style.display !== 'none') el.style.display = 'none';
      });
      document.querySelectorAll('.persona-popover').forEach(p => p.style.display = 'none');
      return;
    }

    // Don't fire shortcuts when typing in an input
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    // ? — show shortcuts modal
    if (e.key === '?') {
      if (modal) modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
      return;
    }

    // B — focus broadcast input
    if (e.key === 'b' || e.key === 'B') {
      const bi = document.getElementById('broadcastInput');
      if (bi) { bi.focus(); e.preventDefault(); }
    }

    // M — toggle memory drawer
    if (e.key === 'm' || e.key === 'M') { document.getElementById('memBtn')?.click(); }

    // P — toggle prompt library
    if (e.key === 'p' || e.key === 'P') { document.getElementById('promptsBtn')?.click(); }

    // D — toggle debate bar
    if (e.key === 'd' || e.key === 'D') { document.getElementById('debateBtn')?.click(); }

    // 1, 2, 3, 4 — switch view
    if (['1','2','3','4'].includes(e.key)) { setView(parseInt(e.key)); }

    // Ctrl+Enter — send broadcast
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      const bi = document.getElementById('broadcastInput');
      if (bi && bi.value.trim()) { document.getElementById('broadcastBtn')?.click(); e.preventDefault(); }
    }

    // Ctrl+E — export session
    if (e.key === 'e' && (e.ctrlKey || e.metaKey)) { exportSession?.(); e.preventDefault(); }
  });

  document.getElementById('shortcutsClose')?.addEventListener('click', () => {
    document.getElementById('shortcutsModal').style.display = 'none';
  });
}

// ── Workflows ─────────────────────────────────────────────────────────────────

const DEFAULT_WORKFLOWS = [
  { name: "Morning Research", view: 4, memory: "I am researching and want thorough, sourced answers. Prioritise accuracy over brevity.", modes: { chatgpt: 'api', claude: 'api', gemini: 'api', grok: 'api' } },
  { name: "Code Review", view: 2, memory: "You are a senior software engineer. Review code critically. Point out bugs, edge cases, and improvements.", modes: { chatgpt: 'api', claude: 'api', gemini: 'off', grok: 'off' } },
  { name: "Creative Brainstorm", view: 4, memory: "Be creative and unconventional. Avoid obvious answers. Think laterally.", modes: { chatgpt: 'api', claude: 'api', gemini: 'api', grok: 'api' } }
];

function loadWorkflows() {
  try { return JSON.parse(localStorage.getItem('aihub_workflows') || 'null') || []; } catch (_) { return []; }
}

function saveWorkflowsToStorage(workflows) {
  try { localStorage.setItem('aihub_workflows', JSON.stringify(workflows)); } catch (_) {}
}

function renderWorkflows() {
  const list = document.getElementById('workflowsList');
  const workflows = loadWorkflows();
  const all = workflows.length ? workflows : DEFAULT_WORKFLOWS;
  list.innerHTML = '';
  all.forEach((wf, i) => {
    const card = document.createElement('div');
    card.className = 'workflow-card';
    const info = document.createElement('div');
    info.className = 'workflow-info';
    const name = document.createElement('div');
    name.className = 'workflow-name'; name.textContent = wf.name;
    const meta = document.createElement('div');
    meta.className = 'workflow-meta';
    const modeKeys = wf.modes || {};
    CLOUD_KEYS.forEach(k => {
      const pill = document.createElement('span');
      pill.className = 'workflow-pill' + (modeKeys[k] === 'api' ? ' active' : '');
      pill.textContent = AIS[k]?.name || k;
      meta.appendChild(pill);
    });
    const viewPill = document.createElement('span');
    viewPill.className = 'workflow-pill'; viewPill.textContent = `${wf.view} panel${wf.view > 1 ? 's' : ''}`;
    meta.appendChild(viewPill);
    info.appendChild(name); info.appendChild(meta);
    const actions = document.createElement('div');
    actions.className = 'workflow-actions';
    const loadBtn = document.createElement('button');
    loadBtn.className = 'db-btn'; loadBtn.textContent = 'load';
    loadBtn.addEventListener('click', () => {
      S.memory = wf.memory || '';
      const mt = document.getElementById('memText'); if (mt) mt.value = S.memory;
      setView(wf.view || 4);
      document.getElementById('workflowsDrawer').style.display = 'none';
      showToast(`Workflow loaded: ${wf.name}`);
    });
    actions.appendChild(loadBtn);
    if (workflows.length) {
      const delBtn = document.createElement('button');
      delBtn.className = 'db-btn'; delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => { workflows.splice(i, 1); saveWorkflowsToStorage(workflows); renderWorkflows(); });
      actions.appendChild(delBtn);
    }
    card.appendChild(info); card.appendChild(actions);
    list.appendChild(card);
  });
}

function bindWorkflows() {
  const wfDrawer = document.getElementById('workflowsDrawer');
  document.getElementById('workflowsBtn').addEventListener('click', () => {
    // Close other drawers
    ['memDrawer','padDrawer','promptsDrawer'].forEach(id => { document.getElementById(id).style.display = 'none'; });
    const open = wfDrawer.style.display !== 'none';
    wfDrawer.style.display = open ? 'none' : 'flex';
    if (!open) { wfDrawer.style.flexDirection = 'column'; renderWorkflows(); }
  });
  document.getElementById('closeWorkflowsBtn').addEventListener('click', () => { wfDrawer.style.display = 'none'; });
  document.getElementById('saveWorkflowBtn').addEventListener('click', () => {
    const row = document.getElementById('workflowSaveRow');
    row.style.display = row.style.display === 'none' ? 'flex' : 'none';
  });
  document.getElementById('confirmSaveWorkflow').addEventListener('click', () => {
    const name = document.getElementById('workflowNameInput').value.trim();
    if (!name) { showToast('Enter a workflow name'); return; }
    const workflows = loadWorkflows();
    workflows.push({ name, view: S.view, memory: S.memory, modes: { ...S.modes } });
    saveWorkflowsToStorage(workflows);
    document.getElementById('workflowNameInput').value = '';
    document.getElementById('workflowSaveRow').style.display = 'none';
    renderWorkflows();
    showToast(`Workflow "${name}" saved`);
  });
  document.getElementById('cancelSaveWorkflow').addEventListener('click', () => {
    document.getElementById('workflowSaveRow').style.display = 'none';
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const d = store.get(['view', 'modes', 'memLabel', 'ollamaOn', 'ollamaModel']);
  if (d.view) S.view = d.view;
  buildSetup({ modes: d.modes, memoryLabel: d.memLabel, ollamaOn: d.ollamaOn, ollamaModel: d.ollamaModel });
});
