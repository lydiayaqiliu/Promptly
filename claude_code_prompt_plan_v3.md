# Claude Code Prompt Plan v3 — Prompt Enhancer Chrome Extension
> Final build plan. All architectural decisions locked.

---

## Design decisions locked in v3

| Dimension | Decision |
|---|---|
| Survey questions | **LLM-generated** each round — questions adapt to actual prompt context |
| Survey UI location | **Floating modal injected into the page by content.js** — Grammarly-style |
| Rule files | **Two `.md` files** loaded at startup as system prompt strings |
| `isEducational` gate | **Removed** — user's icon click is the intent signal |
| Loop architecture | **Message-driven state machine** in background.js (MV3-safe) |
| `minRounds` | **Kept** — from `criteria.json`; guarantees minimum context collection |
| Profile field mapping | **LLM-driven fuzzy mapping** in background.js via `mapResponsesToProfile()` |

---

## Core flow

```
User clicks icon
      ↓
content.js: captureUserPrompt() + scrapePreviousDialogue() + loadProfile()
      ↓  { type: "ENHANCE", promptText, dialogueHistory, userProfile }
background.js STATE MACHINE
      ↓
  ┌─ EVALUATE: evaluateProfileSufficiency()
  │     system prompt = evaluation-criteria.md
  │     → { sufficient, missingContext, roundReason }
  │                                                        → SHOW_PROGRESS to content.js
  │  if NOT sufficient AND round < maxRounds:              → modal shows spinner
  ├─ GENERATE: generateSurveyQuestions()
  │     system prompt = evaluation-criteria.md             → SHOW_SURVEY to content.js
  │     → { question, options }[]  (LLM-generated)         → modal shows questions
  │
  │  user answers in modal → PROFILE_READY from content.js
  │     merge answers into userProfile → back to EVALUATE
  │
  │  if sufficient OR round >= maxRounds:                  → SHOW_PROGRESS to content.js
  └─ ENHANCE: enhancePrompt()                              → modal shows "Enhancing..."
        system prompt = enhancement-criteria.md
        → enhanced prompt string
        → INJECT: write to page input field               → modal shows result
        → modal: "Use this prompt" button or auto-close
```

---

## File structure

```
/
├── manifest.json                  MV3 config
├── background.js                  → esbuild → background.bundle.js
├── content.js                     DOM + floating modal UI + messaging
├── popup.html                     API key management only (settings page)
├── popup.js                       API key management only
├── selectors.json                 per-hostname DOM selectors
├── criteria.json                  { minRounds, maxRounds }
├── evaluation-criteria.md         ← YOU WRITE: system prompt for eval + survey LLM calls
├── enhancement-criteria.md        ← YOU WRITE: system prompt for enhancer
├── styles.css                     popup settings UI styles only
└── package.json
```

**Note on modal styles**: The floating modal is injected by content.js into the host
page. Its CSS is a string constant inside content.js, injected as a `<style>` tag
at runtime. It is NOT in styles.css (which only serves popup.html). This keeps the
modal fully self-contained with no extra manifest entries needed.

**Note on popup**: popup.html/popup.js exist ONLY for settings (API key entry).
They are NOT part of the survey flow. Access via right-click → Options.

---

## Project context block
> Paste this at the start of every Claude Code session before any phase prompt.

```
PROJECT: Prompt Enhancer — MV3 Chrome Extension (Vanilla JS, no framework)

PURPOSE: When a user clicks the extension icon on a chat page (ChatGPT or Claude),
the tool captures their prompt, runs a multi-round evaluation loop to gather 
sufficient context via a floating modal injected into the page by content.js,
then enhances the prompt and injects the improved version back into the input field.

CORE ARCHITECTURE — read this before touching any file:

1. LOOP MECHANISM: Message-driven state machine in background.js.
   No long-running async functions. Each incoming message advances state one step.
   Required for MV3 safety — service workers can be terminated mid-await.

2. SURVEY UI: A floating modal overlay injected into the host page by content.js.
   NOT in popup.html. The modal's CSS is a string constant inside content.js,
   injected as a <style> tag at runtime. All survey rendering, question display,
   and response collection happen inside this modal.

3. POPUP: popup.html/popup.js are ONLY for API key management (settings).
   Access via right-click on extension icon → Options.
   They do NOT participate in the survey or enhancement flow.

4. SESSION STATE: background.js holds one pendingSession in memory:
   {
     promptText: string,
     dialogueHistory: [],
     userProfile: {},       ← seeded from promptText before first evaluation round, then
                              accumulates across survey rounds
     surveyRound: 0,
   }

5. CRITERIA FILES: Two human-written .md files loaded at service worker startup
   via fetch(). Their raw text is injected as the system prompt for API calls.
   - evaluation-criteria.md → system prompt for evaluateProfileSufficiency()
                               AND generateSurveyQuestions()
   - enhancement-criteria.md → system prompt for enhancePrompt()

6. SURVEY QUESTIONS: LLM-generated each round (not hardcoded).
   generateSurveyQuestions() returns [{ question, options }].
   content.js renders whatever the LLM returns.

7. ALL API CALLS live in background.js only.
   content.js: DOM work + modal UI + messaging only.
   popup.js: API key storage only.

8. PROMPT SEEDING: Before the first evaluation round, seedProfileFromPrompt()
   makes one Haiku call to extract whatever structured fields are already
   present in promptText (taskDescription, outputFormat, educationalLevel, etc.)
   and merges them into userProfile. This prevents the survey from asking
   questions the user already answered inline.

FILE STRUCTURE:
  manifest.json             MV3 config (NO default_popup — conflicts with onClicked)
  background.js             → bundled via esbuild → background.bundle.js
  content.js                DOM + floating modal + messaging (NO API calls)
  popup.html / popup.js     Settings/API key only
  selectors.json            per-hostname DOM selectors
  criteria.json             { minRounds, maxRounds }
  evaluation-criteria.md    human-written system prompt for eval + survey generation
  enhancement-criteria.md   human-written system prompt for enhancement
  styles.css                popup settings UI styles only
  package.json              @anthropic-ai/sdk + esbuild

KEY CONSTRAINTS:
  - esbuild bundles background.js + @anthropic-ai/sdk → background.bundle.js
  - Anthropic API key: chrome.storage.local key "anthropicKey"
  - Evaluation + survey model: claude-haiku-4-5-20251001
  - Enhancement model: claude-sonnet-4-20250514
  - Dialogue history capped at 6000 chars
  - injectEnhancedPrompt() MUST dispatch InputEvent for React/Vue compatibility
  - scrapePreviousDialogue() MUST silently return [] on any failure
  - Modal CSS uses #pe- prefixed IDs/classes to avoid host page style conflicts
  - If any API call fails → handleAPIError() → fall back to original prompt

MESSAGE FLOW:
  content.js  → background.js  { type: "ENHANCE",       promptText, dialogueHistory, userProfile }
  background.js → content.js   { type: "SHOW_PROGRESS", message }
  background.js → content.js   { type: "SHOW_SURVEY",   questions, round, roundReason }
  content.js  → background.js  { type: "PROFILE_READY", rawResponses }
  background.js → content.js   { type: "INJECT",        enhancedPrompt }
  background.js → content.js   { type: "SHOW_RESULT",   enhancedPrompt, warning }
  background.js → content.js   { type: "TRIGGER" }

  background.js sends to content.js via: chrome.tabs.sendMessage(activeTabId, msg)
  content.js sends to background.js via: chrome.runtime.sendMessage(msg)
  popup.js is NOT in this message loop.
```

