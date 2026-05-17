import Anthropic from '@anthropic-ai/sdk'

// ━━━━━━━ STARTUP ━━━━━━━

let evaluationCriteriaPrompt = ''
let enhancementCriteriaPrompt = ''
let criteria = { minRounds: 1, maxRounds: 3 }
let activeTabId = null

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
    await restoreSessionState()
  } finally {
    criteriasReadyResolve()
  }
})()

// ━━━━━━━ SESSION STATE ━━━━━━━

let pendingSession = null
// { promptText, dialogueHistory, userProfile, surveyRound }

function mergeProfile(existing, incoming) { return { ...existing, ...incoming } }

// ━━━━━━━ HELPERS ━━━━━━━

async function getApiKey() {
  return (await chrome.storage.local.get('anthropicKey')).anthropicKey || null
}

function createClient(apiKey) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

function sendToContentScript(message) {
  chrome.tabs.sendMessage(activeTabId, message)
    .catch(e => console.warn('[PE background.js] content script unreachable:', e))
}

function sanitizeDialogueHistory(messages) {
  let start = 0
  while (start < messages.length && messages[start].role !== 'user') start++
  return messages.slice(start)
}

// ⚠ MV3-HARDENING: chrome.storage.session (Chrome 102+) persists pendingSession
// and activeTabId across service worker restarts within the same browser session.
// In-memory variables are the runtime source of truth; storage is the recovery source.
//
// How it works:
//   saveSessionState()    — call after any write to pendingSession or activeTabId
//   restoreSessionState() — called at startup inside the criteriasReady IIFE
//   clearSessionState()   — call instead of `pendingSession = null; activeTabId = null`
//
// Known edge case: if onClicked fires before restoreSessionState() resolves (i.e.,
// before criteriasReady), the in-memory pendingSession is null and the guard allows
// a new session. The ENHANCE handler then overwrites the stored session — intentional,
// the user's new click wins. restoreSessionState guards against overwriting an activeTabId
// set by a concurrent onClicked by checking `if (!activeTabId)` before restoring it.
//
// Debugging: if the modal freezes after a browser restart, open DevTools →
// Application → Storage → chrome.storage.session → inspect "pendingSession".
// Clear it manually to reset a stuck session.

async function saveSessionState() {
  if (pendingSession) {
    await chrome.storage.session.set({ pendingSession, activeTabId })
  }
}

async function restoreSessionState() {
  const r = await chrome.storage.session.get(['pendingSession', 'activeTabId'])
  if (r.pendingSession) {
    pendingSession = r.pendingSession
    if (!activeTabId) activeTabId = r.activeTabId || null
    console.log('[PE background.js] Session restored from storage.session')
  }
}

function parseJSON(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  try {
    return JSON.parse(stripped)
  } catch {
    // Model added prose before/after the JSON — extract the first {...} or [...]
    const match = stripped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (match) return JSON.parse(match[1])
    throw new SyntaxError('No JSON found in LLM response')
  }
}

async function clearSessionState() {
  pendingSession = null
  activeTabId = null
  await chrome.storage.session.remove(['pendingSession', 'activeTabId'])
}

// ━━━━━━━ EVALUATION ENGINE ━━━━━━━

async function seedProfileFromPrompt(promptText) {
  const apiKey = await getApiKey()
  if (!apiKey) return {}
  const client = createClient(apiKey)
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
  referenceCount      string  — number of sources required, e.g. "3", "5–7", "None", if mentioned
  readingList         string  — explicit titles of assigned or recommended readings listed in the prompt (e.g. full paper titles, book chapter names); omit if no specific titles are mentioned
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
    return parseJSON(response.content[0].text)
  } catch (e) {
    console.warn('[PE background.js] seedProfileFromPrompt error:', e)
    return {}
  }
}

async function evaluateProfileSufficiency(promptText, dialogueHistory, userProfile) {
  const apiKey = await getApiKey()
  if (!apiKey) {
    console.warn('[PE background.js] No API key')
    return { sufficient: true, missingContext: [], roundReason: '' }
  }
  const client = createClient(apiKey)
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: evaluationCriteriaPrompt,
      messages: [
        ...sanitizeDialogueHistory(dialogueHistory),
        { role: 'user', content: JSON.stringify({ promptText, userProfile }) }
      ]
    })
    return parseJSON(response.content[0].text)
    // Expected: { sufficient, missingContext, roundReason }
  } catch (e) {
    console.warn('[PE background.js] evaluateProfileSufficiency error:', e)
    return { sufficient: true, missingContext: [], roundReason: '' }
    // Fail-open: never block the user on a parse or API error
  }
}

async function generateSurveyQuestions(promptText, dialogueHistory, userProfile, missingContext) {
  const apiKey = await getApiKey()
  if (!apiKey) {
    console.warn('[PE background.js] No API key')
    return []
  }
  const client = createClient(apiKey)
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: evaluationCriteriaPrompt,
      messages: [
        ...sanitizeDialogueHistory(dialogueHistory),
        {
          role: 'user', content: JSON.stringify({
            task: 'generate_survey', promptText, userProfile, missingContext
          })
        }
      ]
    })
    return parseJSON(response.content[0].text)
    // Expected: [{ question, options }, ...]
  } catch (e) {
    console.error('[PE background.js] API error:', e)
    return []
  }
}

