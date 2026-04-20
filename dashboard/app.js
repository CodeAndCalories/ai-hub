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
  zoomed:      null,
  sessionTitle: '',
  branches:    {}, // key → [{ id, name, messages, currentBranch }]
  activeBranch: {} // key → branchIndex (-1 = main)
};

const responseTimes = {};

// ── Analytics State ───────────────────────────────────────────────────────────
const SESSION_START = Date.now();
const sessionStats = {
  messages: {},      // key → count this session
  responseTimes: {}, // key → [ms, ...]
  wordCounts: {},    // key → total words
  charCounts: {},    // key → total chars
};
// Load cumulative stats from localStorage
let cumulativeStats = {};
try { cumulativeStats = JSON.parse(localStorage.getItem('aihub_stats') || '{}'); } catch(_) {}

// ── Pin Storage ───────────────────────────────────────────────────────────────
// Load persisted pins on startup
try {
  const savedPins = JSON.parse(localStorage.getItem('aihub_pins') || '{}');
  Object.assign(pinnedMessages, savedPins);
} catch(_) {}

// ── Branch State ──────────────────────────────────────────────────────────────
// S.branches is defined after S, set it here
// branches[key] = [{ id, name, messages, fromIndex, createdAt }]

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

// Last broadcast responses for comparison — cleared before each broadcast
let lastBroadcastResponses = {};

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

const COMMUNITY_PROMPTS = [
  { name: 'Explain Like I\'m 5', text: 'Explain this concept in the simplest possible way, as if I\'m five years old. Use a relatable analogy:', tags: ['learning'] },
  { name: 'Code Review Checklist', text: 'Review this code systematically. Check for: 1) bugs and edge cases, 2) security issues, 3) performance problems, 4) readability, 5) missing tests. Be specific:\n\n```\n[paste code here]\n```', tags: ['dev'] },
  { name: 'Pros, Cons & Recommendation', text: 'Analyze this with a structured pros/cons breakdown, then give a clear recommendation:\n\n[topic or decision]', tags: ['analysis'] },
  { name: 'Write Tests For This', text: 'Generate comprehensive test cases for this code. Cover happy paths, edge cases, and error scenarios:\n\n```\n[paste code here]\n```', tags: ['dev'] },
  { name: 'Translate to [Language]', text: 'Translate the following to [target language], keeping the tone and meaning intact:\n\n[text to translate]', tags: ['writing'] },
  { name: 'Summarize in 3 Bullets', text: 'Summarize the following in exactly 3 bullet points. Be concise and capture the most important points:\n\n[text to summarize]', tags: ['writing'] },
  { name: 'Devil\'s Advocate', text: 'Challenge the following position with the strongest possible counterarguments. Be constructively critical:\n\n[position or idea]', tags: ['analysis'] },
  { name: 'Step-by-Step Tutorial', text: 'Create a clear, beginner-friendly step-by-step tutorial for:\n\n[topic or task]\n\nInclude prerequisites, numbered steps, and expected outcomes for each step.', tags: ['learning'] },
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
          <!-- Native mode hidden - may re-enable later -->
          <button class="ms-btn ${mode==='native'?'active':''}" data-key="${key}" data-mode="native" style="display:none">Native</button>
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

  try {
    const saved = sessionStorage.getItem('aihub_session_histories');
    const savedModes = sessionStorage.getItem('aihub_session_modes');
    if (saved) {
      const parsed = JSON.parse(saved);
      ALL_KEYS.forEach(key => {
        if (parsed[key]?.length) {
          S.histories[key] = parsed[key];
          restorePanelHistory(key);
        }
      });
    }
    const savedMem = sessionStorage.getItem('aihub_session_memory');
    if (savedMem && !S.memory) S.memory = savedMem;
  } catch(_) {}

  if (window.innerWidth <= 768) setView(1);
  applyTemplateParam();
}

function restorePanelHistory(key) {
  const cm = document.getElementById('cm-' + key);
  if (!cm || !S.histories[key]?.length) return;
  document.getElementById('es-' + key)?.remove();
  S.histories[key].forEach(msg => {
    if (msg.role === 'user' || msg.role === 'assistant') {
      addBubble(key, msg.role, msg.content);
    }
  });
  cm.scrollTop = cm.scrollHeight;
}