---

## Phase 1 — Scaffold & static files

### Produces
All files created, `npm install` clean, `npm run build` produces `background.bundle.js`,
extension loads in Chrome with no manifest errors.

### Gate checks
- [ ] `npm install` completes with no errors
- [ ] `npm run build` produces `background.bundle.js` (size > 0)
- [ ] Extension loads in `chrome://extensions` → Developer Mode → Load unpacked
- [ ] Extension icon appears in toolbar with no red error badges

### Prompt

```
Role: Senior Chrome Extension engineer. Phase 1 only — create all files, no logic.

Create every file below exactly as specified:

--- manifest.json ---
MV3. Name: "Prompt Enhancer". Version: "1.0".
Permissions: ["activeTab", "storage", "scripting"].
Content scripts: inject content.js into https://chat.openai.com/* and https://claude.ai/*.
Background service worker: background.bundle.js.
options_page: popup.html
DO NOT include "default_popup" — it conflicts with chrome.action.onClicked.
web_accessible_resources: expose selectors.json, criteria.json,
  evaluation-criteria.md, enhancement-criteria.md to
  ["https://chat.openai.com/*","https://claude.ai/*"].

--- selectors.json ---
{
  "chat.openai.com": {
    "user": "[data-message-author-role='user']",
    "assistant": "[data-message-author-role='assistant']"
  },
  "claude.ai": {
    "user": ".mb-1.mt-6.group",
    "assistant": ".group.relative.pb-3"
  }
}

--- criteria.json ---
{ "minRounds": 1, "maxRounds": 3 }

--- evaluation-criteria.md ---
[PLACEHOLDER — human-written content added before Phase 3]

--- enhancement-criteria.md ---
[PLACEHOLDER — human-written content added before Phase 5]

--- package.json ---
dependencies: { "@anthropic-ai/sdk": "^0.39.0" }
devDependencies: { "esbuild": "latest" }
scripts:
  "build": "esbuild background.js --bundle --outfile=background.bundle.js --platform=browser --target=chrome120"
  "watch": same with --watch

--- Stubs (syntactically valid, no logic) ---
background.js : // background service worker — Phase 3
content.js    : // content script — Phase 2
popup.js      : // settings popup — Phase 4
popup.html    : minimal valid HTML, links styles.css and popup.js
styles.css    : /* popup settings styles — Phase 4 */

Run: npm install && npm run build
Show ls -la output. Confirm background.bundle.js exists.
```

---

## Phase 2 — content.js (DOM + floating modal)

### Produces
All DOM utilities AND the complete floating modal UI injected into the host page.
This is the largest phase. Zero API calls. Zero business logic.

### Gate checks
- [ ] Reload extension. Open claude.ai. No JS errors in page DevTools console.
- [ ] Click extension icon.
- [ ] A floating modal overlay appears on the page (dark overlay + card).
- [ ] Modal has an × close button that dismisses it.
- [ ] Service worker console shows:
      `{ type: "ENHANCE", promptText: "...", dialogueHistory: [...], userProfile: {} }`
- [ ] You can manually trigger SHOW_PROGRESS from the service worker console:
      `chrome.tabs.sendMessage(tabId, { type: "SHOW_PROGRESS", message: "Test" })`
      Modal should update to show spinner + "Test".

### Prompt

