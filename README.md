# AI Hub
Chat with ChatGPT, Claude, Gemini, Grok, and local Ollama models — all at the same time.

## Live

- **Landing page:** https://aihubdash.com
- **Dashboard:** https://aihubdash.com/dashboard/

---

## For Acquirers

**Status:** Live in production at https://aihubdash.com (free, static, GitHub Pages). Working dashboard + Chrome extension + 13 SEO blog posts. Recommended bundle-sell with Memstore (memstore.dev). Treat as an SEO/content acquisition, not a tech acquisition.

### Quickstart (5 lines)
```bash
git clone https://github.com/CodeAndCalories/ai-hub.git && cd ai-hub
# No build step, no install. Just serve the static files:
python3 -m http.server 8000   # http://localhost:8000
# To load the Chrome extension:
#   chrome://extensions → Developer Mode → Load Unpacked → select ./extension
```

Deploy: This site is already deployed via GitHub Pages with `CNAME` set to `aihubdash.com`. Push to `main` and Pages auto-publishes. No build pipeline.

### Tech stack
- **Frontend:** Pure static HTML + CSS + vanilla JS — no framework, no build step, no `package.json`
- **Hosting:** GitHub Pages (free, serverless) — CNAME points to `aihubdash.com`
- **Extension:** Chrome / Opera GX (manifest v3, version 5.0.0) — same provider integrations as the web dashboard
- **AI integrations (direct browser calls):**
  - OpenAI (`gpt-4o`)
  - Anthropic (`claude-sonnet-4-20250514`)
  - Google (`gemini-2.0-flash`)
  - xAI (Grok)
  - Local Ollama (`localhost:11434`)
- **No backend.** No auth, no database, no analytics server, no API keys held server-side. All calls go browser → provider.

### What's working
- Multi-model dashboard with 1/2/3/4-panel side-by-side layouts
- Broadcast mode — one message → all models simultaneously
- Relay mode — cross-share each response as context to other panels
- Debate mode — multi-round AI-vs-AI with auto-generated summary
- Brainstorm mode — independent ideas → build → synthesize action plan
- Conflict detection — flags disagreement between broadcast responses
- Named memory contexts saved per browser + memory templates + auto-summarize
- Optional Memstore integration for cross-device persistent memory
- Prompt library with 5 pre-loaded example prompts
- Markdown export of full session
- Scratchpad for collecting fragments across panels
- Chrome / Opera GX extension (manifest v3) mirroring dashboard features
- 13 SEO blog posts, 3 comparison pages (vs TypingMind / ChatHub / OpenRouter), templates page
- DEMO_MODE fallback with canned responses (off by default)

### What's broken / incomplete (honest)
- **No direct monetization** on the dashboard itself — value capture relies on Memstore upsell
- Extension is **not in the Chrome Web Store** — currently load-unpacked from `/extension`. Buyer submits under their own developer account
- TASKS.md is stalled — treat as a stable, low-touch SEO asset, not an actively-developed product
- No backend = no real-usage analytics beyond GSC / GitHub Pages access logs
- Tech ceiling is low — multi-AI dashboards are reproducible in a weekend by a competent developer. **The moat is the domain + brand + content + SEO**, not the code

### Required env vars
**None.** This is a pure-client-side product. Users bring their own API keys, stored in `localStorage`. The buyer doesn't manage any secrets.

### File map — "Want to change X? Edit Y."

| Change | Edit |
|---|---|
| Landing page copy / hero | `index.html` |
| Landing page styles | `landing.css` |
| Dashboard logic / providers | `dashboard/dashboard.js` (≈3,140 lines) |
| Dashboard styles | `dashboard/dashboard.css` |
| Memstore integration on / off | `dashboard/memstore.js` (gut to remove the upsell entirely) |
| Add a blog post | `blog/*.html` + add card to `blog/index.html` + add URL to `sitemap.xml` |
| Comparison pages | `compare/typingmind.html`, `compare/chathub.html`, `compare/openrouter.html` |
| Extension behaviour | `extension/background.js`, `extension/popup.js`, `extension/content.js` |
| Extension version / permissions | `extension/manifest.json` |
| Custom domain | `CNAME` (currently `aihubdash.com`) |

### Demo screenshots
See `screenshots/screenshots-needed.md` for the shot list — capture before listing. The 4-panel side-by-side shot is the marquee.

### Domain & hosting status
- **Domain (`aihubdash.com`):** Transfers separately. Provide buyer with EPP/auth code on close.
- **Hosting:** GitHub Pages — free, serverless, zero ops. Transfers automatically when the repo is transferred to buyer's GitHub account; `CNAME` stays put.
- **Memstore integration:** Optional. If selling standalone, decide whether to leave integration pointing at memstore.dev (free promo for them) or strip it. If combo-selling with memstore, leave as-is.
- **Chrome extension:** Not in the Web Store. Buyer can submit `/extension` to their own developer account on the Chrome Web Store and Opera Add-Ons store.

### Bundle play
This product pairs with [Memstore / memstore.dev](https://memstore.dev) (paid memory API for AI agents). The dashboard already calls memstore.dev for optional persistent memory. Selling the two together creates a "free dashboard → paid memory" funnel. See `SELL_PREP.md` for combo pricing notes ($6k–$15k combined vs $1.5k–$5k standalone).

---

## What it is
- **Dashboard** — open source web app, works in any browser, no install required
- **Extension** — Chrome/Opera GX browser extension (load unpacked from /extension)

## Features

**Multi-model**
- Broadcast one message to all AIs simultaneously
- 1, 2, 3, or 4-panel side-by-side layouts
- Relay mode — cross-share every response as context to all other panels
- API mode (your key) or Native mode (your real logged-in account) per AI

**Structured thinking**
- ⚔ Debate mode — AIs react to each other across multiple rounds, with AI-generated summary
- 🧠 Brainstorm mode — independent ideas → build on others → synthesize into action plan
- ⚠ Conflict detection — automatically flags when broadcast responses disagree on key facts

**Memory**
- Named memory contexts saved per browser
- Memory templates + auto-summarize conversations
- Connect [Memstore](https://memstore.dev) for persistent memory across devices and sessions

**Productivity**
- Prompt library — save and reuse broadcast prompts, 5 example prompts pre-loaded
- Export — download full session as a formatted Markdown file
- Scratchpad — collect the best fragments from all panels

**Privacy**
- No server. No account. No tracking.
- API keys never leave your browser
- All calls go directly from your browser to each AI provider
- Open source — read every line of code

**Local models**
- Ollama support — run Llama3, Mistral, Phi3, and more completely free and private
- No API key needed for local models

## Extension
Load unpacked from the /extension folder in Chrome or Opera GX. Chrome Web Store submission coming soon.

## Privacy
All API calls go directly from your browser to each AI provider.
No server. No tracking. No data collection.