function goToSettings() {
  try {
    sessionStorage.setItem('aihub_session_histories', JSON.stringify(S.histories));
    sessionStorage.setItem('aihub_session_memory', S.memory);
    sessionStorage.setItem('aihub_session_modes', JSON.stringify(S.modes));
  } catch(_) {}
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
        <span class="eh">${hasKey ? (isOllama ? 'local · free · ready' : 'ready · memory ' + (S.memory ? 'on' : 'off')) : '⚠ no api key — go to settings'}</span>
        ${hasKey ? `<div class="quick-prompts" id="qp-${key}">
          <p class="qp-label">Try asking:</p>
          <button class="qp-chip" data-key="${key}" data-prompt="Explain this simply: ">Explain something</button>
          <button class="qp-chip" data-key="${key}" data-prompt="Write a quick summary of: ">Summarize</button>
          <button class="qp-chip" data-key="${key}" data-prompt="What are the pros and cons of: ">Pros &amp; cons</button>
          <button class="qp-chip" data-key="${key}" data-prompt="Give me 5 creative ideas for: ">Brainstorm ideas</button>
          <button class="qp-chip" data-key="${key}" data-prompt="Review and improve this: ">Review &amp; improve</button>
        </div>` : ''}
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

  // Quick prompt chips
  const qp = document.getElementById('qp-' + key);
  if (qp) {
    qp.addEventListener('click', e => {
      const chip = e.target.closest('.qp-chip');
      if (!chip) return;
      const ta2 = document.getElementById('ct-' + chip.dataset.key);
      if (ta2) { ta2.value = chip.dataset.prompt; ta2.focus(); }
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
  responseTimes[key] = Date.now();
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
    const elapsedMs = Date.now() - responseTimes[key];
    const elapsed = (elapsedMs / 1000).toFixed(1) + 's';
    removeEl(tid);
    S.histories[key].push({ role: 'assistant', content: reply });
    addBubble(key, 'assistant', reply, null, elapsed);
    const shown = S.view === 4 ? visibleKeys() : buildShownList(S.view);
    if (!shown.includes(key)) { S.unread[key]++; buildTabBar(S.view, visibleKeys()); }
    if (S.histories[key].length % 20 === 0) autoSummarizeOne(key);
    if (S.histories[key].length === 2 && !S.sessionTitle) { generateSessionTitle(); }
    // Memstore auto-save — fire-and-forget
    const aiName = key.startsWith('ollama') ? `Ollama` : (AIS[key]?.name || key);
    Memstore.rememberResponse(aiName, text, reply);
    // Track analytics
    trackStats(key, elapsedMs, reply);
    // Cross-tab sync: broadcast user message + reply
    broadcastToTabs({ type: 'msg', key, role: 'user', text });
    broadcastToTabs({ type: 'msg', key, role: 'assistant', text: reply });
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

  // Hide compare button before new broadcast
  const cmpBtn = document.getElementById('compareBtn');
  if (cmpBtn) cmpBtn.style.display = 'none';
  lastBroadcastResponses = {};

  // Demo mode — fire demo responses for each panel and stop
  if (DEMO_MODE) { targets.forEach(k => sendDemoMessage(k, text)); return; }

  // Hide any stale conflict banner from a previous broadcast
  document.getElementById('conflictBanner').style.display = 'none';

  await Promise.allSettled(targets.map(k => send(k, text)));

  // Collect responses for comparison
  sendableKeys().forEach(k => {
    const last = [...(S.histories[k] || [])].reverse().find(m => m.role === 'assistant');
    if (last) lastBroadcastResponses[k] = last.content;
  });
  if (Object.keys(lastBroadcastResponses).length >= 2 && cmpBtn) {
    cmpBtn.style.display = '';
  }

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

function addBubble(key, role, text, images, elapsed) {
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
    bubble.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(marked.parse(text)) : marked.parse(text);
  } else {
    bubble.textContent = text;
  }

  // Copy buttons on code blocks
  if (role === 'assistant') {
    bubble.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code');
      if (!code) return;
      const btn = document.createElement('button');
      btn.className = 'copy-code-btn';
      btn.textContent = 'copy';
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(code.textContent)
          .then(() => { btn.textContent = 'copied!'; setTimeout(() => btn.textContent = 'copy', 2000); });
      });
      pre.style.position = 'relative';
      pre.appendChild(btn);
    });
  }

  wrap.appendChild(bubble);

  // Save-to-library link on user bubbles
  if (role === 'user' && text) {
    const saveLink = document.createElement('button');
    saveLink.className = 'save-to-lib-btn';
    saveLink.textContent = '+ save to library';
    saveLink.addEventListener('click', () => {
      const name = text.slice(0, 40).trim() + (text.length > 40 ? '…' : '');
      S_prompts.push({ name, text });
      savePrompts();
      showToast('Saved to library');
      saveLink.textContent = 'saved ✓';
      saveLink.disabled = true;
    });
    wrap.appendChild(saveLink);
  }

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
    const branchBtn = document.createElement('button');
    branchBtn.className = 'branch-btn'; branchBtn.textContent = '⑂ branch';
    branchBtn.title = 'Branch conversation from here';
    branchBtn.onclick = () => {
      const msgIndex = S.histories[key].findIndex(m => m.role === 'assistant' && m.content === text);
      createBranch(key, msgIndex >= 0 ? msgIndex : S.histories[key].length - 1);
    };
    acts.appendChild(copyBtn); acts.appendChild(padBtn); acts.appendChild(shareBtn); acts.appendChild(pinBtn); acts.appendChild(branchBtn);
    wrap.appendChild(acts);

    if (elapsed) {
      const words = text.split(/\s+/).filter(Boolean).length;
      const chars = text.length;
      const meta = document.createElement('div');
      meta.className = 'response-meta';
      meta.innerHTML = `<span class="response-time">${elapsed}</span><span class="response-words">${words} words</span><span class="response-chars">${chars} chars</span>`;
      wrap.appendChild(meta);
    }
  }
  cm.appendChild(wrap); cm.scrollTop = cm.scrollHeight;
}

function pinMessage(key, text, btn) {
  if (!pinnedMessages[key]) pinnedMessages[key] = [];
  // Prevent duplicate pins
  if (pinnedMessages[key].some(p => p.text === text)) { showToast('Already pinned'); return; }
  pinnedMessages[key].push({ text, key, ts: Date.now() });
  if (btn) { btn.textContent = '📌 pinned'; btn.disabled = true; }
  renderPinnedSection(key);
  savePins();
  showToast('Pinned ✓');
}