```
Role: Senior Chrome Extension engineer. Phase 2 — implement content.js.
DOM work, floating modal, and chrome messaging only. No API calls. No other files.

PROJECT CONTEXT: [paste full context block]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 1: DOM UTILITIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

getSelectorsForHost()
  Async. Fetches chrome.runtime.getURL('selectors.json'), parses JSON,
  matches window.location.hostname, returns { user, assistant } or null.

safeTextContent(el)
  Returns el.innerText in try/catch. Returns '' on failure.

scrapePreviousDialogue()
  Async. Calls getSelectorsForHost(). On null or error → return [].
  Queries DOM for user + assistant elements, interleaves chronologically
  into [{ role, content }]. Uses safeTextContent(). MUST never throw.

truncateDialogueHistory(messages, maxChars = 6000)
  Trims oldest messages first until total char count ≤ maxChars.

detectInputField()
  Checks document.activeElement for textarea or [contenteditable].
  Fallbacks: "#prompt-textarea" (ChatGPT), "div[contenteditable='true']" (Claude).
  Returns element or null.

captureUserPrompt()
  Calls detectInputField(). Returns .value or .innerText. Returns '' if null.

injectEnhancedPrompt(text)
  Calls detectInputField(). Writes text into field.
  For textarea: el.value = text
  For contenteditable:
    el.focus()
    document.execCommand('selectAll', false, null)
    document.execCommand('insertText', false, text)
    If execCommand fails → el.innerText = text
  ALWAYS dispatch: new InputEvent('input', { bubbles: true })
  ALWAYS dispatch: new Event('change', { bubbles: true })

saveProfile(profile)
  chrome.storage.local.set({ userProfile: profile })

loadProfile()
  chrome.storage.local.get('userProfile').then(r => r.userProfile || {})

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 2: FLOATING MODAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

All modal CSS is a JS string constant called MODAL_CSS, injected as a <style> tag.
Use #pe- prefix on ALL IDs and classes to avoid host page style conflicts.

MODAL_CSS must include styles for:

  #pe-overlay
    position: fixed; inset: 0; z-index: 2147483647;
    background: rgba(0,0,0,0.55); display: flex;
    align-items: center; justify-content: center;
    font-family: system-ui, sans-serif;

  #pe-modal
    background: #0f0f11; color: #e8e8f0; border-radius: 12px;
    border: 1px solid #2a2a3a; width: 380px;
    max-width: calc(100vw - 32px); padding: 20px;
    position: relative; box-shadow: 0 8px 40px rgba(0,0,0,0.6);

  #pe-close
    position: absolute; top: 12px; right: 14px;
    background: none; border: none; color: #666;
    font-size: 18px; cursor: pointer; line-height: 1;
  #pe-close:hover { color: #e8e8f0; }

  #pe-settings-link
    position: absolute; top: 13px; right: 38px;
    color: #555; font-size: 14px; text-decoration: none;
  #pe-settings-link:hover { color: #e8e8f0; }

  #pe-header
    font-size: 13px; font-weight: 500; color: #888;
    margin: 0 0 16px; letter-spacing: 0.04em; text-transform: uppercase;

  /* Progress */
  #pe-progress { text-align: center; padding: 16px 0; }
  .pe-spinner
    width: 24px; height: 24px; border-radius: 50%;
    border: 2px solid #2a2a3a; border-top-color: #7c6ef2;
    animation: pe-spin 0.8s linear infinite; margin: 0 auto 12px;
  @keyframes pe-spin { to { transform: rotate(360deg); } }
  #pe-progress-msg { color: #888; font-size: 13px; margin: 0; }

  /* Survey */
  #pe-round-badge
    display: inline-block; background: #1e1a3a; color: #a89ef5;
    font-size: 11px; border-radius: 20px; padding: 3px 10px; margin-bottom: 8px;
  #pe-round-reason
    color: #888; font-size: 12px; font-style: italic;
    margin: 0 0 14px; line-height: 1.5;
  .pe-question-block { margin-bottom: 14px; }
  .pe-question-label { font-size: 13px; font-weight: 500; color: #c8c8d8; margin: 0 0 8px; }
  .pe-options { display: flex; flex-wrap: wrap; gap: 6px; }
  .pe-option
    display: inline-block; border: 1px solid #333; border-radius: 20px;
    padding: 5px 12px; font-size: 12px; color: #999; cursor: pointer;
    transition: all 0.15s; user-select: none;
  .pe-option:hover { border-color: #555; color: #ccc; }
  .pe-option.pe-selected { background: #7c6ef2; border-color: #7c6ef2; color: white; }
  #pe-submit
    width: 100%; margin-top: 10px; background: #7c6ef2; color: white;
    border: none; border-radius: 8px; padding: 10px;
    font-size: 14px; cursor: pointer;
  #pe-submit:hover { background: #6a5de0; }

  /* Result */
  #pe-result-text
    width: 100%; box-sizing: border-box; min-height: 120px;
    background: #1a1a22; border: 1px solid #2a2a3a; color: #e8e8f0;
    border-radius: 8px; padding: 10px; font-size: 13px;
    line-height: 1.6; resize: vertical; font-family: inherit;
  #pe-warning
    background: #3a1a1a; color: #ff8080; border: 1px solid #5a2a2a;
    border-radius: 6px; padding: 6px 10px; font-size: 12px; margin: 8px 0;
  #pe-use-btn
    width: 100%; margin-top: 10px; background: #1e1e2a; color: #a89ef5;
    border: 1px solid #3a3060; border-radius: 8px; padding: 10px;
    font-size: 14px; cursor: pointer;
  #pe-use-btn:hover { background: #2a2a3e; }
  #pe-injected-msg { text-align: center; color: #6fcf97; font-size: 12px; margin-top: 6px; }

Modal HTML structure (injected by createModal()):
  <div id="pe-overlay">
    <div id="pe-modal">
      <button id="pe-close">×</button>
      <a id="pe-settings-link" href="#" title="Open settings">⚙</a>
      <p id="pe-header">✦ Prompt Enhancer</p>

      <div id="pe-progress" hidden>
        <div class="pe-spinner"></div>
        <p id="pe-progress-msg">Working...</p>
      </div>

      <div id="pe-survey" hidden>
        <div id="pe-round-badge"></div>
        <p id="pe-round-reason"></p>
        <div id="pe-questions"></div>
        <button id="pe-submit">Continue →</button>
      </div>

      <div id="pe-result" hidden>
        <textarea id="pe-result-text" readonly></textarea>
        <div id="pe-warning" hidden>⚠ Enhancement failed — original prompt returned</div>
        <button id="pe-use-btn">Use this prompt</button>
        <p id="pe-injected-msg" hidden>✓ Injected</p>
      </div>
    </div>
  </div>

Implement these modal functions:

injectModalStyles()
  If <style id="pe-styles"> already exists, return.
  Create it with MODAL_CSS and append to document.head.

createModal()
  If #pe-overlay already exists, return.
  injectModalStyles()
  Build the HTML above, append to document.body.
  Wire up event listeners:
    #pe-close → closeModal()
    #pe-settings-link click → e.preventDefault(); window.open(chrome.runtime.getURL('popup.html'))
    #pe-submit → handleSurveySubmit()
    #pe-use-btn → handleUsePrompt()

openModal()
  createModal()
  document.getElementById('pe-overlay').hidden = false

closeModal()
  const el = document.getElementById('pe-overlay')
  if (el) el.hidden = true

showModalSection(id)   ← 'pe-progress' | 'pe-survey' | 'pe-result'
  Hide all three sections. Show the named one.

showModalProgress(message)
  openModal()
  showModalSection('pe-progress')
  document.getElementById('pe-progress-msg').textContent = message

Module-level: let currentQuestions = []

renderSurvey(questions, round, roundReason, maxRounds)
  currentQuestions = questions
  openModal()
  document.getElementById('pe-round-badge').textContent = 'Round ' + round + ' of ' + maxRounds
  document.getElementById('pe-round-reason').textContent = roundReason
  const container = document.getElementById('pe-questions')
  container.innerHTML = ''
  questions.forEach((q, qi) => {
    const block = document.createElement('div')
    block.className = 'pe-question-block'
    const label = document.createElement('p')
    label.className = 'pe-question-label'
    label.textContent = q.question
    block.appendChild(label)
    const opts = document.createElement('div')
    opts.className = 'pe-options'
    q.options.forEach(opt => {
      const pill = document.createElement('span')
      pill.className = 'pe-option'
      pill.textContent = opt
      pill.dataset.qi = qi
      pill.dataset.value = opt
      pill.addEventListener('click', () => {
        opts.querySelectorAll('.pe-option').forEach(p => p.classList.remove('pe-selected'))
        pill.classList.add('pe-selected')
      })
      opts.appendChild(pill)
    })
    block.appendChild(opts)
    container.appendChild(block)
  })
  showModalSection('pe-survey')

collectModalResponses()
  const responses = {}
  currentQuestions.forEach((q, qi) => {
    const sel = document.querySelector('.pe-option.pe-selected[data-qi="' + qi + '"]')
    if (sel) responses[q.question] = sel.dataset.value
  })
  return responses

handleSurveySubmit()
  const rawResponses = collectModalResponses()
  // Send raw question→answer map to background.js for LLM-powered field mapping
  chrome.runtime.sendMessage({ type: 'PROFILE_READY', rawResponses })
  showModalProgress('Checking what we still need...')

showModalResult(enhancedPrompt, warning, mergedProfile)
  document.getElementById('pe-result-text').value = enhancedPrompt
  document.getElementById('pe-warning').hidden = !warning
  if (mergedProfile) saveProfile(mergedProfile)   // ← save full accumulated profile
  openModal()
  showModalSection('pe-result')

handleUsePrompt()
  const text = document.getElementById('pe-result-text').value
  injectEnhancedPrompt(text)
  document.getElementById('pe-injected-msg').hidden = false
  setTimeout(() => {
    document.getElementById('pe-injected-msg').hidden = true
    closeModal()
  }, 1500)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 3: MESSAGE LISTENER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'TRIGGER':
      Promise.all([captureUserPrompt(), scrapePreviousDialogue(), loadProfile()])
        .then(([promptText, rawHistory, userProfile]) => {
          const dialogueHistory = truncateDialogueHistory(rawHistory)
          showModalProgress('Evaluating your prompt...')
          chrome.runtime.sendMessage({ type: 'ENHANCE', promptText, dialogueHistory, userProfile })
        })
      break
    case 'SHOW_PROGRESS':
      showModalProgress(message.message)
      break
    case 'SHOW_SURVEY':
      renderSurvey(message.questions, message.round, message.roundReason, message.maxRounds)
      break
    case 'SHOW_RESULT':
      showModalResult(message.enhancedPrompt, message.warning, message.userProfile)
      breaks
  }
})

Prefix all console.log with "[PE content.js]".
```

