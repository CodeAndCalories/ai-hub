# AI Hub

Chat with ChatGPT, Claude, Gemini, Grok, and local Ollama
models side by side in one interface.

**Live:** https://aihubdash.com
**Dashboard:** https://aihubdash.com/dashboard/

## What it does

- **Broadcast** — send one message to every active AI at once
- **Debate mode** — AIs react to each other across rounds
- **Brainstorm mode** — structured multi-round ideation
- **Relay** — responses auto-shared as context between panels
- **Per-panel personas** — separate system prompt per AI
- **Ollama support** — run local models free alongside cloud ones
- **Persistent memory** — optional, via Memstore
- **Export** — save any session as markdown

## Getting started

No account, no signup. Open the dashboard and either:

1. Click **Try demo** to see it working with simulated responses, or
2. Add an API key. Gemini has a free tier with no credit card:
   https://aistudio.google.com/app/apikey

## Privacy

There is no server. API calls go directly from your browser
to each provider. Keys are held in browser storage only and
never transmitted anywhere else.

## Browser extension

Load unpacked from the /extension folder in Chrome or
Opera GX. Chrome Web Store listing pending.

## Structure

```
/            landing page
/dashboard   the web app
/extension   Chrome extension (manifest v3)
/blog        articles
/compare     comparison pages
```

Built with vanilla JS, HTML, and CSS. No build step,
no framework, no dependencies beyond marked.js and
DOMPurify loaded from CDN.
