const AI_URLS = {
  chatgpt: 'https://chatgpt.com',
  claude:  'https://claude.ai',
  gemini:  'https://gemini.google.com',
  grok:    'https://grok.com'
};

// Match patterns for the four AI sites — identical to host_permissions.
const AI_PATTERNS = Object.fromEntries(
  Object.entries(AI_URLS).map(([key, url]) => [key, url + '/*'])
);

// Queries only the AI sites we hold host permissions for, rather than
// enumerating every tab. This needs no "tabs" permission, and it matches by
// URL pattern instead of string prefix, so a lookalike host such as
// claude.ai.example.com can never be mistaken for the real site.
async function findAiTab(aiKey) {
  const pattern = AI_PATTERNS[aiKey];
  if (!pattern) return null;
  try {
    const tabs = await chrome.tabs.query({ url: pattern });
    return tabs[0] || null;
  } catch (_) {
    // Host access can be withheld at runtime ("on click" site access).
    // Treat that as "no tab found" and open a fresh one.
    return null;
  }
}

async function focusOrOpenTab(aiKey) {
  const url = AI_URLS[aiKey];
  if (!url) return; // unknown key — never open an untargeted tab
  const existing = await findAiTab(aiKey);
  if (existing) {
    await chrome.windows.update(existing.windowId, { focused: true });
    await chrome.tabs.update(existing.id, { active: true });
  } else {
    await chrome.tabs.create({ url, active: true });
  }
}

async function getTabStatuses() {
  const result = {};
  for (const key of Object.keys(AI_URLS)) {
    const tab = await findAiTab(key);
    result[key] = tab ? { open: true, tabId: tab.id } : { open: false };
  }
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from this extension's own pages.
  if (sender.id !== chrome.runtime.id) return;
  if (msg.action === 'focusTab') {
    focusOrOpenTab(msg.aiKey).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'getTabStatuses') {
    getTabStatuses().then(s => sendResponse(s));
    return true;
  }
});