---

## Phase 3 — background.js (state machine + evaluation engine)

### ⚠️ STOP — check evaluation-criteria.md before running

Run `cat evaluation-criteria.md`. If it contains only "[PLACEHOLDER" or is empty,
fill it in first (see Appendix A template). The agent will halt if it finds a stub.

### Produces
Full background.js: startup loading, evaluation engine, survey generation,
message-driven state machine. Enhancement is a stub until Phase 5.
Run `npm run build` after.

### Gate checks
- [ ] `npm run build` — no errors
- [ ] Click icon on claude.ai with text in the input
- [ ] Floating modal appears, shows "Evaluating your prompt..."
- [ ] Service worker console shows: `{ sufficient: false, missingContext: [...] }`
- [ ] Modal transitions to survey with LLM-generated questions (verify they are context-aware)
- [ ] Answer survey → modal shows "Checking..." → second round if still insufficient
- [ ] After maxRounds: modal shows "Enhancing..." (placeholder result — Phase 5 fills this)

### Prompt

```
Role: Senior Chrome Extension engineer. Phase 3 — implement background.js.
Run npm run build after. Do not touch any other file.

CRITICAL: Before writing any code, run:
  cat evaluation-criteria.md
If it contains "[PLACEHOLDER" or is empty, output this and stop:
  "⏸ PAUSED: evaluation-criteria.md is still a placeholder. Fill it in first."
Only proceed if the file has real content.

PROJECT CONTEXT: [paste full context block]

━━━━━━━ STARTUP ━━━━━━━

import Anthropic from '@anthropic-ai/sdk'

Module-level variables:
  let evaluationCriteriaPrompt = ''
  let enhancementCriteriaPrompt = ''
  let criteria = { minRounds: 1, maxRounds: 3 }
  let activeTabId = null

Load at startup (immediately-invoked async at top of file):
let criteriasReadyResolve
const criteriasReady = new Promise(resolve => { criteriasReadyResolve = resolve })

;(async () => {
  try {
    const [evalText, enhText, critJson] = await Promise.all([
      fetch(chrome.runtime.getURL('evaluation-criteria.md')).then(r => r.text()),
      fetch(chrome.runtime.getURL('enhancement-criteria.md')).then(r => r.text()),
      fetch(chrome.runtime.getURL('criteria.json')).then(r => r.json()),
    ])
    evaluationCriteriaPrompt = evalText
    enhancementCriteriaPrompt = enhText
    criteria = critJson
    console.log('[PE background.js] Criteria loaded', criteria)
  } finally {
    criteriasReadyResolve()  // resolves even on fetch failure so handlers never hang
  }
})()

━━━━━━━ SESSION STATE ━━━━━━━

let pendingSession = null
activeTabId = null
// { promptText, dialogueHistory, userProfile, surveyRound }

function mergeProfile(existing, incoming) { return { ...existing, ...incoming } }

━━━━━━━ HELPERS ━━━━━━━

async function getApiKey()
  return chrome.storage.local.get('anthropicKey').then(r => r.anthropicKey)

function handleAPIError(error)
  console.error('[PE background.js] API error:', error)
  return null

function sendToContentScript(message)
  chrome.tabs.sendMessage(activeTabId, message)
    .catch(e => console.warn('[PE background.js] content script unreachable:', e))

function sanitizeDialogueHistory(messages)
  let start = 0
  while (start < messages.length && messages[start].role !== 'user') start++
  return messages.slice(start)

━━━━━━━ EVALUATION ENGINE ━━━━━━━

async function seedProfileFromPrompt(promptText)
  const apiKey = await getApiKey()
  if (!apiKey) return {}
  const client = new Anthropic({ apiKey })
  const system = `You extract structured profile fields from a user's raw prompt text.