function savePins() {
  try { localStorage.setItem('aihub_pins', JSON.stringify(pinnedMessages)); } catch(_) {}
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
      savePins();
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
  if (role === 'assistant' && typeof marked !== 'undefined') { bubble.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(marked.parse(text)) : marked.parse(text); } else { bubble.textContent = text; }
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
  if (typeof marked !== 'undefined') { bubble.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(marked.parse(text)) : marked.parse(text); } else { bubble.textContent = text; }
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
    const prompt = `You are participating in a structured brainstorm with other AI models on this topic: "${topic}"

Generate 3-5 genuinely creative, distinct ideas.
Rules:
- Be specific and concrete, not vague
- Avoid the most obvious answers
- Each idea should be meaningfully different from the others
- Format as numbered list with a bold title and 1-2 sentence explanation per idea`;
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
      const prompt = `You are in round 2 of a brainstorm on: "${topic}"

Here is what other AI models suggested in round 1:
${others}

Your task:
1. Identify the 1-2 strongest ideas from above
2. Combine or extend them in a new way the original author didn't consider
3. Add 1-2 completely new ideas that fill gaps nobody covered yet
4. Be specific — no generic "you could also..." additions

Format as numbered list with bold titles.`;
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
      const prompt = `Final round brainstorm on: "${topic}"

All ideas generated so far:
${allR2}

Synthesize into a FINAL RECOMMENDATION:
1. The single strongest idea (explain why)
2. How to actually execute it in the next 7 days
3. The biggest risk and how to mitigate it
4. One unconventional twist that could make it 10x better

Be decisive and specific. This is the action plan.`;
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

  const prompt = `Here is a complete brainstorm on: "${BS.topic}"

${allResponses}

Create a structured action plan:
## Top 3 Ideas (ranked)
[rank with brief reasoning]

## Recommended Starting Point
[single most actionable idea with first 3 steps]

## What to Avoid
[ideas that sound good but have hidden problems]

## The Wildcard
[most unconventional idea worth considering]

Keep it concise and actionable.`;
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

// ── Plan Mode ─────────────────────────────────────────────────────────────────

const PLAN_TEMPLATES = {
  architecture: {
    label: 'Architecture Review',
    prompt: 'Review the architecture for this system and provide: 1) Key strengths, 2) Potential risks or weaknesses, 3) Specific recommendations for improvement.',
    systemPrefix: 'You are a senior software architect. Be specific and technical.'
  },
  debug: {
    label: 'Debug This',
    prompt: 'Suggest debugging approaches for this issue. Provide: 1) Most likely root causes, 2) How to diagnose them, 3) Potential fixes.',
    systemPrefix: 'You are an expert debugger. Be methodical and specific.'
  },
  compare: {
    label: 'Compare Approaches',
    prompt: 'Compare the technical approaches for this. Argue for the approach you think is best. Cover: 1) Tradeoffs, 2) When each shines, 3) Your recommendation.',
    systemPrefix: 'You are a technical decision-maker. Be opinionated and justify your position.'
  }
};

const PLAN = { running: false, topic: '', template: null, replies: {} };

function bindPlanMode() {
  const planBtn  = document.getElementById('planBtn');
  const planBar  = document.getElementById('planBar');
  const planSBar = document.getElementById('planSynthesisBar');

  planBtn.addEventListener('click', () => {
    const open = planBar.style.display !== 'none';
    planBar.style.display = open ? 'none' : 'flex';
    if (!open) document.getElementById('planInput').focus();
  });

  document.querySelectorAll('.plan-tpl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tpl = PLAN_TEMPLATES[btn.dataset.tpl];
      if (!tpl) return;
      PLAN.template = btn.dataset.tpl;
      document.getElementById('planInput').placeholder = tpl.prompt;
      document.querySelectorAll('.plan-tpl-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('planStartBtn').addEventListener('click', startPlanMode);

  document.getElementById('planSynthBtn').addEventListener('click', () => {
    planSBar.style.display = 'none';
    synthesizePlans();
  });
  document.getElementById('planSynthCloseBtn').addEventListener('click', () => {
    planSBar.style.display = 'none';
  });
}

async function startPlanMode() {
  if (PLAN.running) return;
  const topic = document.getElementById('planInput').value.trim();
  if (!topic) { showToast('Enter a planning topic'); return; }

  const targets = sendableKeys();
  if (!targets.length) { showToast('No active AI panels'); return; }

  const tpl = PLAN.template ? PLAN_TEMPLATES[PLAN.template] : null;
  const systemPrompt = tpl
    ? tpl.systemPrefix + '\n\n' + (S.memory || '')
    : (S.memory || '');

  const fullPrompt = tpl
    ? `${topic}\n\n${tpl.prompt}`
    : topic;

  PLAN.running = true; PLAN.topic = topic; PLAN.replies = {};

  document.getElementById('planSynthesisBar').style.display = 'none';

  // Send to all active panels simultaneously
  const sends = targets.map(async key => {
    try {
      const msgs = [{ role: 'user', content: fullPrompt }];
      S.histories[key].push({ role: 'user', content: fullPrompt });
      addBubble(key, 'user', fullPrompt);
      const tid = addTyping(key);
      S.loading[key] = true; setSend(key, true);

      let reply;
      if (DEMO_MODE) {
        await new Promise(r => setTimeout(r, 900 + Math.random() * 800));
        const dr = DEMO_RESPONSES[key];
        reply = dr ? dr[DEMO_COUNTERS[key]++ % dr.length] : 'Demo response.';
      } else if (key === 'ollama') {
        reply = await AIS.ollama.call(null, msgs, systemPrompt, S.ollamaModel);
      } else {
        reply = await AIS[key].call(S.apiKeys[key], msgs, systemPrompt);
      }

      removeEl(tid);
      S.histories[key].push({ role: 'assistant', content: reply });
      addBubble(key, 'assistant', reply);
      PLAN.replies[key] = reply;
    } catch (err) {
      removeEl('typing-' + key);
      addBubble(key, 'assistant', `⚠ ${err.message}`);
    } finally {
      S.loading[key] = false; setSend(key, false);
    }
  });

  await Promise.all(sends);
  PLAN.running = false;

  if (Object.keys(PLAN.replies).length >= 2) {
    document.getElementById('planSynthesisBar').style.display = 'flex';
  }
}

async function synthesizePlans() {
  const sk = sendableKeys()[0];
  if (!sk) { showToast('No active AI to synthesize'); return; }

  const allPlans = Object.entries(PLAN.replies)
    .map(([key, reply]) => `**${AIS[key]?.name || key}:**\n${reply}`)
    .join('\n\n---\n\n');

  const metaPrompt = `Here are planning responses from multiple AI models on the topic: "${PLAN.topic}"\n\n${allPlans}\n\nProvide a concise synthesis:\n1. **What all AIs agreed on** — common recommendations\n2. **Where they differed** — key disagreements or unique angles\n3. **Recommended approach** — the best path forward combining their insights\n\nBe concise and actionable.`;

  try {
    addBubble(sk, 'user', '✦ Synthesizing all plans...');
    const tid = addTyping(sk);
    S.loading[sk] = true; setSend(sk, true);

    let reply;
    if (DEMO_MODE) {
      await new Promise(r => setTimeout(r, 1200));
      reply = '**All AIs agreed:** Start with a clear value proposition and social proof. Mobile-first design. Fast page load.\n\n**Where they differed:** ChatGPT emphasized structure/flow; Claude focused on UX polish; Gemini prioritized technical SEO.\n\n**Recommended approach:** Follow ChatGPT\'s structure, apply Claude\'s UX polish, implement Gemini\'s SEO recommendations from day one. These are complementary, not competing.';
    } else if (sk === 'ollama') {
      reply = await AIS.ollama.call(null, [{ role: 'user', content: metaPrompt }], null, S.ollamaModel);
    } else {
      reply = await AIS[sk].call(S.apiKeys[sk], [{ role: 'user', content: metaPrompt }], null);
    }

    removeEl(tid);
    S.histories[sk].push({ role: 'assistant', content: reply });
    addBubble(sk, 'assistant', reply);
  } catch (err) {
    showToast('Synthesis failed: ' + err.message);
  } finally {
    S.loading[sk] = false; setSend(sk, false);
  }
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

function renderPromptItem(container, p, { canDelete, index, isCommunity } = {}) {
  const item = document.createElement('div');
  item.className = 'prompt-item';
  const textDiv = document.createElement('div');
  textDiv.className = 'prompt-item-text';
  if (isCommunity && p.tags?.length) {
    const tagsHtml = p.tags.map(t => `<span class="prompt-tag">${t}</span>`).join('');
    textDiv.innerHTML = `<div class="prompt-item-name">${p.name} ${tagsHtml}</div><div class="prompt-item-preview">${p.text.slice(0, 80)}${p.text.length > 80 ? '…' : ''}</div>`;
  } else {
    textDiv.innerHTML = `<div class="prompt-item-name">${p.name}</div><div class="prompt-item-preview">${p.text.slice(0, 80)}${p.text.length > 80 ? '…' : ''}</div>`;
  }
  const acts = document.createElement('div');
  acts.className = 'prompt-item-acts';
  const useBtn = document.createElement('button');
  useBtn.className = 'prompt-use'; useBtn.textContent = 'Use';
  useBtn.addEventListener('click', e => {
    e.stopPropagation();
    // Fill active panel textarea if possible, otherwise broadcast
    const activeKey = S.activeTab;
    const ta = activeKey ? document.getElementById('ct-' + activeKey) : null;
    if (ta && ta.offsetParent !== null) {
      ta.value = p.text; ta.focus();
      ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
    } else {
      document.getElementById('broadcastInput').value = p.text;
    }
    showToast(`"${p.name}" loaded`);
  });
  acts.appendChild(useBtn);
  if (canDelete) {
    const del = document.createElement('button');
    del.className = 'prompt-del'; del.textContent = '✕';
    del.addEventListener('click', e => {
      e.stopPropagation();
      S_prompts.splice(index, 1);
      savePrompts(); renderPrompts();
    });
    acts.appendChild(del);
  }
  item.appendChild(textDiv); item.appendChild(acts);
  container.appendChild(item);
}

function renderPrompts(filter) {
  const list = document.getElementById('promptList');
  const communityList = document.getElementById('communityPromptList');
  const q = (filter || '').toLowerCase();
  list.innerHTML = '';
  const myFiltered = S_prompts.filter(p => !q || p.name.toLowerCase().includes(q) || p.text.toLowerCase().includes(q));
  if (!myFiltered.length) {
    list.innerHTML = '<p class="prompt-empty">No prompts saved. Type in the broadcast bar and click "+ save broadcast".</p>';
  } else {
    myFiltered.forEach((p, i) => renderPromptItem(list, p, { canDelete: true, index: S_prompts.indexOf(p) }));
  }
  if (communityList) {
    communityList.innerHTML = '';
    const commFiltered = COMMUNITY_PROMPTS.filter(p => !q || p.name.toLowerCase().includes(q) || p.text.toLowerCase().includes(q) || p.tags?.some(t => t.includes(q)));
    commFiltered.forEach(p => renderPromptItem(communityList, p, { isCommunity: true }));
  }
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

  document.getElementById('promptSearchInput')?.addEventListener('input', e => {
    renderPrompts(e.target.value);
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

function buildExportMarkdown() {
  const now      = new Date();
  const dateTime = now.toLocaleString();
  let md = `# AI Hub Session Export\nDate: ${dateTime}\n\n`;
  if (S.memory.trim()) md += `## Memory Context\n${S.memory.trim()}\n\n`;
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
  md += `---\n*Exported from [AI Hub](https://aihubdash.com) — Multi-AI dashboard for developers*`;
  return md;
}

function exportSession() {
  const dateStr = new Date().toISOString().slice(0, 10);
  const md = buildExportMarkdown();
  const blob = new Blob([md], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `aihub-export-${dateStr}.md`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast('Session exported ✓');
}

function exportSessionJSON() {
  const dateStr = new Date().toISOString().slice(0, 10);
  const data = {
    exported_from: 'AI Hub (aihubdash.com)',
    export_date: new Date().toISOString(),
    memory: S.memory,
    conversations: {}
  };
  ALL_KEYS.forEach(key => {
    const hist = S.histories[key];
    if (hist && hist.length) {
      const name = key === 'ollama' ? `Ollama (${S.ollamaModel})` : AIS[key].name;
      data.conversations[name] = hist;
    }
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `aihub-export-${dateStr}.json`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast('JSON exported ✓');
}

async function copySessionToClipboard() {
  const text = buildExportMarkdown();
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!');
  } catch (_) {
    showToast('Copy failed — try exporting instead');
  }
}

// ── Share ─────────────────────────────────────────────────────────────────────

async function shareSession() {
  const data = { memory: S.memory, conversations: {} };
  ALL_KEYS.forEach(key => {
    const hist = S.histories[key];
    if (hist && hist.length) {
      const name = key === 'ollama' ? `Ollama (${S.ollamaModel})` : AIS[key].name;
      data.conversations[name] = hist;
    }
  });
  const json = JSON.stringify(data);
  let compressed;
  try {
    compressed = LZString.compressToEncodedURIComponent(json);
  } catch (_) {
    showToast('Share failed — lz-string not loaded');
    return;
  }
  if (compressed.length > 8000) {
    showToast('Session too long to share via link. Try exporting as markdown instead.');
    return;
  }
  const url = `${location.origin}/dashboard/#shared=${compressed}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast('Share link copied!');
  } catch (_) {
    // Fallback: show URL in a prompt
    prompt('Copy this share link:', url);
  }
}

function loadSharedSession() {
  const hash = location.hash;
  if (!hash.startsWith('#shared=')) return false;
  const compressed = hash.slice('#shared='.length);
  let data;
  try {
    const json = LZString.decompressFromEncodedURIComponent(compressed);
    data = JSON.parse(json);
  } catch (_) {
    return false;
  }
  if (!data || !data.conversations) return false;

  // Enter read-only shared mode
  DEMO_MODE = true; // Disable sending
  CLOUD_KEYS.forEach(key => {
    S.modes[key] = 'api';
    S.apiKeys[key] = 'shared-placeholder';
    S.histories[key] = [];
    S.loading[key] = false; S.unread[key] = 0;
  });
  S.memory = data.memory || '';

  // Restore histories from shared data
  Object.entries(data.conversations).forEach(([name, hist]) => {
    const key = Object.entries(AIS).find(([k, v]) => v.name === name || `Ollama (${S.ollamaModel})` === name)?.[0];
    if (key) S.histories[key] = hist;
  });

  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = 'flex';
  document.getElementById('sharedBanner').style.display = 'flex';

  S.activeTab = visibleKeys()[0] || null;
  buildPanels(); bindMain(); setView(S.view);

  // Hide all input areas in read-only mode
  document.querySelectorAll('.chat-input-row').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.chat-textarea').forEach(el => el.disabled = true);
  document.getElementById('broadcastInput').disabled = true;
  document.getElementById('broadcastBtn').style.display = 'none';
  document.getElementById('shareBtn').style.display = 'none';

  return true;
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
  bindPlanMode();
  bindDrawers();
  bindTemplates();
  bindPromptLibrary();
  loadPrompts();
  bindKeyboardShortcuts();
  bindWorkflows();
  bindAnalytics();
  bindSearch();
  bindPinnedDrawer();
  initSyncChannel();
  checkOnboarding();
  // Export dropdown
  const exportBtn      = document.getElementById('exportBtn');
  const exportDropdown = document.getElementById('exportDropdown');
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = exportDropdown.style.display !== 'none';
    exportDropdown.style.display = open ? 'none' : 'block';
  });
  document.addEventListener('click', () => { exportDropdown.style.display = 'none'; });
  exportDropdown.addEventListener('click', e => e.stopPropagation());
  document.getElementById('exportMdBtn').addEventListener('click',   () => { exportDropdown.style.display='none'; exportSession(); });
  document.getElementById('exportJsonBtn').addEventListener('click', () => { exportDropdown.style.display='none'; exportSessionJSON(); });
  document.getElementById('exportCopyBtn').addEventListener('click', () => { exportDropdown.style.display='none'; copySessionToClipboard(); });
  document.getElementById('conflictDismiss').addEventListener('click', () => {
    document.getElementById('conflictBanner').style.display = 'none';
  });
  document.getElementById('settingsBtn').addEventListener('click', goToSettings);
  document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);
  document.getElementById('shareBtn')?.addEventListener('click', shareSession);
  document.getElementById('shortcutsBtn').addEventListener('click', () => {
    document.getElementById('shortcutsModal').style.display = 'flex';
  });
  document.getElementById('compareBtn')?.addEventListener('click', openCompareModal);
  document.getElementById('compareClose')?.addEventListener('click', () => {
    document.getElementById('compareModal').style.display = 'none';
  });
  document.getElementById('compareToPadBtn')?.addEventListener('click', compareResponsesToPad);
  document.getElementById('compareModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('compareModal')) {
      document.getElementById('compareModal').style.display = 'none';
    }
  });
}

function openCompareModal() {
  const grid = document.getElementById('compareGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const entries = Object.entries(lastBroadcastResponses);
  const allTexts = entries.map(([, t]) => t);

  entries.forEach(([key, text]) => {
    const ai = AIS[key] || {};
    const color = ai.color || '#888';
    const name = ai.name || key;
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    const others = allTexts.filter(t => t !== text);
    const rendered = sentences.map(s => {
      const snippet = s.slice(0, 30);
      const isUnique = !others.some(o => o.includes(snippet));
      return isUnique ? `<mark class="diff-unique">${escapeHtml(s)}</mark>` : escapeHtml(s);
    }).join(' ');

    const col = document.createElement('div');
    col.className = 'compare-col';
    col.innerHTML = `
      <div class="compare-col-header" style="color:${color}">${escapeHtml(name)}</div>
      <div class="compare-col-body">${rendered}</div>`;
    grid.appendChild(col);
  });

  document.getElementById('compareModal').style.display = 'flex';
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function compareResponsesToPad() {
  const pad = document.getElementById('padText');
  if (!pad) return;
  const formatted = Object.entries(lastBroadcastResponses)
    .map(([k, v]) => `[${AIS[k]?.name || k}]\n${v}`)
    .join('\n\n---\n\n');
  pad.value += (pad.value ? '\n\n' : '') + '=== Response Comparison ===\n\n' + formatted;
  document.getElementById('padDrawer').style.display = 'flex';
  document.getElementById('compareModal').style.display = 'none';
  showToast('Responses sent to pad');
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
      const searchOverlay = document.getElementById('searchOverlay');
      if (searchOverlay && searchOverlay.style.display !== 'none') { searchOverlay.style.display = 'none'; return; }
      const analyticsModal = document.getElementById('analyticsModal');
      if (analyticsModal && analyticsModal.style.display !== 'none') { analyticsModal.style.display = 'none'; return; }
      if (modal && modal.style.display !== 'none') { modal.style.display = 'none'; return; }
      document.getElementById('exportDropdown').style.display = 'none';
      ['memDrawer','padDrawer','tplPanel','debateBar','brainstormBar','planBar','planSynthesisBar','promptsDrawer','workflowsDrawer','pinnedDrawer'].forEach(id => {
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

    // 1, 2, 3, 4 — switch view (with or without Ctrl/Cmd)
    if (['1','2','3','4'].includes(e.key) && (e.ctrlKey || e.metaKey)) { setView(parseInt(e.key)); e.preventDefault(); return; }
    if (['1','2','3','4'].includes(e.key)) { setView(parseInt(e.key)); }

    // Ctrl+Enter — send from active panel (or broadcast if broadcast is focused)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      const focused = document.activeElement;
      if (focused && focused.id && focused.id.startsWith('ct-')) {
        // A panel textarea is focused — send that panel
        const pKey = focused.id.replace('ct-', '');
        if (pKey) { e.preventDefault(); send(pKey); return; }
      }
      // Otherwise send the active panel
      if (S.activeTab) { e.preventDefault(); send(S.activeTab); return; }
    }

    // Ctrl+F — search conversations
    if (e.key === 'f' && (e.ctrlKey || e.metaKey)) { openSearch(); e.preventDefault(); return; }

    // Ctrl+E — export session
    if (e.key === 'e' && (e.ctrlKey || e.metaKey)) { exportSession?.(); e.preventDefault(); }

    // Ctrl+Shift+C — copy full conversation
    if (e.key === 'C' && (e.ctrlKey || e.metaKey) && e.shiftKey) { copySessionToClipboard?.(); e.preventDefault(); }
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

// ── Session title ─────────────────────────────────────────────────────────────

async function generateSessionTitle() {
  const sk = sendableKeys()[0];
  if (!sk) return;
  const samples = sendableKeys().filter(k => S.histories[k]?.length >= 2).map(k => S.histories[k][0].content).slice(0, 2).join(' / ');
  const prompt = `Based on this conversation topic: "${samples.slice(0, 200)}" Give a 3-5 word title for this session. Respond with ONLY the title, nothing else.`;
  try {
    let title;
    if (sk === 'ollama') {
      title = await AIS.ollama.call(null, [{role:'user', content: prompt}], null, S.ollamaModel);
    } else {
      title = await AIS[sk].call(S.apiKeys[sk], [{role:'user', content: prompt}], null);
    }
    if (title && title.length < 60) {
      S.sessionTitle = title.trim();
      document.title = S.sessionTitle + ' · AI Hub';
      const logoEl = document.querySelector('.logo');
      if (logoEl) { logoEl.title = S.sessionTitle; }
      showToast('Session: ' + S.sessionTitle);
    }
  } catch (_) {}
}

// ── Template Params ───────────────────────────────────────────────────────────

const TEMPLATE_CONFIGS = {
  'architecture-review': {
    systemPrompt: 'You are a senior software architect. Review the described system design and provide: 1) Key strengths, 2) Potential risks or weaknesses, 3) Specific, actionable recommendations for improvement. Be direct and technical.',
    initialMessage: 'Please review this architecture and share your perspective:',
  },
  'code-review': {
    systemPrompt: 'You are a senior software engineer doing a thorough code review. Check for: bugs, security vulnerabilities, performance issues, readability, and adherence to best practices. Be specific — point to exact problems and suggest fixes.',
    initialMessage: 'Please review this code:',
  },
  'framework-debate': {
    systemPrompt: 'You are a pragmatic engineering leader. When presented with a technology decision, argue for the option you genuinely believe is best for the described use case. Be opinionated, cite tradeoffs, and make a clear recommendation.',
    initialMessage: 'Help me decide: which framework or technology should I use for this use case?',
  },
  'product-strategy': {
    systemPrompt: 'You are a product strategist with experience across multiple successful products. Provide honest, critical feedback on product direction. Challenge assumptions. Identify risks the user may not have considered.',
    initialMessage: 'What do you think of this product direction?',
  },
  'startup-validator': {
    systemPrompt: "You are a skeptical but constructive investor reviewing startup ideas. Play devil's advocate — find the weaknesses, challenge assumptions, identify the hardest problems. End with what would need to be true for this to work.",
    initialMessage: "Here's my startup idea — stress-test it:",
  },
  'content-writer': {
    systemPrompt: 'You are a skilled content writer. Write clearly, engagingly, and in a voice that fits the described audience. When given a topic or brief, produce a complete draft — not an outline.',
    initialMessage: 'Please write content about:',
  },
  'interview-prep': {
    systemPrompt: 'You are a tough but fair interviewer. Ask challenging questions relevant to the role described. After the user answers, give specific, constructive feedback on their response.',
    initialMessage: 'I am preparing for an interview. Please ask me questions for this role:',
  },
  'learning-plan': {
    systemPrompt: 'You are an experienced educator and learning coach. When given a topic and skill level, create a structured, realistic learning plan with resources, milestones, and practice exercises.',
    initialMessage: 'Create a learning plan for me to master:',
  },
};

function applyTemplateParam() {
  const params = new URLSearchParams(location.search);
  const tpl = params.get('template');
  if (!tpl || !TEMPLATE_CONFIGS[tpl]) return;
  const config = TEMPLATE_CONFIGS[tpl];

  // Set system prompt as memory for all panels
  if (config.systemPrompt) {
    S.memory = config.systemPrompt;
    const mt = document.getElementById('memText');
    if (mt) mt.value = S.memory;
  }

  // Pre-fill broadcast input with initial message
  if (config.initialMessage) {
    const bi = document.getElementById('broadcastInput');
    if (bi) { bi.value = config.initialMessage; bi.focus(); }
  }
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = theme === 'light' ? '☾' : '☀';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('aihub_theme', next); } catch (_) {}
  applyTheme(next);
}

function initTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem('aihub_theme') || 'dark'; } catch (_) {}
  applyTheme(saved);
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  if (window.innerWidth <= 768) S.view = 1;
  // Check for shared session in URL hash
  if (location.hash.startsWith('#shared=')) {
    if (loadSharedSession()) return;
  }
  const d = store.get(['view', 'modes', 'memLabel', 'ollamaOn', 'ollamaModel']);
  if (d.view && window.innerWidth > 768) S.view = d.view;
  buildSetup({ modes: d.modes, memoryLabel: d.memLabel, ollamaOn: d.ollamaOn, ollamaModel: d.ollamaModel });
  detectOllamaOnLoad(d.ollamaOn);
});

// ── Ollama Auto-Detection ──────────────────────────────────────────────────────

async function detectOllamaOnLoad(alreadyOn) {
  // Don't nag if Ollama is already enabled
  if (alreadyOn) return;
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return;
    // Ollama is running — show the banner
    const banner = document.getElementById('ollamaDetectBanner');
    if (banner) banner.style.display = 'flex';

    document.getElementById('ollamaDetectConnectBtn').addEventListener('click', () => {
      banner.style.display = 'none';
      // Enable Ollama in the setup form
      S.ollamaOn = true; S.modes.ollama = 'api';
      document.querySelectorAll('[data-olmode]').forEach(b => {
        b.classList.toggle('active', b.dataset.olmode === 'on');
      });
      document.getElementById('ollamaKeyRow').style.opacity = '1';
      // Scroll to Ollama section
      document.getElementById('ollamaSetup')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    document.getElementById('ollamaDetectDismiss').addEventListener('click', () => {
      banner.style.display = 'none';
    });
  } catch (_) {
    // Ollama not running — do nothing silently
  }
}

// ── Analytics ─────────────────────────────────────────────────────────────────

const COST_TABLE = {
  chatgpt: { input: 0.03/1000, output: 0.06/1000 },
  claude:  { input: 0.015/1000, output: 0.075/1000 },
  gemini:  { input: 0.0005/1000, output: 0.0005/1000 },
  grok:    { input: 0.03/1000, output: 0.06/1000 },
  ollama:  { input: 0, output: 0 },
};

function trackStats(key, elapsedMs, reply) {
  if (!sessionStats.messages[key]) sessionStats.messages[key] = 0;
  sessionStats.messages[key]++;
  if (!sessionStats.responseTimes[key]) sessionStats.responseTimes[key] = [];
  sessionStats.responseTimes[key].push(elapsedMs);
  const words = reply.split(/\s+/).filter(Boolean).length;
  const chars = reply.length;
  if (!sessionStats.wordCounts[key]) sessionStats.wordCounts[key] = 0;
  sessionStats.wordCounts[key] += words;
  if (!sessionStats.charCounts[key]) sessionStats.charCounts[key] = 0;
  sessionStats.charCounts[key] += chars;
  // Cumulative
  if (!cumulativeStats[key]) cumulativeStats[key] = { messages: 0, words: 0, chars: 0 };
  cumulativeStats[key].messages++;
  cumulativeStats[key].words = (cumulativeStats[key].words || 0) + words;
  cumulativeStats[key].chars = (cumulativeStats[key].chars || 0) + chars;
  try { localStorage.setItem('aihub_stats', JSON.stringify(cumulativeStats)); } catch(_) {}
}

function bindAnalytics() {
  document.getElementById('analyticsBtn')?.addEventListener('click', () => {
    document.getElementById('analyticsModal').style.display = 'flex';
    renderAnalytics();
  });
  document.getElementById('analyticsClose')?.addEventListener('click', () => {
    document.getElementById('analyticsModal').style.display = 'none';
  });
  document.getElementById('analyticsModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('analyticsModal')) {
      document.getElementById('analyticsModal').style.display = 'none';
    }
  });
}

function renderAnalytics() {
  const el = document.getElementById('analyticsContent');
  if (!el) return;

  const elapsed = Date.now() - SESSION_START;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);
  const totalMsgs = Object.values(sessionStats.messages).reduce((a,b)=>a+b,0);
  const entries = Object.entries(sessionStats.messages);
  const mostActive = entries.length ? entries.sort((a,b)=>b[1]-a[1])[0] : null;

  const maxMsgs = Math.max(...Object.values(sessionStats.messages), 1);

  let rows = '';
  ALL_KEYS.forEach(key => {
    if (S.modes[key] === 'off') return;
    const ai = AIS[key];
    const msgs = sessionStats.messages[key] || 0;
    const times = sessionStats.responseTimes[key] || [];
    const avgTime = times.length ? (times.reduce((a,b)=>a+b,0)/times.length/1000).toFixed(1) : '—';
    const words = sessionStats.wordCounts[key] || 0;
    const chars = sessionStats.charCounts[key] || 0;
    const cost = COST_TABLE[key] || COST_TABLE.chatgpt;
    const inputTokens = (S.histories[key] || []).filter(m=>m.role==='user').reduce((a,m)=>a+m.content.length/4,0);
    const outputTokens = chars / 4;
    const estimatedCost = key === 'ollama' ? '0.0000' : (inputTokens*cost.input + outputTokens*cost.output).toFixed(4);
    const barPct = Math.round((msgs / maxMsgs) * 100);
    rows += `<div class="analytics-model-row">
      <div class="analytics-model-name" style="color:${ai.color}">${ai.name}</div>
      <div class="analytics-bar-wrap"><div class="analytics-bar" style="width:${barPct}%;background:${ai.color}"></div></div>
      <div class="analytics-model-stats">
        <span>${msgs} msg</span>
        <span>${avgTime}s avg</span>
        <span>${words} words</span>
        <span class="analytics-cost">~$${estimatedCost}</span>
      </div>
    </div>`;
  });

  const totalCost = ALL_KEYS.reduce((total, key) => {
    if (S.modes[key]==='off') return total;
    const chars = sessionStats.charCounts[key] || 0;
    const cost = COST_TABLE[key] || COST_TABLE.chatgpt;
    if (key === 'ollama') return total;
    const inputTokens = (S.histories[key]||[]).filter(m=>m.role==='user').reduce((a,m)=>a+m.content.length/4,0);
    return total + (inputTokens*cost.input + (chars/4)*cost.output);
  }, 0);

  el.innerHTML = `
    <div class="analytics-session">
      <div class="analytics-stat-box">
        <div class="analytics-stat-val">${mins}m ${secs}s</div>
        <div class="analytics-stat-lbl">duration</div>
      </div>
      <div class="analytics-stat-box">
        <div class="analytics-stat-val">${totalMsgs}</div>
        <div class="analytics-stat-lbl">messages</div>
      </div>
      <div class="analytics-stat-box">
        <div class="analytics-stat-val">${mostActive ? AIS[mostActive[0]]?.name : '—'}</div>
        <div class="analytics-stat-lbl">most active</div>
      </div>
    </div>
    <div class="analytics-section-title">Per-model · this session</div>
    <div class="analytics-models">${rows || '<p style="font-size:12px;color:#444;text-align:center;padding:16px 0">No messages yet</p>'}</div>
    <div class="analytics-total-cost"><span>Estimated session cost</span><strong>~$${totalCost.toFixed(4)}</strong></div>
    <div class="analytics-reset-row"><button class="analytics-reset-btn" id="analyticsResetBtn">Reset cumulative stats</button></div>`;

  document.getElementById('analyticsResetBtn')?.addEventListener('click', () => {
    cumulativeStats = {};
    try { localStorage.removeItem('aihub_stats'); } catch(_) {}
    showToast('Stats reset');
    renderAnalytics();
  });
}

// ── Cross-Tab Sync (BroadcastChannel) ────────────────────────────────────────

let syncChannel = null;
let connectedTabs = 0;
const MY_TAB_ID = Math.random().toString(36).slice(2);

function initSyncChannel() {
  if (!('BroadcastChannel' in window)) return;
  syncChannel = new BroadcastChannel('aihub-sync');
  syncChannel.postMessage({ type: 'tab-open', from: MY_TAB_ID });

  syncChannel.addEventListener('message', e => {
    const { type, from, key, role, text } = e.data;
    if (!from || from === MY_TAB_ID) return; // ignore own messages

    if (type === 'tab-open') {
      connectedTabs = Math.max(1, connectedTabs + 1);
      syncChannel.postMessage({ type: 'tab-announce', from: MY_TAB_ID });
      updateTabIndicator();
    } else if (type === 'tab-announce') {
      connectedTabs = Math.max(1, connectedTabs + 1);
      updateTabIndicator();
    } else if (type === 'tab-close') {
      connectedTabs = Math.max(0, connectedTabs - 1);
      updateTabIndicator();
    } else if (type === 'msg') {
      // Show synced message in our panels
      const mainVisible = document.getElementById('mainScreen')?.style.display !== 'none';
      if (mainVisible && S.modes[key] !== 'off' && S.modes[key] !== 'native') {
        document.getElementById('es-' + key)?.remove();
        addBubble(key, role, text);
      }
    }
  });

  window.addEventListener('beforeunload', () => {
    syncChannel?.postMessage({ type: 'tab-close', from: MY_TAB_ID });
  });
}

function broadcastToTabs(msg) {
  syncChannel?.postMessage({ ...msg, from: MY_TAB_ID });
}

function updateTabIndicator() {
  const indicator = document.getElementById('tabSyncIndicator');
  if (!indicator) return;
  if (connectedTabs > 0) {
    indicator.textContent = `${connectedTabs + 1} tabs`;
    indicator.style.display = 'inline-block';
  } else {
    indicator.style.display = 'none';
  }
}

// ── Conversation Search ───────────────────────────────────────────────────────

function openSearch() {
  const overlay = document.getElementById('searchOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  const input = document.getElementById('searchInput');
  if (input) { input.value = ''; input.focus(); }
  document.getElementById('searchResults').innerHTML = '';
}

function bindSearch() {
  document.getElementById('searchBtn')?.addEventListener('click', openSearch);
  document.getElementById('searchOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('searchOverlay')) {
      document.getElementById('searchOverlay').style.display = 'none';
    }
  });
  const input = document.getElementById('searchInput');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { document.getElementById('searchOverlay').style.display = 'none'; }
    });
    input.addEventListener('input', () => runSearch(input.value));
  }
}

function runSearch(query) {
  const container = document.getElementById('searchResults');
  if (!container) return;
  const q = query.trim().toLowerCase();
  if (!q) { container.innerHTML = ''; return; }

  const results = [];
  ALL_KEYS.forEach(key => {
    if (S.modes[key] === 'off') return;
    const ai = AIS[key];
    (S.histories[key] || []).forEach((msg, idx) => {
      const content = msg.content || '';
      if (content.toLowerCase().includes(q)) {
        results.push({ key, ai, role: msg.role, content, idx });
      }
    });
  });

  if (!results.length) {
    container.innerHTML = '<div class="search-no-results">No results found</div>';
    return;
  }

  container.innerHTML = '';
  results.slice(0, 40).forEach(r => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    const lo = r.content.toLowerCase().indexOf(q);
    const start = Math.max(0, lo - 40);
    const end = Math.min(r.content.length, lo + q.length + 60);
    const snippet = (start > 0 ? '…' : '') + r.content.slice(start, end) + (end < r.content.length ? '…' : '');
    const escaped = snippet.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const highlighted = escaped.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi'), m => `<mark>${m}</mark>`);
    item.innerHTML = `<div class="search-result-panel" style="color:${r.ai.color}">${r.ai.name} · ${r.role}</div><div class="search-result-text">${highlighted}</div>`;
    item.addEventListener('click', () => {
      document.getElementById('searchOverlay').style.display = 'none';
      scrollToMessage(r.key, r.idx);
    });
    container.appendChild(item);
  });
}

function scrollToMessage(key, msgIndex) {
  // Make panel visible first
  if (S.modes[key] === 'off') return;
  const panel = document.getElementById('p-' + key);
  if (!panel) return;
  if (panel.classList.contains('hidden')) {
    S.activeTab = key;
    setView(S.view);
  }
  // Find the nth message in the chat
  const cm = document.getElementById('cm-' + key);
  if (!cm) return;
  const msgs = cm.querySelectorAll('.msg');
  const target = msgs[msgIndex];
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.style.outline = '1px solid var(--accent)';
    setTimeout(() => { target.style.outline = ''; }, 1800);
  }
}

// ── Conversation Branching ────────────────────────────────────────────────────

function createBranch(key, msgIndex) {
  if (!S.branches[key]) S.branches[key] = [];
  if (!S.activeBranch[key]) S.activeBranch[key] = -1;

  // Save current state as a branch
  const branchCount = S.branches[key].length;
  const branchName = `Branch ${branchCount + 1}`;

  // Save full current history as a branch
  S.branches[key].push({
    id: Date.now().toString(36),
    name: branchName,
    messages: S.histories[key].slice(),
    fromIndex: msgIndex,
    createdAt: Date.now()
  });

  // If this is the first branch, also save the current state as "Main"
  if (branchCount === 0) {
    S.branches[key].unshift({
      id: 'main',
      name: 'Main',
      messages: S.histories[key].slice(),
      fromIndex: -1,
      createdAt: Date.now()
    });
  }

  // Truncate history to the branch point (keep messages 0..msgIndex)
  S.histories[key] = S.histories[key].slice(0, msgIndex + 1);
  S.activeBranch[key] = S.branches[key].length - 1;

  // Re-render the chat panel
  rebuildChatFromHistory(key);
  renderBranchSelector(key);
  showToast(`${branchName} created — ask a different follow-up`);
}

function rebuildChatFromHistory(key) {
  const cm = document.getElementById('cm-' + key);
  if (!cm) return;
  cm.innerHTML = '';
  const hist = S.histories[key];
  if (!hist.length) {
    const ai = AIS[key];
    cm.innerHTML = `<div class="empty-state" id="es-${key}"><span class="en">${ai.name}</span><span class="eh">branched — ask a follow-up</span></div>`;
    return;
  }
  hist.forEach(msg => {
    addBubble(key, msg.role, msg.content);
  });
}

function renderBranchSelector(key) {
  if (!S.branches[key] || !S.branches[key].length) return;
  const panel = document.getElementById('p-' + key);
  if (!panel) return;

  let selector = document.getElementById('branch-selector-' + key);
  if (!selector) {
    selector = document.createElement('div');
    selector.className = 'branch-selector';
    selector.id = 'branch-selector-' + key;
    const ph = document.getElementById('ph-' + key);
    if (ph) ph.after(selector);
  }

  selector.innerHTML = `<span class="branch-selector-label">branches</span>`;
  S.branches[key].forEach((branch, i) => {
    const pill = document.createElement('button');
    pill.className = 'branch-pill' + (i === S.activeBranch[key] ? ' active' : '');
    pill.textContent = branch.name;
    pill.addEventListener('click', () => switchBranch(key, i));
    selector.appendChild(pill);
  });
}

function switchBranch(key, branchIndex) {
  if (!S.branches[key] || !S.branches[key][branchIndex]) return;
  S.activeBranch[key] = branchIndex;
  S.histories[key] = S.branches[key][branchIndex].messages.slice();
  rebuildChatFromHistory(key);
  renderBranchSelector(key);
  showToast(`Switched to ${S.branches[key][branchIndex].name}`);
}

// ── Global Pinned Drawer ──────────────────────────────────────────────────────

function bindPinnedDrawer() {
  document.getElementById('pinnedBtn')?.addEventListener('click', () => {
    const drawer = document.getElementById('pinnedDrawer');
    if (!drawer) return;
    ['memDrawer','padDrawer','promptsDrawer','workflowsDrawer'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });
    const open = drawer.style.display !== 'none';
    drawer.style.display = open ? 'none' : 'flex';
    if (!open) { drawer.style.flexDirection = 'column'; renderGlobalPinned(); }
  });
  document.getElementById('closePinnedBtn')?.addEventListener('click', () => {
    document.getElementById('pinnedDrawer').style.display = 'none';
  });
  document.getElementById('exportPinsBtn')?.addEventListener('click', exportPinsAsMarkdown);
}

function renderGlobalPinned() {
  const list = document.getElementById('pinnedGlobalList');
  if (!list) return;
  list.innerHTML = '';

  const allPins = [];
  ALL_KEYS.forEach(key => {
    (pinnedMessages[key] || []).forEach(pin => {
      allPins.push({ ...pin, key });
    });
  });

  allPins.sort((a,b) => (b.ts||0) - (a.ts||0));

  if (!allPins.length) {
    list.innerHTML = '<div class="pinned-empty">No pinned messages yet. Click 📌 on any AI response.</div>';
    return;
  }

  allPins.forEach((pin, globalIdx) => {
    const ai = AIS[pin.key];
    const item = document.createElement('div');
    item.className = 'pinned-global-item';
    const ts = pin.ts ? new Date(pin.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
    item.innerHTML = `
      <div class="pinned-global-meta">
        <span class="pinned-global-panel" style="color:${ai?.color||'#888'}">${ai?.name || pin.key}</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="pinned-global-time">${ts}</span>
          <button class="pinned-global-unpin" data-key="${pin.key}" data-idx="${globalIdx}">✕</button>
        </div>
      </div>
      <div class="pinned-global-text">${(pin.text||'').slice(0,200)}${pin.text&&pin.text.length>200?'…':''}</div>`;
    item.querySelector('.pinned-global-unpin').addEventListener('click', e => {
      const k = e.target.dataset.key;
      const text = pin.text;
      if (pinnedMessages[k]) {
        const idx = pinnedMessages[k].findIndex(p => p.text === text);
        if (idx >= 0) { pinnedMessages[k].splice(idx, 1); savePins(); }
      }
      renderGlobalPinned();
    });
    list.appendChild(item);
  });
}

function exportPinsAsMarkdown() {
  const allPins = [];
  ALL_KEYS.forEach(key => {
    (pinnedMessages[key] || []).forEach(pin => {
      allPins.push({ ...pin, key, aiName: AIS[key]?.name || key });
    });
  });
  if (!allPins.length) { showToast('No pinned messages to export'); return; }

  let md = `# AI Hub — Pinned Messages\nExported: ${new Date().toLocaleString()}\n\n`;
  allPins.forEach(pin => {
    const ts = pin.ts ? new Date(pin.ts).toLocaleString() : '';
    md += `## [${pin.aiName}]${ts ? ` · ${ts}` : ''}\n\n${pin.text}\n\n---\n\n`;
  });
  md += `*Exported from [AI Hub](https://aihubdash.com)*`;

  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `aihub-pins-${new Date().toISOString().slice(0,10)}.md`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast('Pins exported ✓');
}

// ── Onboarding ────────────────────────────────────────────────────────────────

function checkOnboarding() {
  try {
    const onboarded = localStorage.getItem('aihub_onboarded');
    if (onboarded) return;
  } catch(_) {}

  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) return;

  // Small delay so the UI settles first
  setTimeout(() => {
    overlay.style.display = 'flex';

    // Show Ollama hint if Ollama was detected
    if (document.getElementById('ollamaDetectBanner')?.style.display !== 'none') {
      document.getElementById('onboardingOllama').style.display = 'block';
    }
  }, 800);

  document.getElementById('onboardingGotIt')?.addEventListener('click', () => {
    const dontShow = document.getElementById('onboardingDontShow')?.checked;
    if (dontShow) {
      try { localStorage.setItem('aihub_onboarded', '1'); } catch(_) {}
    }
    overlay.style.display = 'none';
  });
}
