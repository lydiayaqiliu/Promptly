// ── Section 1: DOM Utilities ──────────────────────────────────────────────────

let _selectorsCache = null;
async function getSelectorsForHost() {
  if (!_selectorsCache) {
    try {
      const res = await fetch(chrome.runtime.getURL('selectors.json'));
      _selectorsCache = await res.json();
    } catch {
      return null;
    }
  }
  return _selectorsCache[window.location.hostname] || null;
}

function safeTextContent(el) {
  try {
    return el.innerText;
  } catch {
    return '';
  }
}

async function scrapePreviousDialogue() {
  try {
    const selectors = await getSelectorsForHost();
    if (!selectors) return [];

    const userEls = Array.from(document.querySelectorAll(selectors.user));
    const assistantEls = Array.from(document.querySelectorAll(selectors.assistant));

    const messages = [
      ...userEls.map(el => ({ role: 'user', content: safeTextContent(el), el })),
      ...assistantEls.map(el => ({ role: 'assistant', content: safeTextContent(el), el })),
    ];

    // Sort by DOM order
    messages.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return messages.map(({ role, content }) => ({ role, content }));
  } catch {
    return [];
  }
}

function truncateDialogueHistory(messages, maxChars = 6000) {
  let total = messages.reduce((sum, m) => sum + m.content.length, 0);
  const result = [...messages];
  while (total > maxChars && result.length > 0) {
    const removed = result.shift();
    total -= removed.content.length;
  }
  return result;
}

function detectInputField() {
  const active = document.activeElement;
  if (active && (active.tagName === 'TEXTAREA' || active.contentEditable === 'true')) {
    return active;
  }
  return (
    document.querySelector('#prompt-textarea') ||
    document.querySelector("div[contenteditable='true']") ||
    null
  );
}

function captureUserPrompt() {
  const el = detectInputField();
  if (!el) return '';
  return el.value !== undefined ? el.value : (el.innerText || '');
}