Return ONLY a compact JSON object containing fields you can confidently infer.
Only include fields with clear evidence in the prompt — do not guess or hallucinate.
Omit fields that are absent or ambiguous.

Possible fields (all optional):
  taskDescription     string  — what the user is being asked to do
  educationalLevel    string  — e.g. "high school", "undergraduate", "graduate"
  topicAndDiscipline  string  — subject area and discipline
  outputFormat        string  — e.g. "essay", "LaTeX", "short answer", "paper with references"
  audience            string  — intended reader, if mentioned
  length              string  — length or page count, if mentioned
  referenceRequirements string — citation style or "no references", if mentioned
  userStance          string  — user's argument or position, if stated
  intentionalErrors   string  — "Yes" or "No", only if explicitly mentioned

No prose, no markdown fences, no explanation. Return {} if nothing is clearly inferable.`
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: promptText }]
    })
    return JSON.parse(response.content[0].text)
  } catch {
    console.warn('[PE background.js] seedProfileFromPrompt failed — starting with empty profile')
    return {}
  }

async function evaluateProfileSufficiency(promptText, dialogueHistory, userProfile)
  const apiKey = await getApiKey()
  if (!apiKey) {
  console.warn('[PE background.js] No API key')
  return { sufficient: true, missingContext: [], roundReason: '' }
}
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: evaluationCriteriaPrompt,
    messages: [
      ...sanitizeDialogueHistory(dialogueHistory),
      { role: 'user', content: JSON.stringify({ promptText, userProfile }) }
    ]
  })
  try {
    return JSON.parse(response.content[0].text)
    // Expected: { sufficient, missingContext, roundReason }
  } catch {
    return { sufficient: true, missingContext: [], roundReason: '' }
    // Fail-open: never block the user on a parse error
  }

async function generateSurveyQuestions(promptText, dialogueHistory, userProfile, missingContext)
  const apiKey = await getApiKey()
  if (!apiKey) {
  console.warn('[PE background.js] No API key')
  return []
}
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: evaluationCriteriaPrompt,
    messages: [
      ...sanitizeDialogueHistory(dialogueHistory),
      { role: 'user', content: JSON.stringify({
          task: 'generate_survey', promptText, userProfile, missingContext
        })
      }
    ]
  })
  try {
    return JSON.parse(response.content[0].text)
    // Expected: [{ question, options }, ...]
  } catch {
    handleAPIError(new Error('Survey generation parse failed'))
    return []
  }

async function mapResponsesToProfile(rawResponses, promptText)
  const apiKey = await getApiKey()
  if (!apiKey) return rawResponses   // fallback: use raw responses as-is
  const client = new Anthropic({ apiKey })
  const system = `You convert survey question-answer pairs into a canonical user profile JSON object.