async function mapResponsesToProfile(rawResponses, promptText) {
  const apiKey = await getApiKey()
  if (!apiKey) return rawResponses
  const client = createClient(apiKey)
  const system = `You convert survey question-answer pairs into a canonical user profile JSON object.
Given a map of question→answer strings and the user's original prompt, return ONLY a compact JSON object.
You MUST use these exact field names as keys — no synonyms, no abbreviations:

  educationalLevel      — academic level (e.g. "undergraduate", "high school", "graduate", "PhD")
  topicAndDiscipline    — subject area and academic discipline
  taskDescription       — what the user is asked to do
  outputFormat          — required output format (e.g. "essay", "short answer", "LaTeX")
  materials             — course or topic context (e.g. "Econ 201 — Intro to Microeconomics")
  readingList           — assigned reading titles; "None" if none; "NeedsReference" if user needs to find sources
  referenceCount        — number of sources to cite (e.g. "None", "1–3", "4–6", "7 or more")
  userStance            — user's argument or position
  intentionalErrors     — "Yes" or "No"
  referenceRequirements — citation style or preference
  audience              — intended reader
  knowledgeProfile      — summary of what the user knows about the topic

Special rules:
- readingList "No" answer → "None"; "No, but I need to reference materials." → "NeedsReference"; typed titles → verbatim text
- materials "None — I have no specific course context" answer → "None"
- If an answer does not map to any field above, omit it.
No prose, no markdown fences, no explanation.`
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: JSON.stringify({ responses: rawResponses, promptText }) }]
    })
    return parseJSON(response.content[0].text)
  } catch (e) {
    console.warn('[PE background.js] mapResponsesToProfile failed — using raw responses:', e)
    return rawResponses
  }
}

// ━━━━━━━ ENHANCEMENT ━━━━━━━

async function enhancePrompt(promptText, userProfile, dialogueHistory) {
  const apiKey = await getApiKey()
  if (!apiKey) {
    console.warn('[PE background.js] No API key — cannot enhance')
    return null
  }
  const client = createClient(apiKey)
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: enhancementCriteriaPrompt,
      messages: [
        { role: 'user', content: JSON.stringify({ promptText, userProfile, dialogueHistory }) }
      ]
    })
    return response.content[0].text
  } catch (error) {
    console.error('[PE background.js] API error:', error)
    return null
  }
}

// ━━━━━━━ LOOP ADVANCEMENT ━━━━━━━

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
    await clearSessionState()

  } else {
    // Drop fields already captured in userProfile so they are never re-asked
    const profileKeys = new Set(Object.keys(pendingSession.userProfile))
    const filteredMissing = missingContext.filter(field => !profileKeys.has(field))
    const contextToAsk = filteredMissing.length > 0
      ? filteredMissing
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
      await clearSessionState()
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

// ━━━━━━━ MESSAGE-DRIVEN STATE MACHINE ━━━━━━━

chrome.action.onClicked.addListener((tab) => {
  if (pendingSession) return
  activeTabId = tab.id
  setTimeout(() => chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER' }).catch(() => {}), 300)
})

chrome.runtime.onMessage.addListener((message) => {
  ;(async () => {
    await criteriasReady
    switch (message.type) {

      case 'ENHANCE': {
        const { promptText, dialogueHistory, userProfile } = message
        const apiKey = await getApiKey()
        if (!apiKey) {
          sendToContentScript({ type: 'SHOW_ERROR', message: 'No API key set. Click the three vertical dots (More options) next to this extension, then click Options, and add your Anthropic API key.' })
          return
        }
        sendToContentScript({ type: 'SHOW_PROGRESS', message: 'Reading your prompt...' })
        const seededFields = await seedProfileFromPrompt(promptText)
        const seededProfile = mergeProfile(userProfile, seededFields)
        pendingSession = { promptText, dialogueHistory, userProfile: seededProfile, surveyRound: 0 }
        await saveSessionState()
        sendToContentScript({ type: 'SHOW_PROGRESS', message: 'Evaluating your prompt...' })
        const evalResult = await evaluateProfileSufficiency(promptText, dialogueHistory, seededProfile)
        console.log('[PE background.js] evalResult:', evalResult)
        await advanceLoop(evalResult)
        break
      }

      case 'PROFILE_READY': {
        if (!pendingSession) { console.warn('[PE background.js] PROFILE_READY with no session'); return }
        const mappedProfile = await mapResponsesToProfile(message.rawResponses, pendingSession.promptText)
        pendingSession.userProfile = mergeProfile(pendingSession.userProfile, mappedProfile)
        pendingSession.surveyRound++
        await saveSessionState()
        sendToContentScript({ type: 'SHOW_PROGRESS', message: 'Checking what we still need...' })
        const evalResult = await evaluateProfileSufficiency(
          pendingSession.promptText,
          pendingSession.dialogueHistory,
          pendingSession.userProfile
        )
        console.log('[PE background.js] evalResult:', evalResult)
        await advanceLoop(evalResult)
        break
      }

      case 'OPEN_SETTINGS': {
        chrome.runtime.openOptionsPage()
        break
      }

    }
  })().catch(e => console.error('[PE background.js] unhandled error in message handler:', e))
})