function injectEnhancedPrompt(text) {
  const el = detectInputField();
  if (!el) return;

  if (el.tagName === 'TEXTAREA') {
    el.value = text;
  } else {
    el.focus();
    let inserted = false;
    try {
      document.execCommand('selectAll', false, null);
      inserted = document.execCommand('insertText', false, text);
    } catch {}
    if (!inserted) {
      el.innerText = text;
    }
  }

  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function saveProfile(profile) {
  chrome.storage.local.set({ userProfile: profile });
}

async function loadProfile() {
  const r = await chrome.storage.local.get('userProfile');
  return r.userProfile || {};
}

// ── Section 2: Floating Modal ─────────────────────────────────────────────────

const MODAL_CSS = `
  #pe-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: rgba(0,0,0,0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, sans-serif;
  }
  #pe-overlay[hidden] { display: none !important; }
  #pe-modal {
    background: #0f0f11;
    color: #e8e8f0;
    border-radius: 12px;
    border: 1px solid #2a2a3a;
    width: 380px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    padding: 20px;
    position: relative;
    box-shadow: 0 8px 40px rgba(0,0,0,0.6);
  }
  #pe-close {
    position: absolute;
    top: 12px;
    right: 14px;
    background: none;
    border: none;
    color: #666;
    font-size: 18px;
    cursor: pointer;
    line-height: 1;
    pointer-events: auto !important;
    z-index: 1;
  }
  #pe-close:hover { color: #e8e8f0; }
  #pe-settings-link {
    position: absolute;
    top: 13px;
    right: 38px;
    color: #555;
    font-size: 14px;
    text-decoration: none;
    pointer-events: auto !important;
    z-index: 1;
  }
  #pe-settings-link:hover { color: #e8e8f0; }
  #pe-header {
    font-size: 13px;
    font-weight: 500;
    color: #888;
    margin: 0 0 16px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  #pe-progress { text-align: center; padding: 16px 0; }
  .pe-spinner {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid #2a2a3a;
    border-top-color: #7c6ef2;
    animation: pe-spin 0.8s linear infinite;
    margin: 0 auto 12px;
  }
  @keyframes pe-spin { to { transform: rotate(360deg); } }
  #pe-progress-msg { color: #888; font-size: 13px; margin: 0; }
  #pe-round-badge {
    display: inline-block;
    background: #1e1a3a;
    color: #a89ef5;
    font-size: 11px;
    border-radius: 20px;
    padding: 3px 10px;
    margin-bottom: 8px;
  }
  #pe-round-reason {
    color: #888;
    font-size: 12px;
    font-style: italic;
    margin: 0 0 14px;
    line-height: 1.5;
  }
  .pe-question-block { margin-bottom: 14px; }
  .pe-question-label {
    font-size: 13px;
    font-weight: 500;
    color: #c8c8d8;
    margin: 0 0 8px;
  }
  .pe-options { display: flex; flex-wrap: wrap; gap: 6px; }
  .pe-option {
    display: inline-block;
    border: 1px solid #333;
    border-radius: 20px;
    padding: 5px 12px;
    font-size: 12px;
    color: #999;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    user-select: none;
  }
  .pe-option:hover { border-color: #555; color: #ccc; }
  .pe-option.pe-selected { background: #7c6ef2; border-color: #7c6ef2; color: white; }
  #pe-submit {
    width: 100%;
    margin-top: 10px;
    background: #7c6ef2;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 10px;
    font-size: 14px;
    cursor: pointer;
  }
  #pe-submit:hover { background: #6a5de0; }
  .pe-open-input {
    width: 100%;
    box-sizing: border-box;
    background: #1a1a22;
    border: 1px solid #2a2a3a;
    color: #e8e8f0;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }
  .pe-open-input:focus { border-color: #7c6ef2; }
  #pe-result-text {
    width: 100%;
    box-sizing: border-box;
    min-height: 120px;
    background: #1a1a22;
    border: 1px solid #2a2a3a;
    color: #e8e8f0;
    border-radius: 8px;
    padding: 10px;
    font-size: 13px;
    line-height: 1.6;
    resize: vertical;
    font-family: inherit;
  }
  #pe-warning {
    background: #3a1a1a;
    color: #ff8080;
    border: 1px solid #5a2a2a;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    margin: 8px 0;
  }
  #pe-use-btn {
    width: 100%;
    margin-top: 10px;
    background: #1e1e2a;
    color: #a89ef5;
    border: 1px solid #3a3060;
    border-radius: 8px;
    padding: 10px;
    font-size: 14px;
    cursor: pointer;
  }
  #pe-use-btn:hover { background: #2a2a3e; }
  #pe-injected-msg {
    text-align: center;
    color: #6fcf97;
    font-size: 12px;
    margin-top: 6px;
  }
`;

function injectModalStyles() {
  if (document.getElementById('pe-styles')) return;
  const style = document.createElement('style');
  style.id = 'pe-styles';
  style.textContent = MODAL_CSS;
  document.head.appendChild(style);
}

function createModal() {
  if (document.getElementById('pe-overlay')) return;
  injectModalStyles();

  const overlay = document.createElement('div');
  overlay.id = 'pe-overlay';
  overlay.innerHTML = `
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
  `;
  document.body.appendChild(overlay);

  document.getElementById('pe-close').addEventListener('click', closeModal);
  document.getElementById('pe-settings-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' });
  });
  // Click outside modal to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.getElementById('pe-submit').addEventListener('click', handleSurveySubmit);
  document.getElementById('pe-use-btn').addEventListener('click', handleUsePrompt);
}

function openModal() {
  createModal();
  document.getElementById('pe-overlay').hidden = false;
}

function closeModal() {
  const el = document.getElementById('pe-overlay');
  if (el) el.hidden = true;
}

function showModalSection(id) {
  ['pe-progress', 'pe-survey', 'pe-result'].forEach(sectionId => {
    document.getElementById(sectionId).hidden = (sectionId !== id);
  });
}