Given a map of question→answer strings and the user's original prompt, return ONLY a compact JSON object.
Keys must be short camelCase field names (e.g. audience, tone, format, goal, length, gradeLevel).
Values are the selected answer strings. No prose, no markdown fences, no explanation.`
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: JSON.stringify({ responses: rawResponses, promptText }) }]
    })
    return JSON.parse(response.content[0].text)
  } catch {
    console.warn('[PE background.js] mapResponsesToProfile failed — using raw responses')
    return rawResponses
  }

━━━━━━━ ENHANCEMENT STUB (replaced in Phase 5) ━━━━━━━

async function enhancePrompt(promptText, userProfile, dialogueHistory)
  console.log('[PE background.js] enhancePrompt() stub — returning null')
  return null

━━━━━━━ LOOP ADVANCEMENT ━━━━━━━

async function advanceLoop(evalResult) {
  const { sufficient, missingContext, roundReason } = evalResult
  const meetsMin = pendingSession.surveyRound >= criteria.minRounds
  const hitMax = pendingSession.surveyRound >= criteria.maxRounds
  const shouldEnhance = (sufficient && meetsMin) || hitMax

  if (shouldEnhance) {
    sendToContentScript({ type: 'SHOW_PROGRESS', message: 'Enhancing your prompt...' })
    const result = await enhancePrompt(
      pendingSession.promptText,
      pendingSession.userProfile,
      pendingSession.dialogueHistory
    )
    const enhanced = result ?? pendingSession.promptText
    const warning = result === null
    sendToContentScript({ type: 'SHOW_RESULT', enhancedPrompt: enhanced, warning, userProfile: pendingSession.userProfile })
    pendingSession = null
    activeTabId = null

  } else {
    const contextToAsk = missingContext.length > 0
      ? missingContext
      : ['general context about goal and audience']
    const questions = await generateSurveyQuestions(
      pendingSession.promptText,
      pendingSession.dialogueHistory,
      pendingSession.userProfile,
      contextToAsk
    )
    if (!questions || questions.length === 0) {
        console.warn('[PE background.js] No questions generated — forcing enhance')
        sendToContentScript({ type: 'SHOW_PROGRESS', message: 'Enhancing your prompt...' })
        const result = await enhancePrompt(
            pendingSession.promptText,
            pendingSession.userProfile,
            pendingSession.dialogueHistory
    )
        const enhanced = result ?? pendingSession.promptText
        sendToContentScript({
          type: 'SHOW_RESULT',
          enhancedPrompt: enhanced,
          warning: result === null,
          userProfile: pendingSession.userProfile
        })
        pendingSession = null
        activeTabId = null
    return
    }
    sendToContentScript({
      type: 'SHOW_SURVEY',
      questions,
      round: pendingSession.surveyRound + 1,
      maxRounds: criteria.maxRounds,
      roundReason: roundReason || 'A bit more context will help improve your prompt.'
    })
  }
}

━━━━━━━ MESSAGE-DRIVEN STATE MACHINE ━━━━━━━

chrome.action.onClicked.addListener((tab) => {
  activeTabId = tab.id
  setTimeout(() => chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER' }), 100)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    await criteriasReady
    switch (message.type) {

      case 'ENHANCE': {
        const { promptText, dialogueHistory, userProfile } = message
        // Seed profile from raw prompt before evaluation starts —
        // prevents asking for context the user already provided inline
        sendToContentScript({ type: 'SHOW_PROGRESS', message: 'Reading your prompt...' })
        const seededFields = await seedProfileFromPrompt(promptText)
        const seededProfile = mergeProfile(userProfile, seededFields)
        pendingSession = { promptText, dialogueHistory, userProfile: seededProfile, surveyRound: 0 }
        sendToContentScript({ type: 'SHOW_PROGRESS', message: 'Evaluating your prompt...' })
        const evalResult = await evaluateProfileSufficiency(promptText, dialogueHistory, seededProfile)
        await advanceLoop(evalResult)
        break
      }

      case 'PROFILE_READY': {
        if (!pendingSession) { console.warn('[PE background.js] PROFILE_READY with no session'); return }
        const mappedProfile = await mapResponsesToProfile(message.rawResponses, pendingSession.promptText)
        pendingSession.userProfile = mergeProfile(pendingSession.userProfile, mappedProfile)
        pendingSession.surveyRound++
        sendToContentScript({ type: 'SHOW_PROGRESS', message: 'Checking what we still need...' })
        const evalResult = await evaluateProfileSufficiency(
          pendingSession.promptText,
          pendingSession.dialogueHistory,
          pendingSession.userProfile
        )
        await advanceLoop(evalResult)
        break
      }
    }
  })()
  return true
})

After implementing, run: npm run build. Show full output. Fix any errors.
Prefix all console.log with "[PE background.js]".
```

---

## Phase 4 — popup.html + popup.js + styles.css (settings only)

### Produces
A minimal settings page for API key entry. No survey code at all here.

### Gate checks
- [ ] Right-click extension icon → Options → settings page opens
- [ ] Enter API key → Save → "Saved ✓" appears
- [ ] Reload browser → API key still present (check chrome.storage.local in DevTools)
- [ ] ⚙ icon in the modal (added in Phase 2) → opens same settings page

### Prompt

