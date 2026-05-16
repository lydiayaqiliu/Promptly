# Claude Code Prompt Plan — Prompt Enhancer Chrome Extension
> Build order, gate checks, and exact prompts to paste into Claude Code

---

## Context Snapshot (what Claude Code needs to know every session)

> **Copy this block into any new Claude Code session before pasting a phase prompt.**

```
PROJECT: Prompt Enhancer — MV3 Chrome Extension (Vanilla JS, no framework)
PURPOSE: Intercepts user prompts on ChatGPT / Claude / Gemini, classifies them, 
         surveys the user for missing context, then uses the Anthropic API to 
         rewrite and inject an enhanced version back into the page input field.

FILE STRUCTURE (flat root, no subdirectories):
  manifest.json       — MV3 config
  background.js       → bundled → background.bundle.js (esbuild)
  content.js          — injected into chat pages
  popup.html          — extension popup
  popup.js            — popup logic
  selectors.json      — per-hostname DOM selectors
  styles.css          — popup + modal styles
  package.json        — esbuild + @anthropic-ai/sdk

KEY CONSTRAINTS:
  - MV3 service workers can't use ES module imports from node_modules directly
    → esbuild bundles background.js + @anthropic-ai/sdk → background.bundle.js
  - Anthropic API key stored in chrome.storage.local under key "anthropicKey"
  - Model for classification: claude-haiku-4-5-20251001 (fast/cheap)
  - Model for enhancement:    claude-sonnet-4-20250514
  - Dialogue history is capped at 6000 chars before any API call
  - All API calls live in background.js only — never in content.js or popup.js
  - injectEnhancedPrompt() must dispatch an InputEvent so React/Vue listeners fire
  - scrapePreviousDialogue() must silently return [] on any failure (never crash)
  - Every module must have graceful fallback: if enhance fails, return original prompt

MESSAGE FLOW (chrome.runtime.sendMessage):
  content.js  →  background.js : { type: "ENHANCE", promptText, dialogueHistory }
  background.js → popup.js     : { type: "SHOW_SURVEY", missingFields }
  content.js  →  background.js : { type: "PROFILE_READY", rawResponses }
  background.js → content.js   : { type: "INJECT", enhancedPrompt }
```

---

## Phase 1 — Project Scaffold & Static Files

### What this phase produces
`manifest.json`, `selectors.json`, `package.json`, empty placeholder stubs for all JS/HTML/CSS files, and a working esbuild build command.

