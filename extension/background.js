const AI_URLS = {
  chatgpt: 'https://chatgpt.com',
  claude:  'https://claude.ai',
  gemini:  'https://gemini.google.com',
  grok:    'https://grok.com'
};

async function focusOrOpenTab(aiKey) {
  const url = AI_URLS[aiKey];
  if (!url) return; // unknown key — never open an untargeted tab
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(t => t.url && t.url.startsWith(url));
  if (existing) {
    await chrome.windows.update(existing.windowId, { focused: true });
    await chrome.tabs.update(existing.id, { active: true });
  } else {
    await chrome.tabs.create({ url, active: true });
  }
}

async function getTabStatuses() {
  const tabs = await chrome.tabs.query({});
  const result = {};
  for (const [key, url] of Object.entries(AI_URLS)) {
    const tab = tabs.find(t => t.url && t.url.startsWith(url));
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