```
Role: Senior Chrome Extension engineer. Phase 4 — implement popup.html, popup.js, 
styles.css. Settings page only — no survey, no enhancement flow.

PROJECT CONTEXT: [paste full context block]

--- popup.html ---
A clean settings page. Structure:
  <header>: "✦ Prompt Enhancer — Settings"
  <section>:
    <label>Anthropic API Key</label>
    <input type="password" id="api-key-input" placeholder="sk-ant-...">
    <button id="save-key-btn">Save key</button>
    <span id="key-saved-msg" hidden>Saved ✓</span>
    <p class="hint">Get your key at console.anthropic.com</p>
  <section class="info">:
    <p>Evaluation and enhancement criteria are defined in:</p>
    <code>evaluation-criteria.md</code><br>
    <code>enhancement-criteria.md</code>
    <p>Edit these files and reload the extension to update behavior.</p>
  Link styles.css. Script popup.js.

--- popup.js ---
On DOMContentLoaded:
  Load API key: chrome.storage.local.get('anthropicKey', r => {
    if (r.anthropicKey) {
      // Show masked version: last 4 chars only
      document.getElementById('api-key-input').placeholder =
        '••••••••' + r.anthropicKey.slice(-4)
    }
  })

Save button:
  const key = document.getElementById('api-key-input').value.trim()
  if (!key) return
  chrome.storage.local.set({ anthropicKey: key }, () => {
    const msg = document.getElementById('key-saved-msg')
    msg.hidden = false
    setTimeout(() => { msg.hidden = true }, 2000)
  })

--- styles.css ---
body: max-width: 420px; margin: 0 auto; padding: 28px 24px;
      font: 14px/1.6 system-ui; background: #0f0f11; color: #e8e8f0;
header: font-size: 15px; font-weight: 500; margin-bottom: 24px; color: #e8e8f0;
section: margin-bottom: 20px;
label: display: block; font-size: 11px; color: #666; margin-bottom: 6px;
       text-transform: uppercase; letter-spacing: 0.06em;
input: width: 100%; box-sizing: border-box; background: #1a1a22;
       border: 1px solid #2a2a3a; color: #e8e8f0; border-radius: 6px;
       padding: 9px 12px; font-size: 13px; outline: none;
input:focus: border-color: #7c6ef2;
button: margin-top: 8px; background: #7c6ef2; color: white; border: none;
        border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer;
button:hover: background: #6a5de0;
#key-saved-msg: color: #6fcf97; font-size: 12px; margin-left: 10px; vertical-align: middle;
.hint: color: #444; font-size: 12px; margin-top: 6px;
.info: border-top: 1px solid #1e1e2a; padding-top: 16px;
.info p: color: #555; font-size: 12px; margin: 0 0 6px;
code: display: inline-block; background: #1a1a22; color: #a89ef5;
      border-radius: 4px; padding: 2px 7px; font-size: 12px; margin-bottom: 4px;
```

---

## Phase 5 — enhancePrompt() (background.js, part 2)

### ⚠️ STOP — check enhancement-criteria.md before running

Run `cat enhancement-criteria.md`. Fill it in if still a placeholder (see Appendix B).

### Produces
Replaces the Phase 3 stub. Full end-to-end flow works.

### Gate checks
- [ ] `npm run build` — no errors
- [ ] Full flow: trigger → modal evaluates → survey → "Enhancing..." → result in modal
- [ ] Enhanced prompt is visibly better and uses context from survey answers
- [ ] "Use this prompt" → input field updates → modal closes after 1.5s
- [ ] Invalid API key → original prompt returned, warning shown in modal

### Prompt

```
Role: Senior Chrome Extension engineer. Phase 5 — replace enhancePrompt() stub.
Only modify background.js. Run npm run build after.

CRITICAL: Before writing any code, run:
  cat enhancement-criteria.md
If it contains "[PLACEHOLDER" or is empty, stop and output:
  "⏸ PAUSED: enhancement-criteria.md is still a placeholder. Fill it in first."

PROJECT CONTEXT: [paste full context block]

Replace the stub enhancePrompt() with:

async function enhancePrompt(promptText, userProfile, dialogueHistory)
  const apiKey = await getApiKey()
  if (!apiKey) {
  console.warn('[PE background.js] No API key — cannot enhance')
  return null
}
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: enhancementCriteriaPrompt,
    messages: [
      ...sanitizeDialogueHistory(dialogueHistory),
      { role: 'user', content: JSON.stringify({ promptText, userProfile }) }
    ]
  })
  return response.content[0].text
  On any error: handleAPIError(error), return null

No other changes. Run: npm run build. Show full output.
```

---

## Phase 6 — End-to-end QA

### Full demo checklist
- [ ] Reload extension. Right-click icon → Options → enter API key → save.
- [ ] Open claude.ai, type "write something about history", click icon.
- [ ] Floating modal appears on the page with dark overlay.
- [ ] Modal shows "Evaluating your prompt..."
- [ ] Survey appears with LLM-generated questions, round badge, reason text.
- [ ] Pill buttons: click selects (purple), clicking another deselects first.
- [ ] "Continue →" → "Checking..." in modal.
- [ ] If still insufficient: Round 2 with different questions.
- [ ] After sufficient context: "Enhancing..." → result textarea with enhanced prompt.
- [ ] "Use this prompt" → chat input updates → "✓ Injected" → modal closes after 1.5s.
- [ ] Try a detailed prompt → minimal rounds → faster path to enhancement.
- [ ] Invalid API key → original prompt returned, warning badge in modal.
- [ ] Click icon again after completed session → fresh session, no stale state.
- [ ] ⚙ icon in modal header → opens settings page in new tab.

### Prompt