### Gate check before moving to Phase 2
- [ ] `npm install` completes with no errors
- [ ] `npm run build` produces `background.bundle.js` (even if it's nearly empty)
- [ ] Extension loads in `chrome://extensions` (Developer Mode → Load unpacked) with no manifest errors
- [ ] Extension icon appears in toolbar

### Exact prompt for Claude Code

```
Role: You are a senior Chrome Extension engineer. This is Phase 1 of a multi-phase 
build. Your only job is scaffolding — do not implement any logic yet.

Project: Prompt Enhancer — MV3 Chrome Extension (Vanilla JS).

Create the following files exactly as specified:

--- manifest.json ---
MV3. Name: "Prompt Enhancer". Version: "1.0". 
Permissions: ["activeTab", "storage", "scripting"].
Content scripts: inject content.js into https://chat.openai.com/* and https://claude.ai/*.
Background service worker: background.bundle.js (NOT background.js — it's the esbuild output).
Default popup: popup.html.
Include a web_accessible_resources entry exposing selectors.json to content scripts 
(matches: ["https://chat.openai.com/*","https://claude.ai/*"]).

--- selectors.json ---
{
  "chat.openai.com": {
    "user": "[data-message-author-role='user']",
    "assistant": "[data-message-author-role='assistant']"
  },
  "claude.ai": {
    "user": "[data-testid='human-turn']",
    "assistant": "[data-testid='ai-turn']"
  }
}

--- package.json ---
Dependencies: @anthropic-ai/sdk.
DevDependencies: esbuild.
Scripts:
  "build": "esbuild background.js --bundle --outfile=background.bundle.js --platform=browser --target=chrome120"
  "watch": "esbuild background.js --bundle --outfile=background.bundle.js --platform=browser --target=chrome120 --watch"

--- Stub files (create empty but valid files) ---
- background.js   : just export {} or a comment
- content.js      : just a comment
- popup.js        : just a comment
- popup.html      : minimal valid HTML with <script src="popup.js"></script>
- styles.css      : empty

After creating all files, run:
  npm install
  npm run build

Confirm background.bundle.js was created. List all files with ls -la.
```

---

## Phase 2 — content.js (DOM Detection, Scraping, Injection)

### What this phase produces
A fully implemented `content.js` with all DOM functions. No API calls in this file.

### Gate check before moving to Phase 3
- [ ] Reload extension in Chrome. Open ChatGPT or Claude.
- [ ] Open DevTools Console on the chat page — no JS errors on load
- [ ] Click the extension icon — confirm a message appears in the background service worker console (DevTools → Service Workers) showing `{ type: "ENHANCE", promptText: "...", dialogueHistory: [...] }`
- [ ] Type something in the chat input and click the icon to trigger

### Exact prompt for Claude Code

```
Role: You are a senior Chrome Extension engineer implementing content.js for Phase 2 
of a multi-phase build. Implement ONLY content.js — do not touch any other file.

PROJECT CONTEXT:
- MV3 Chrome Extension, Vanilla JS
- content.js is injected into https://chat.openai.com/* and https://claude.ai/*
- All API calls happen in background.js — content.js only does DOM work and messaging
- selectors.json is a web-accessible resource fetched via chrome.runtime.getURL()

Implement these functions in content.js in this exact order:

1. getSelectorsForHost()
   - Fetches chrome.runtime.getURL('selectors.json') using fetch()
   - Parses JSON, matches window.location.hostname
   - Returns the selector object ({ user, assistant }) or null if no match

2. safeTextContent(el)
   - Wraps el.innerText in try/catch
   - Returns empty string on any failure

3. scrapePreviousDialogue()
   - Async. Calls getSelectorsForHost()
   - If null or any error → return []
   - Queries the DOM for user and assistant turn elements using the selectors
   - Interleaves them into chronological order as { role: "user"|"assistant", content: string }[]
   - Uses safeTextContent() for all element reads
   - Catches ALL errors and returns [] silently — this function must never throw

4. truncateDialogueHistory(messages, maxChars = 6000)
   - Trims from the oldest messages first until total char count ≤ maxChars
   - Returns the trimmed array

5. detectInputField()
   - Checks document.activeElement for <textarea> or [contenteditable]
   - Falls back to known selectors: 
       ChatGPT: "#prompt-textarea"
       Claude:  "div[contenteditable='true']"
   - Returns the element or null

6. captureUserPrompt()
   - Calls detectInputField()
   - Returns .value (textarea) or .innerText (contenteditable)
   - Returns empty string if field not found

7. injectEnhancedPrompt(text)
   - Calls detectInputField()
   - Sets .value or .innerText = text
   - Dispatches new InputEvent('input', { bubbles: true }) on the element
   - Also dispatches new Event('change', { bubbles: true })
   - This is critical: React/Vue listeners won't fire without the InputEvent

8. Main trigger: listen for chrome.runtime.onMessage
   - On { type: "INJECT", enhancedPrompt } → call injectEnhancedPrompt(enhancedPrompt)

9. Extension icon click handler:
   - Use chrome.action.onClicked if available, otherwise detect via message from background
   - Actually: add a chrome.runtime.onMessage listener for { type: "TRIGGER" }
   - On TRIGGER: run captureUserPrompt() and scrapePreviousDialogue() in parallel 
     (Promise.all), then truncateDialogueHistory(), then send:
     chrome.runtime.sendMessage({ 
       type: "ENHANCE", 
       promptText: <captured>, 
       dialogueHistory: <truncated> 
     })

10. handleSurveySubmit()
   - collectModalResponses() returns a raw question→answer map
   - Remove any buildUserProfile()/saveProfile() calls in this handler
   - Send raw responses directly to background.js:
     chrome.runtime.sendMessage({ type: "PROFILE_READY", rawResponses })
   - showModalProgress("Checking what we still need...")

All async functions must be properly awaited. Add console.log("[PE content.js]") 
prefixed debug logs to each major step so the gate check is easy.
```

---

## Phase 3 — background.js (Service Worker, API Calls)

### V3 Design Decisions
| Decision | Location |
|---|---|
| Survey question→profile field mapping | in background.js via `mapResponsesToProfile()` |

### What this phase produces
Fully implemented `background.js` with classification, enhancement, and message routing. Run `npm run build` after this phase.

### Gate check before moving to Phase 4
- [ ] `npm run build` completes with no errors
- [ ] In Chrome DevTools → Application → Service Workers: no errors shown
- [ ] Trigger the full flow from Phase 2 (click icon on a chat page with text in the input)
- [ ] In the service worker console: confirm `classifyPrompt()` returns `{ isEducational: bool, missingFields: [...] }`
- [ ] Confirm `{ type: "SHOW_SURVEY", missingFields }` is sent (visible in console)
- [ ] If you temporarily hardcode a profile and skip the survey step, confirm `enhancePrompt()` returns a non-empty string

### Exact prompt for Claude Code

```
Role: You are a senior Chrome Extension engineer implementing background.js for 
Phase 3 of a multi-phase build. This is the MV3 service worker. After implementation, 
run "npm run build" to produce background.bundle.js.

PROJECT CONTEXT:
- MV3 service worker — cannot use top-level await, must use event listeners
- Anthropic API key: retrieved from chrome.storage.local key "anthropicKey"
- Classification model: claude-haiku-4-5-20251001
- Enhancement model:    claude-sonnet-4-20250514
- Import: import Anthropic from '@anthropic-ai/sdk' (esbuild will bundle it)

Implement these functions in background.js:

1. async getApiKey()
   - Returns chrome.storage.local.get("anthropicKey").then(r => r.anthropicKey)

2. buildClassificationSystemPrompt()
   - Returns a string that instructs the model to:
     * Determine if the user's prompt is educational in nature
     * Identify which of these fields are MISSING from the prompt AND not covered 
       by the provided dialogue history: gradeLevel, subject, writingGoal, citations, 
       length, formality
     * Return ONLY a JSON object: { "isEducational": bool, "missingFields": string[] }
     * Never return prose, never wrap in markdown fences

3. async classifyPrompt(promptText, dialogueHistory = [])
   - Gets API key via getApiKey()
   - Creates new Anthropic({ apiKey }) client
   - Calls client.messages.create() with:
       model: "claude-haiku-4-5-20251001"
       max_tokens: 200
       system: buildClassificationSystemPrompt()
       messages: [...dialogueHistory, { role: "user", content: promptText }]
   - Parses response.content[0].text as JSON
   - Returns the parsed object
   - On any error: returns { isEducational: false, missingFields: [] }

4. async mapResponsesToProfile(rawResponses, promptText)
   - Add this function immediately after generateSurveyQuestions() in your file
   - Implement exactly:
     async function mapResponsesToProfile(rawResponses, promptText) {
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
     }

5. buildEnhancerSystemPrompt(userProfile)
   - userProfile shape: { gradeLevel, subject, writingGoal, citations, length, formality }
   - Returns a system prompt string like:
     "You are helping a [gradeLevel] student writing a [writingGoal] [subject] assignment. 
      [citations instruction]. Target length: [length]. Tone: [formality]. 
      Stay consistent with the tone and direction already established in the conversation.
      Output ONLY the enhanced prompt text. No preamble, no explanation, no quotes."
   - Handle missing/undefined profile fields gracefully with sensible defaults

6. async enhancePrompt(originalPrompt, userProfile, dialogueHistory = [])
   - Gets API key
   - Creates Anthropic client
   - Calls client.messages.create() with:
       model: "claude-sonnet-4-20250514"
       max_tokens: 1000
       system: buildEnhancerSystemPrompt(userProfile)
       messages: [...dialogueHistory, { role: "user", content: originalPrompt }]
   - Returns response.content[0].text
   - On any error: calls handleAPIError(error), returns null

7. handleAPIError(error)
   - console.error("[PE background.js] API error:", error)
   - Returns null

8. Message routing — chrome.runtime.onMessage.addListener:
   On { type: "ENHANCE", promptText, dialogueHistory }:
     a. Run classifyPrompt(promptText, dialogueHistory)
     b. Send { type: "SHOW_SURVEY", missingFields } to all extension views 
        via chrome.runtime.sendMessage
     c. Store promptText and dialogueHistory in a local variable (pendingEnhancement)
        so we can use them when the profile arrives

   On { type: "PROFILE_READY", rawResponses }:
     a. Retrieve pendingEnhancement
     b. First map raw responses:
        const mappedProfile = await mapResponsesToProfile(rawResponses, pendingEnhancement.promptText)
     c. Run enhancePrompt(pendingEnhancement.promptText, mappedProfile, pendingEnhancement.dialogueHistory)
     d. If result is null → send { type: "INJECT", enhancedPrompt: pendingEnhancement.promptText, 
        warning: true } to the active tab
     e. If result is non-null → send { type: "INJECT", enhancedPrompt: result } to the active tab
     f. Also send { type: "SHOW_RESULT", enhancedPrompt: result || pendingEnhancement.promptText, 
        warning: result === null } to popup

9. chrome.action.onClicked.addListener:
   - Send { type: "TRIGGER" } to the active tab's content script via 
     chrome.tabs.sendMessage(tab.id, { type: "TRIGGER" })

After implementing, run: npm run build
Confirm no errors and that background.bundle.js is updated (check file size > 0).
Add "[PE background.js]" prefixed console.log to each major step.
```

---

## Phase 4 — popup.html + popup.js + styles.css (Survey UI)

### What this phase produces
A polished popup with a conditional MCQ survey, a result display area, and the full message-passing loop. This is the user-facing UI.

### Gate check before moving to Phase 5 (V2 / stretch)
- [ ] Open popup — it shows a neutral idle state
- [ ] Trigger the full flow end-to-end on a chat page
- [ ] Popup opens automatically (or shows survey when you click icon)
- [ ] Only the questions in `missingFields` are rendered (not all 6 every time)
- [ ] After survey submit, `{ type: "PROFILE_READY", rawResponses }` appears in service worker console
- [ ] Enhanced prompt appears in the popup result area
- [ ] "Use this prompt" button injects the text into the chat input field
- [ ] Second trigger on the same page (profile already stored): survey is skipped entirely

### Exact prompt for Claude Code

```
Role: You are a senior Chrome Extension engineer and UI developer implementing the 
popup layer for Phase 4 of a multi-phase build. Implement popup.html, popup.js, 
and styles.css. Use Vanilla JS only — no React, no framework.

Design direction: Clean, minimal, tool-like. Dark background (#0f0f11), white text, 
accent color #7c6ef2 (purple). Sharp corners on inputs, subtle glow on the primary 
button. Fixed width 360px. Think "professional dev tool", not "consumer app".
Reference the frontend-design skill aesthetic: intentional, not generic.

--- popup.html ---
Structure:
  - Header: extension name "Prompt Enhancer" + small gear icon (⚙) that reveals 
    an API key input field on click
  - #api-key-section (hidden by default): <input type="password"> for the API key 
    + "Save" button
  - #idle-state: shown when no enhancement is in progress. Text: "Click the icon 
    on a chat page to enhance your prompt."
  - #survey-section (hidden): dynamically rendered survey questions go here
  - #result-section (hidden): shows the enhanced prompt in a <pre> or <textarea>, 
    plus a "Use this prompt" button and an optional warning badge
  - <link rel="stylesheet" href="styles.css">
  - <script src="popup.js"></script>

--- popup.js ---
Implement these functions:

1. On DOMContentLoaded:
   - Load stored API key from chrome.storage.local; if present, pre-fill the input
   - Load stored profile from chrome.storage.local key "userProfile"
   - Show #idle-state

2. API key save:
   - On "Save" button click → chrome.storage.local.set({ anthropicKey: inputValue })
   - Show brief confirmation text

3. ALL_QUESTIONS definition (object, not array):
   {
     gradeLevel:  { label: "Grade level",        options: ["Elementary","Middle School","High School","College"] },
     subject:     { label: "Subject area",        options: ["English","History","Science","Math","Other"] },
     writingGoal: { label: "Writing goal",        options: ["Practice","Graded Assignment","Self-study"] },
     citations:   { label: "Citations",           options: ["None","Provided sources only","Independent research"] },
     length:      { label: "Target length",       options: ["Short paragraph","1–2 pages","3+ pages"] },
     formality:   { label: "Tone",                options: ["Casual","Academic"] }
   }

4. renderSurvey(missingFields)
   - Hides #idle-state, shows #survey-section
   - Clears #survey-section
   - For each fieldName in missingFields (only those in ALL_QUESTIONS):
       Renders a <fieldset> with a <legend> (the label) and radio buttons for each option
       Each radio: name=fieldName, value=option
   - Appends a "Enhance my prompt →" submit button

5. collectResponses()
   - Reads all checked radio inputs from #survey-section
   - Returns a plain object { fieldName: selectedValue, ... }

6. buildUserProfile(responses)
   - Returns { gradeLevel, subject, writingGoal, citations, length, formality }
   - Maps raw radio values directly (they're already human-readable)

7. mergeWithExistingProfile(newData, storedProfile = {})
   - Returns { ...storedProfile, ...newData } (new answers override stored)

8. On survey submit button click:
   - collectResponses()
   - buildUserProfile()
   - mergeWithExistingProfile() with chrome.storage.local "userProfile"
   - chrome.storage.local.set({ userProfile: mergedProfile })
   - chrome.runtime.sendMessage({ type: "PROFILE_READY", userProfile: mergedProfile })
   - Hide #survey-section, show a "Enhancing..." spinner in #result-section

9. chrome.runtime.onMessage listener:
   On { type: "SHOW_SURVEY", missingFields }:
     - Load stored profile from chrome.storage.local
     - If missingFields.length === 0 AND storedProfile exists:
         Send { type: "PROFILE_READY", userProfile: storedProfile } immediately
         Show "Enhancing..." in #result-section
     - Else: renderSurvey(missingFields)

   On { type: "SHOW_RESULT", enhancedPrompt, warning }:
     - Hide survey, show #result-section
     - Display enhancedPrompt in a <textarea readonly> (user can still copy it)
     - If warning === true: show a badge "⚠ API error — original prompt returned"
     - Show "Use this prompt" button

10. "Use this prompt" button click:
    - chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        chrome.tabs.sendMessage(tabs[0].id, { type: "INJECT", enhancedPrompt })
      })
    - Show brief "✓ Injected" confirmation

--- styles.css ---
Implement full styles for:
  - body: width 360px, dark background (#0f0f11), color #e8e8f0, font-family system-ui
  - header: flex row, space-between, border-bottom 1px solid #222
  - #survey-section fieldset: borderless, padding 8px 0, legend bold #a0a0c0
  - Radio buttons: custom styled (hide native, show pill buttons per option)
  - Submit button: background #7c6ef2, white text, full width, subtle glow on hover
  - #result-section textarea: dark bg #1a1a22, border 1px solid #333, full width, 
    min-height 120px, font-size 13px, color #e8e8f0
  - Warning badge: background #ff4444, small pill, white text
  - Spinner: CSS-only, centered

Make the design feel intentional and polished — not like a template.
```

---

## Phase 5 — End-to-End QA & API Key Wiring

### What this phase produces
A working extension you can demo. No new features — just fixing what breaks.

### Gate check (full demo checklist)
- [ ] Open `chrome://extensions`, reload extension
- [ ] Click ⚙ gear in popup, enter your Anthropic API key, click Save
- [ ] Open https://chat.openai.com or https://claude.ai
- [ ] Type a prompt in the chat input (e.g. "write an essay about the civil war")
- [ ] Click the Prompt Enhancer extension icon
- [ ] Survey appears with relevant questions
- [ ] Fill out survey, click "Enhance my prompt →"
- [ ] Popup shows "Enhancing..." then the rewritten prompt
- [ ] Click "Use this prompt" — the chat input field updates
- [ ] Repeat on the same page — survey is skipped, profile reused
- [ ] Kill your internet connection, try again — original prompt is returned with warning badge

### Exact prompt for Claude Code

```
Role: You are a senior Chrome Extension engineer doing QA and integration for 
Phase 5 of a multi-phase build. Do NOT add new features. Fix whatever is broken.

Run through this checklist and fix each issue you find:

1. MANIFEST CHECK
   Run: cat manifest.json
   Verify: service_worker points to background.bundle.js (not background.js).
   Verify: web_accessible_resources includes selectors.json.
   Fix any issues found.

2. BUILD CHECK
   Run: npm run build
   If errors: fix them. Common issues:
     - Import paths wrong for @anthropic-ai/sdk
     - esbuild platform/target flags need adjustment

3. MESSAGE ROUTING AUDIT
   Trace the full message flow on paper:
     content.js → ENHANCE → background.js
     background.js → SHOW_SURVEY → popup.js
    content.js → PROFILE_READY → background.js
     background.js → INJECT → content.js
     background.js → SHOW_RESULT → popup.js
   
   Verify each listener exists and matches the message type exactly (case-sensitive).
   Fix any missing listeners or typos.

4. INJECTION AUDIT (content.js → injectEnhancedPrompt)
   Test: does the chat input actually update when INJECT is received?
   Common fix needed: ChatGPT uses a contenteditable div — you may need to set
   document.execCommand('insertText', false, text) instead of .innerText = text
   for React to pick up the change. Add this fallback.

5. POPUP DISPLAY AUDIT
   Verify the popup window stays open during the full flow (Chrome closes it on 
   some interactions). If needed, use chrome.windows.create({ url: 'popup.html', 
   type: 'popup', width: 380, height: 520 }) from background.js instead of 
   relying on the default action popup.

6. After all fixes: npm run build, then provide a summary of every change made.
```

---

## Phase 6 (Stretch) — V2 Grammarly-Style Hover Badge

### What this phase produces
An inline `✨` badge anchored to detected input fields. No popup click needed.

### Gate check
- [ ] Type in a ChatGPT or Claude input field — badge appears after ~800ms
- [ ] Click the badge — enhancement flow runs without opening the popup
- [ ] Badge disappears after injection
- [ ] Page's own UI is not broken or shifted by the badge

### Exact prompt for Claude Code

```
Role: You are a senior Chrome Extension engineer implementing the V2 hover badge 
feature in content.js for Phase 6. This is additive — do not remove any existing 
Phase 2 code.

Add these functions to content.js:

1. debounce(fn, delay)
   Standard debounce utility, returns a debounced function.

2. showInlineHoverBadge(inputEl)
   - Creates a <div id="pe-badge"> if it doesn't already exist
   - Styles it: position absolute, z-index 9999, background #7c6ef2, color white,
     border-radius 4px, padding 4px 8px, font-size 12px, cursor pointer, 
     content "✨ Enhance"
   - Positions it using inputEl.getBoundingClientRect() + window.scrollY/X, 
     anchored to the bottom-right corner of the input
   - Appends to document.body
   - On click: removeHoverBadge(), then trigger the full ENHANCE flow 
     (captureUserPrompt + scrapePreviousDialogue + truncate + sendMessage ENHANCE)

3. removeHoverBadge()
   - Removes #pe-badge from DOM if present

4. attachKeystrokeListener(inputEl)
   - Attaches a debounced (800ms) 'input' event listener to inputEl
   - On fire: showInlineHoverBadge(inputEl)
   - Also attaches a 'blur' event that calls removeHoverBadge() after 300ms 
     (delay so click on badge registers before blur fires)

5. Init logic (run on DOMContentLoaded or immediate if document is already ready):
   - Poll every 1000ms for a valid input field using detectInputField()
   - When found, attachKeystrokeListener() to it
   - Stop polling once attached (use clearInterval)
   - Re-attach if the field is removed from DOM (check el.isConnected)

After implementing, run npm run build and verify no errors.
```

---

## Quick Reference: Message Types

| Sender | Receiver | Type | Payload |
|---|---|---|---|
| content.js | background.js | `ENHANCE` | `{ promptText, dialogueHistory }` |
| background.js | popup.js | `SHOW_SURVEY` | `{ missingFields }` |
| content.js | background.js | `PROFILE_READY` | `{ rawResponses }` |
| background.js | content.js | `INJECT` | `{ enhancedPrompt }` |
| background.js | popup.js | `SHOW_RESULT` | `{ enhancedPrompt, warning }` |
| background.js | content.js | `TRIGGER` | _(none)_ |

## Skills to install in Claude Code before you start

```bash
mkdir -p ~/.claude/skills

# Copy your local skills (already on this machine)
cp -r /mnt/skills/public/frontend-design ~/.claude/skills/
```

Then at the top of your Claude Code session, add:
```
/skills use frontend-design
```
This activates the design aesthetic guidance for the popup UI phase.
