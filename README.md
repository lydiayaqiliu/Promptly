# Promptly — AI Prompt Enhancer

A Chrome extension that intercepts your raw prompt before you send it, runs a quick personalization survey, then rewrites it into a high-quality, context-rich prompt tailored to you.

Works on **ChatGPT** and **Claude.ai**.

---

## How it works

1. Type your prompt in ChatGPT or Claude as usual.
2. Click the **Promptly** icon in your toolbar.
3. Answer 1–3 short rounds of multiple-choice questions (educational level, task type, references, etc.).
4. Promptly rewrites your prompt using your profile and injects it back into the chat.
5. Hit Send.

---

## Install (Chrome — no Web Store needed)

> Chrome Web Store submission is in review. In the meantime, install in 60 seconds via Developer Mode.

**Option A — Load from ZIP (easiest)**

1. Download **promptly.zip** from the [latest release](https://github.com/lydiayaqiliu/Promptly/releases/latest).
2. Unzip it anywhere on your computer.
3. Open Chrome → go to `chrome://extensions`
4. Toggle **Developer mode** on (top-right).
5. Click **Load unpacked** → select the unzipped folder.
6. The Promptly icon appears in your toolbar.

**Option B — Clone the repo**

```bash
git clone https://github.com/lydiayaqiliu/Promptly.git
cd Promptly
npm install
npm run build
```

Then follow steps 3–6 above, pointing "Load unpacked" at the cloned folder.

---

## Setup

1. Right-click the Promptly icon → **Options** (or click ⋮ → Options).
2. Paste your **Anthropic API key** (`sk-ant-...`).
3. Get a free key at [console.anthropic.com](https://console.anthropic.com).

---

## Tech

- Manifest V3 Chrome Extension
- Anthropic API — `claude-haiku-4-5` for evaluation & survey, `claude-sonnet-4-6` for enhancement
- Zero backend — all API calls go directly from your browser to Anthropic