```
Role: Senior Chrome Extension engineer. Phase 6 — QA only. No new features.

Audit in this order:

1. MANIFEST AUDIT
   cat manifest.json
   Verify: NO "default_popup" key (would block onClicked)
   Verify: "options_page": "popup.html"
   Verify: service_worker = "background.bundle.js"
   Verify: web_accessible_resources includes .md files and .json config files
   Fix any issues.

2. BUILD AUDIT
   npm run build — must be error-free.

3. ICON CLICK AUDIT
   Verify chrome.action.onClicked fires (no default_popup conflict).
   Verify activeTabId is set before any sendToContentScript() call.
   If TRIGGER arrives at content.js before modal is ready: increase setTimeout delay to 300ms.

4. MODAL STYLE ISOLATION AUDIT
   Open modal on claude.ai. Open DevTools → inspect #pe-modal.
   Check for host page CSS rules overriding modal styles.
   Common fix: add `all: initial; font-family: system-ui;` to #pe-modal in MODAL_CSS.

5. MESSAGE ROUTING AUDIT
   Trace every type string end-to-end:
     TRIGGER → ENHANCE → SHOW_PROGRESS → SHOW_SURVEY → PROFILE_READY
     → SHOW_PROGRESS → (loop or) → SHOW_RESULT + INJECT
   Verify each sender and listener exists, type strings match exactly.

6. INJECTION AUDIT
   Test injectEnhancedPrompt() on both claude.ai and chat.openai.com.
   If React state doesn't update → verify InputEvent dispatch and execCommand fallback.

7. SESSION RESET AUDIT
   After completed flow: pendingSession must be null.
   Click icon again → fresh session starts. No errors in console.

8. ROUND CAP AUDIT
   Set criteria.json maxRounds = 1. Reload extension.
   Trigger with vague prompt. Enhancement must still run after round 1.
   Restore to 3.

After all fixes: npm run build. List every file changed and every fix made.
```

---

## Appendix A — evaluation-criteria.md template

This file is the system prompt for both:
- `evaluateProfileSufficiency()` — user message: `{ promptText, userProfile }`
- `generateSurveyQuestions()` — user message: `{ task: "generate_survey", promptText, userProfile, missingContext }`

The model distinguishes the two tasks from the presence of `"task": "generate_survey"`.

```markdown
# Evaluation and Survey Generation Criteria

You are an intelligent evaluation engine embedded in a prompt enhancement tool.
You receive user messages as JSON. Behavior depends on the "task" field.

---

## Task 1: Evaluate prompt sufficiency
Triggered when user message has NO "task" field: { promptText, userProfile }

Assess whether promptText + userProfile provide enough context to enhance the prompt.

### Mapping rule — promptText as fallback
promptText has already been parsed for known fields before this call.
If taskDescription is still absent from userProfile, treat promptText as its
value rather than asking the user to repeat themselves.

### Fields to check
[LIST YOUR FIELDS AND RULES HERE — examples:]
- audience: Who will read or use this output?
- goal: What does the user want to accomplish?
- format: What should the output look like?
- length: How long should the output be?
- constraints: Any special rules the output must follow?

### Sufficiency rules
[YOUR RULES HERE — examples:]
- audience AND goal both present or clearly inferable → sufficient = true
- Prompt under 8 words with empty userProfile → always insufficient
- Fields already in userProfile count as provided; do not ask again
- Fields in dialogueHistory count as provided

### Output — ONLY this JSON (no prose, no fences):
{
  "sufficient": <true|false>,
  "missingContext": ["field still needed", ...],
  "roundReason": "<one sentence shown to user explaining what is still needed>"
}

---

## Task 2: Generate survey questions
Triggered when user message has "task": "generate_survey":
{ task: "generate_survey", promptText, userProfile, missingContext }

Generate targeted MCQ questions to collect the missing context.

### Rules for good questions
[YOUR RULES HERE — examples:]
- One question per item in missingContext (max 4 questions total)
- Never ask about anything already in userProfile
- MCQ only — no open-ended questions
- 3–4 mutually exclusive options per question
- Plain language, no jargon

### Output — ONLY this JSON array (no prose, no fences):
[
  { "question": "...", "options": ["A", "B", "C"] },
  ...
]
```

---

## Appendix B — enhancement-criteria.md template

This file is the system prompt for `enhancePrompt()`.
User message: `{ promptText, userProfile }`

```markdown
# Prompt Enhancement Criteria

You are an expert prompt engineer. Rewrite the user's raw prompt into a
high-quality prompt that will get substantially better results from an AI.

You receive: { promptText, userProfile }
Use ALL fields in userProfile when constructing the enhanced prompt.

---

## What makes a good prompt

### Structure
[YOUR RULES HERE]

### Specificity
[YOUR RULES HERE]

### Anti-hallucination techniques
[YOUR RULES HERE — examples:]
- Instruct the model to say "I don't know" rather than guess
- Add scope constraints when citations are restricted
- Add "if uncertain, say so explicitly"

### Reasoning and workflow
[YOUR RULES HERE]

### What NOT to do
- Do not change what the user is asking for — only improve HOW it is asked
- Do not add facts the user did not provide
- Do not add preamble to the enhanced prompt itself

---

## Output
Return ONLY the enhanced prompt text. Nothing else.
```

---

## Quick reference

### Message types

| Sender | Receiver | Type | Key payload |
|---|---|---|---|
| background.js | content.js | `TRIGGER` | — |
| content.js | background.js | `ENHANCE` | `promptText, dialogueHistory, userProfile` |
| background.js | content.js | `SHOW_PROGRESS` | `message` |
| background.js | content.js | `SHOW_SURVEY` | `questions, round, roundReason, maxRounds` |
| content.js | background.js | `PROFILE_READY` | `rawResponses` |
| background.js | content.js | `SHOW_RESULT` | `enhancedPrompt, warning` |
| background.js | content.js | `INJECT` | `enhancedPrompt` |

### Criteria file → API call mapping

| Function | Model | System prompt source |
|---|---|---|
| `evaluateProfileSufficiency()` | haiku | `evaluation-criteria.md` |
| `generateSurveyQuestions()` | haiku | `evaluation-criteria.md` |
| `enhancePrompt()` | sonnet | `enhancement-criteria.md` |
