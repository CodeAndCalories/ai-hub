# AI Hub — Dashboard v5

A full-screen, self-hosted dashboard for ChatGPT, Claude, Gemini, Grok, and Ollama.

## How to use
1. Unzip and open `index.html` in any browser
2. Set each AI to API, Native, or Off — enter keys for API panels
3. Optional: enable Ollama for free local AI (no key needed)
4. Launch and start chatting

## Features
- 1/2/3/4 panel layouts with tab switching
- Broadcast: send one message to all panels at once
- Relay: auto-share all responses across panels after broadcast
- → all: share any single response to all other panels as context
- Memory system with templates and auto-summarize
- Scratchpad for comparing responses
- Ollama support (free, local, private)
- Native panel mode: opens your real logged-in account

## Hosting on GitHub Pages
1. Push this folder to a GitHub repo
2. Settings → Pages → deploy from main
3. Share the URL — each visitor uses their own keys

## Privacy
- API calls go directly from your browser to each AI provider
- Keys are session-only — never saved anywhere
- Memory saved to localStorage only if you click Save
- No server, no analytics, no tracking