function showModalProgress(message) {
  openModal();
  showModalSection('pe-progress');
  document.getElementById('pe-progress-msg').textContent = message;
}

let currentQuestions = [];

function renderSurvey(questions, round, roundReason, maxRounds) {
  currentQuestions = questions;
  openModal();
  document.getElementById('pe-round-badge').textContent = 'Round ' + round + ' of ' + maxRounds;
  document.getElementById('pe-round-reason').textContent = roundReason;

  const container = document.getElementById('pe-questions');
  container.innerHTML = '';

  questions.forEach((q, qi) => {
    const block = document.createElement('div');
    block.className = 'pe-question-block';

    const label = document.createElement('p');
    label.className = 'pe-question-label';
    label.textContent = q.question;
    block.appendChild(label);

    const opts = document.createElement('div');
    opts.className = 'pe-options';

    (q.options || []).forEach(opt => {
      const pill = document.createElement('span');
      pill.className = 'pe-option';
      pill.textContent = opt;
      pill.dataset.qi = qi;
      pill.dataset.value = opt;
      pill.addEventListener('click', () => {
        opts.querySelectorAll('.pe-option').forEach(p => p.classList.remove('pe-selected'));
        pill.classList.add('pe-selected');
      });
      opts.appendChild(pill);
    });

    if ((q.options || []).length === 0) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'pe-open-input';
      input.dataset.qi = qi;
      input.placeholder = 'Your answer...';
      opts.appendChild(input);
    }

    block.appendChild(opts);
    container.appendChild(block);
  });

  showModalSection('pe-survey');
}

function collectModalResponses() {
  const responses = {};
  currentQuestions.forEach((q, qi) => {
    const sel = document.querySelector('.pe-option.pe-selected[data-qi="' + qi + '"]');
    if (sel) responses[q.question] = sel.dataset.value;
    const openInput = document.querySelector('.pe-open-input[data-qi="' + qi + '"]');
    if (openInput && openInput.value.trim()) responses[q.question] = openInput.value.trim();
  });
  return responses;
}

function handleSurveySubmit() {
  const rawResponses = collectModalResponses();
  if (Object.keys(rawResponses).length === 0) return;
  chrome.runtime.sendMessage({ type: 'PROFILE_READY', rawResponses }).catch(() => {});
  showModalProgress('Checking what we still need...');
}

function showModalResult(enhancedPrompt, warning, mergedProfile) {
  document.getElementById('pe-result-text').value = enhancedPrompt;
  document.getElementById('pe-warning').hidden = !warning;
  if (mergedProfile) saveProfile(mergedProfile);
  openModal();
  showModalSection('pe-result');
}

function handleUsePrompt() {
  const text = document.getElementById('pe-result-text').value;
  injectEnhancedPrompt(text);
  document.getElementById('pe-injected-msg').hidden = false;
  setTimeout(() => {
    const msg = document.getElementById('pe-injected-msg');
    if (msg) msg.hidden = true;
    closeModal();
  }, 1500);
}

// ── Section 3: Message Listener ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  console.log('[PE content.js] received message:', message.type);

  switch (message.type) {
    case 'TRIGGER':
      currentQuestions = [];
      Promise.all([captureUserPrompt(), scrapePreviousDialogue()])
        .then(([promptText, rawHistory]) => {
          const dialogueHistory = truncateDialogueHistory(rawHistory);
          showModalProgress('Evaluating your prompt...');
          chrome.runtime.sendMessage({ type: 'ENHANCE', promptText, dialogueHistory, userProfile: {} })
            .catch(() => {});
        })
        .catch(err => console.error('[PE content.js] TRIGGER setup failed:', err));
      break;

    case 'SHOW_PROGRESS':
      showModalProgress(message.message);
      break;

    case 'SHOW_SURVEY':
      renderSurvey(message.questions, message.round, message.roundReason, message.maxRounds);
      break;

    case 'SHOW_RESULT':
      showModalResult(message.enhancedPrompt, message.warning, message.userProfile);
      break;
  }
});
