// Extracted from index.html inline script and enhanced to remove inline handlers

// Inject html2canvas for client-side screenshot export
(function ensureHtml2Canvas() {
  if (!window.html2canvas) {
    const s = document.createElement('script');
    s.src = '/vendor/html2canvas.min.js';
    s.defer = true;
    document.head.appendChild(s);
  }
})();

const popup = document.getElementById('scale-popup');
let fadeTimeout;

// Core DOM references used throughout the script
const chatMessages = document.getElementById('chat-messages');

// Initialize WebSocket connection to the same host. Use wss when on https.
let ws = null;
try {
  const wsProtocol = (location.protocol === 'https:') ? 'wss:' : 'ws:';
  // connect to the same host; the server upgrades the connection
  const wsUrl = `${wsProtocol}//${location.host}`;
  ws = new WebSocket(wsUrl);
  ws.addEventListener('open', () => console.debug('WebSocket connected to', wsUrl));
  ws.addEventListener('error', (e) => console.error('WebSocket error', e));
} catch (e) {
  console.error('Failed to create WebSocket:', e);
}

function showPopup(element, message) {
  // Simple popup helper: ensure popup exists, set content, and auto-hide
  if (!popup) return;
  const contentEl = popup.querySelector('.popup-content') || popup;
  try {
      if (contentEl) contentEl.textContent = message || ''; 
  } catch (e) { /* ignore DOM issues */ }
  popup.classList.add('visible');
  if (fadeTimeout) clearTimeout(fadeTimeout);
  fadeTimeout = setTimeout(() => { if (popup) popup.classList.remove('visible'); }, 4500);
}
let session_id = null;
let __turingInitialMessageId = null; // for newly created turing sessions
let botMessageDiv = null;
let activeLevels = new Set();
let sessionFeedback = {}; // Object to store feedback for each session
// Mapping of user message elements to their feedback containers (used to manage margins and persistence)
const feedbackMapping = [];

window.onload = async () => {
  await loadGroups();
  const sessionButtons = document.querySelectorAll('.session-button');
  if (sessionButtons.length === 0) {
    startNewChat();
  } else {
    const mostRecentButton = sessionButtons[0];
    if (mostRecentButton) {
      const sessionId = mostRecentButton.id.replace('session-', '');
      loadSessionHistory(sessionId);
      highlightCurrentSession(sessionId);
    }
  }
};

// Minimal, safe markdown-ish renderer: escapes HTML, converts **bold** to <strong>,
// handles simple '###' headings to <h3>, and groups lines beginning with '- ' into <ul>/<li>.
function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderMarkdownToHtml(text) {
  if (!text) return '';
  // Split into lines but preserve empty lines; we'll treat empty lines as paragraph breaks.
  const lines = String(text).split(/\r?\n/);
  let out = '';
  let inList = false;

  // accumulate consecutive non-list lines into paragraphs
  let paragraphBuffer = [];
  function flushParagraph() {
    if (paragraphBuffer.length === 0) return;
    // Join with <br> to preserve single newlines inside a paragraph
    const joined = paragraphBuffer.join('<br>');
    out += `<p>${processInlineMarkdown(joined)}</p>`;
    paragraphBuffer = [];
  }

    try {
    for (let rawLine of lines) {
      const trimmed = rawLine.trim();
      if (trimmed === '---' || trimmed === '***') {
        if (inList) { out += '</ul>'; inList = false; }
        flushParagraph();
        out += '<hr/>';
        continue;
      }

      // Headings: convert lines starting with #.. to <hN>
      const hmatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (hmatch) {
        flushParagraph();
        const level = Math.min(6, hmatch[1].length);
        out += `<h${level}>${processInlineMarkdown(hmatch[2])}</h${level}>`;
        continue;
      }

      // If this line is empty (after trimming), treat as paragraph separator
      if (trimmed === '') {
        flushParagraph();
        continue;
      }

      // accumulate into paragraph (preserve original rawLine so we keep internal spacing)
      paragraphBuffer.push(rawLine);
    }
    flushParagraph();
  } catch (e) {
    console.error('Error rendering markdown:', e);
    return '';
  }

  if (inList) out += '</ul>';
  return out;

    function processInlineMarkdown(s) {
    // Preserve literal <br> tokens inside the text by temporarily replacing them
    const BR_TOKEN = '___HTML_BR_TOKEN___';
    let working = String(s).replace(/<br\s*\/?\s*>/gi, BR_TOKEN);
    let escaped = escapeHtml(working);
    // restore BR tokens back to actual <br>
    escaped = escaped.replace(new RegExp(BR_TOKEN, 'g'), '<br>');
    // Bold **text** or __text__ (multiline safe)
    escaped = escaped.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/__([\s\S]+?)__/g, '<strong>$1</strong>');
    // Italic *text* or _text_ (conservative)
    escaped = escaped.replace(/(^|\s)\*([^*]+?)\*(\s|$)/g, '$1<em>$2</em>$3');
    escaped = escaped.replace(/(^|\s)_([^_]+?)_(\s|$)/g, '$1<em>$2</em>$3');
    // Autolink
    escaped = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return escaped;
  }
}

// Sanitize HTML before inserting into the DOM.
// Uses DOMParser to walk the fragment and remove disallowed nodes and attributes.
// Whitelist tags and attributes; strip event handlers, <script>, <iframe>, <style>, and any
// href/src that start with javascript:, data:, or vbscript:.
// TEMPORARY: Disable client-side HTML sanitization to unblock Turing screenshot persistence
// WARNING: This bypasses XSS protections. Re-enable sanitization before production redeploy.
function sanitizeHtml(dirtyHtml) {
  // Return content as-is. Keep function signature for compatibility.
  return dirtyHtml ?? '';
}

// Sanitize an inline style attribute value by keeping only a safe set of
// CSS properties and rejecting dangerous constructs. Returns a cleaned
// style string or an empty string if nothing safe remains.
function sanitizeStyle(styleString) {
  // Return styles unchanged while sanitization is disabled.
  return typeof styleString === 'string' ? styleString : '';
}

ws.onmessage = (event) => {
  try {
    const message = JSON.parse(event.data);
    if (message.type === 'history') {
      if (Array.isArray(message.data)) {
        window.__lastFeedbackData = [];
        loadChatHistory(message.data);
      } else if (message.data && typeof message.data === 'object') {
        window.__lastFeedbackData = message.data.feedbackData || [];
        loadChatHistory(message.data.messages || []);
        if (message.data.scale_levels) updateScale(message.data.scale_levels);
      }
    } else if (message.type === 'assistant') {
      if (!botMessageDiv) {
        const row = document.createElement('div');
        row.className = 'message-row';
        botMessageDiv = document.createElement('div');
        botMessageDiv.className = 'message assistant with-feedback';
        botMessageDiv.dataset.messageId = 'streaming';
        // create content and overlay without inline style attributes to satisfy CSP
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        const overlayDiv = document.createElement('div');
        overlayDiv.className = 'message-assistant-overlay overlay-hidden';
        botMessageDiv.appendChild(contentDiv);
        botMessageDiv.appendChild(overlayDiv);
        row.appendChild(botMessageDiv);
        chatMessages.appendChild(row);
        // initialize streaming accumulator for robust rendering across chunks
        botMessageDiv._accumulatedRaw = '';
        botMessageDiv._visibleRaw = '';
        botMessageDiv._lastAppend = 0;
        botMessageDiv._renderTimer = null;
        botMessageDiv._format = null; // 'markdown' or 'html'
      }
  const contentDiv = botMessageDiv.querySelector('.message-content');
  if (!botMessageDiv._accumulatedRaw) botMessageDiv._accumulatedRaw = '';
  if (!botMessageDiv._visibleRaw) botMessageDiv._visibleRaw = '';
  // Determine format: prefer existing marker, otherwise use chunk hint
  if (!botMessageDiv._format) botMessageDiv._format = message.format || 'markdown';
  if (message.format === 'html') botMessageDiv._format = 'html';

  if (botMessageDiv._format === 'markdown') {
    // Append raw delta to buffer
    botMessageDiv._accumulatedRaw += (message.content || '');
    botMessageDiv._lastAppend = Date.now();

    // Start a render timer if not already running
    if (!botMessageDiv._renderTimer) {
      const CHUNK_SIZE = 24; // chars moved per tick
      const TICK_MS = 60; // render every 60ms for smoother streaming
      botMessageDiv._renderTimer = setInterval(() => {
        try {
          if (botMessageDiv._accumulatedRaw.length > 0) {
            // Move a chunk from accumulated to visible
            const take = botMessageDiv._accumulatedRaw.slice(0, CHUNK_SIZE);
            botMessageDiv._accumulatedRaw = botMessageDiv._accumulatedRaw.slice(take.length);
            botMessageDiv._visibleRaw += take;
            // Detect if the content actually contains HTML (including HTML-escaped tags)
            const maybeHtml = decodeHtmlEntities(botMessageDiv._visibleRaw);
            if (/<\w+[^>]*>/.test(maybeHtml)) {
              botMessageDiv._format = 'html';
              contentDiv.innerHTML = sanitizeHtml(maybeHtml);
            } else {
              // Render the visible subset (sanitize to avoid XSS)
              contentDiv.innerHTML = sanitizeHtml(renderMarkdownToHtml(botMessageDiv._visibleRaw));
            }
            chatMessages.scrollTop = chatMessages.scrollHeight;
          } else {
            // No buffered content; if no new data for a short while, stop the timer
              if (Date.now() - botMessageDiv._lastAppend > 300) {
              clearInterval(botMessageDiv._renderTimer);
              botMessageDiv._renderTimer = null;
              // Ensure final render includes any leftover visibleRaw (sanitized)
              const maybeHtmlFinal = decodeHtmlEntities(botMessageDiv._visibleRaw);
              if (/<\w+[^>]*>/.test(maybeHtmlFinal)) {
                botMessageDiv._format = 'html';
                contentDiv.innerHTML = sanitizeHtml(maybeHtmlFinal);
              } else {
                contentDiv.innerHTML = sanitizeHtml(renderMarkdownToHtml(botMessageDiv._visibleRaw));
              }
            }
          }
        } catch (e) {
          // on any render error, fallback to appending raw text
          const safe = escapeHtml(message.content || '').replace(/\n/g, '<br>');
          contentDiv.innerHTML += sanitizeHtml(safe);
        }
      }, TICK_MS);
    }
  } else if (botMessageDiv._format === 'html') {
    // HTML streaming: append chunk to accumulator and render sanitized HTML progressively
    botMessageDiv._accumulatedRaw += (message.content || '');
    botMessageDiv._lastAppend = Date.now();
    if (!botMessageDiv._renderTimer) {
      const CHUNK_SIZE = 128;
      const TICK_MS = 60;
      botMessageDiv._renderTimer = setInterval(() => {
        try {
          if (botMessageDiv._accumulatedRaw.length > 0) {
            const take = botMessageDiv._accumulatedRaw.slice(0, CHUNK_SIZE);
            botMessageDiv._accumulatedRaw = botMessageDiv._accumulatedRaw.slice(take.length);
            botMessageDiv._visibleRaw += take;
            contentDiv.innerHTML = sanitizeHtml(decodeHtmlEntities(botMessageDiv._visibleRaw));
            chatMessages.scrollTop = chatMessages.scrollHeight;
          } else {
            if (Date.now() - botMessageDiv._lastAppend > 300) {
              clearInterval(botMessageDiv._renderTimer);
              botMessageDiv._renderTimer = null;
              contentDiv.innerHTML = sanitizeHtml(decodeHtmlEntities(botMessageDiv._visibleRaw));
            }
          }
        } catch (e) {
          const safe = escapeHtml(message.content || '').replace(/\n/g, '<br>');
          contentDiv.innerHTML += sanitizeHtml(safe);
        }
      }, TICK_MS);
    }
  } else {
    // non-markdown, non-html fallback: append raw text safely
    const safe = escapeHtml(message.content || '').replace(/\n/g, '<br>');
    contentDiv.innerHTML += sanitizeHtml(safe);
  }
      chatMessages.scrollTop = chatMessages.scrollHeight;
    } else if (message.type === 'scale') {
      updateScale(message.data);
      // Do not auto-apply overlays in Turing mode (editable assistant seed)
      if (window.__isTuringFlag) return;
      if (message.data.some(level => level >= 3)) {
        const assistantMessages = document.querySelectorAll('.message.assistant');
        for (let i = assistantMessages.length - 1; i >= 0; i--) {
          const lastAssistant = assistantMessages[i];
          // Skip the special Turing seed placeholder
          if (lastAssistant.dataset && String(lastAssistant.dataset.messageId) === 'turing-seed') continue;
          if (!lastAssistant.querySelector('.message-assistant-overlay')) {
            const oldOverlay = lastAssistant.querySelector('.message-assistant-overlay');
            if (oldOverlay) oldOverlay.remove();
            const overlay = document.createElement('div');
            overlay.className = 'message-assistant-overlay overlay-shown';
            const span = document.createElement('span');
            span.textContent = 'Copying or directly using this response breaches academic integrity guidelines';
            const closeBtn = document.createElement('button');
            closeBtn.className = 'close-overlay-btn';
            closeBtn.title = 'Remove warning';
            closeBtn.innerHTML = '&times;';
            overlay.appendChild(span);
            overlay.appendChild(closeBtn);
            overlay.addEventListener('click', function(e) {
              e.stopPropagation();
              overlay.parentElement?.classList.remove('overlay-active');
              overlay.remove();
            });
            lastAssistant.classList.add('overlay-active');
            lastAssistant.classList.add('edit-locked');
            lastAssistant.appendChild(overlay);
            break;
          }
        }
      }
    } else if (message.type === 'feedback') {
      if (message.content) {
        const editMode = document.querySelector('.assistant-edit-mode');
        if (editMode) {
          showEditFeedbackPopup(message.content, editMode);
          try { applyTrafficLightsFromFeedback(message.content, editMode); } catch(_) {}
          try { showCriteriaClipboard(editMode, message.content); } catch(_) {}
        } else {
          displayFeedback(message.content, message.message_id);
        }
        console.log('Feedback updated:', message.content);
      } else {
        console.error('Feedback content is empty');
      }
    }
    else if (message.type === 'message-saved') {
      // Server notifies that a streamed assistant message was persisted with a DB id.
      const mid = message.message_id;
      if (mid) {
        // Prefer an element explicitly marked as streaming
        let el = chatMessages.querySelector('.message.assistant[data-message-id="streaming"]');
        if (!el) {
          // Fallback to the last assistant message that doesn't have a numeric id
          const assistants = Array.from(chatMessages.querySelectorAll('.message.assistant'));
          for (let i = assistants.length - 1; i >= 0; i--) {
            const a = assistants[i];
            const dm = a.dataset.messageId;
            if (!dm || dm === 'streaming' || Number.isNaN(parseInt(dm, 10))) {
              el = a;
              break;
            }
          }
        }
        if (el) el.dataset.messageId = String(mid);
      }
    }
  } catch (e) {
    console.error('Error parsing WebSocket message:', e);
  }
};

// Helper: Check if a message is the last assistant message in the session (DB-backed)
async function isLastAssistantMessageDB(messageId, sessionId) {
  try {
    const response = await fetch(`/messages?session_id=${sessionId}`);
    const data = await response.json();
    if (!data.success || !Array.isArray(data.messages)) return false;
    const assistantMessages = data.messages.filter(msg => msg.role === 'assistant');
    if (assistantMessages.length === 0) return false;
    const lastDbAssistantMessage = assistantMessages[assistantMessages.length - 1];
    return String(lastDbAssistantMessage.message_id) === messageId;
  } catch (e) {
    console.error('Error checking last assistant message from DB:', e);
    return false;
  }
}
function resizeInput(event) {
  const textarea = event.target;
  const max = parseInt(getComputedStyle(textarea).maxHeight || 0, 10) || 0;
  textarea.style.height = 'auto';
  const needed = textarea.scrollHeight;
  if (max && needed > max) {
    textarea.style.height = max + 'px';
    textarea.style.overflowY = 'auto';
    textarea.closest('.meta-container')?.classList.add('input-overflow');
  } else {
    textarea.style.height = needed + 'px';
    textarea.style.overflowY = 'hidden';
    textarea.closest('.meta-container')?.classList.remove('input-overflow');
  }
}

const pendingFeedbackMargins = new Map(); // legacy no-op

function createFeedbackContainer(feedback) {
  const template = document.getElementById('feedback-container-template');
  const feedbackContainer = template.cloneNode(true);
  // Remove the template id so CSS rule `#feedback-container-template { display:none }`
  // does not apply to the cloned instance. Also ensure it renders as a block element.
  try { feedbackContainer.removeAttribute('id'); } catch (_) {}
  feedbackContainer.style.display = '';
  feedbackContainer.classList.add('feedback-visible');
  feedbackContainer.classList.add('feedback-relative');
  feedbackContainer.querySelector('.feedback-message').textContent = feedback;
  feedbackContainer.addEventListener('click', function() {
    const feedbackText = this.querySelector('.feedback-message').textContent;
    setMessageInput(feedbackText);
  });
  return feedbackContainer;
}

// Decode basic HTML entities so server-stored `&lt;h1&gt;...` becomes real `<h1>`.
function decodeHtmlEntities(str) {
  try {
    if (str == null) return '';
    const txt = document.createElement('textarea');
    txt.innerHTML = String(str);
    return txt.value;
  } catch (_) {
    return String(str);
  }
}

function updateScale(levels) {
  if (!Array.isArray(levels)) levels = [levels];
  levels.forEach(level => activeLevels.add(level));
  document.querySelectorAll('.scale-item').forEach(item => {
    const level = parseInt(item.id.replace('scale-', ''), 10);
    if (activeLevels.has(level)) {
      item.classList.add('active');
      item.classList.remove('inactive');
    } else {
      item.classList.add('inactive');
      item.classList.remove('active');
    }
  });
}

function resetScale() {
  activeLevels.clear();
  document.querySelectorAll('.scale-item').forEach(item => {
    item.classList.add('inactive');
    item.classList.remove('active');
  });
}

function handleKeyPress(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

function sendMessage() {
  const input = document.getElementById('message-input');
  const message = input ? input.value : '';
  if (message.trim()) {
    // mark streaming container as new
    botMessageDiv = null;
    // Clear input immediately to give responsive feedback to the user
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }
    try {
      ws.send(JSON.stringify({ content: message, session_id })); 
    } catch (err) {
      console.error('WebSocket send failed:', err);
    }
    const userMessage = document.createElement('div');
    userMessage.className = 'message user';
    const previousMapping = feedbackMapping[feedbackMapping.length - 1];
    const hasFeedback = previousMapping && previousMapping.feedbackContainer && previousMapping.feedbackContainer.style.display !== 'none' && previousMapping.feedbackContainer.querySelector('.feedback-message') && previousMapping.feedbackContainer.querySelector('.feedback-message').textContent.trim() !== '';
    if (hasFeedback) setDynamicTopMargin(userMessage, previousMapping.feedbackContainer);
    userMessage.textContent = message;
    const oldPlaceholder = chatMessages.querySelector('.user.placeholder-message');
    if (oldPlaceholder) oldPlaceholder.remove();
    chatMessages.appendChild(userMessage);
    const feedbackContainer = createFeedbackContainer('');
    feedbackMapping.push({ messageElement: userMessage, feedbackContainer });
    chatMessages.scrollTop = chatMessages.scrollHeight;
    setTimeout(() => {
      if (input) {
        input.focus();
        try { input.setSelectionRange(0, 0); } catch (e) {}
      }
      const upArrowEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38, bubbles: true });
      if (input) input.dispatchEvent(upArrowEvent);
    }, 0);
  }
}

function setDynamicTopMargin(messageElement, previousFeedbackContainer) {
  if (!messageElement || !previousFeedbackContainer) return;
  const feedbackHeight = previousFeedbackContainer.offsetHeight;
  const marginValue = Math.max(0, feedbackHeight - 28.5);
  messageElement.style.marginTop = `${marginValue}px`;
}

function setDynamicMargin(messageElement, feedbackContainer) {
  if (!messageElement || !feedbackContainer) return;
  const feedbackHeight = feedbackContainer.offsetHeight;
  const marginValue = Math.max(0, feedbackHeight - 28.5);
  messageElement.style.marginBottom = `${marginValue}px`;
}

function displayFeedback(feedback, messageId = null) {
  let targetAssistant = null;
  if (messageId) targetAssistant = chatMessages.querySelector(`.message.assistant[data-message-id="${messageId}"]`);
  if (!targetAssistant) targetAssistant = Array.from(chatMessages.querySelectorAll('.message.assistant')).pop();
  if (!targetAssistant) return;
  if (messageId) targetAssistant.dataset.messageId = String(messageId);
  let row = targetAssistant.closest('.message-row');
  if (!row) { row = document.createElement('div'); row.className = 'message-row'; targetAssistant.replaceWith(row); row.appendChild(targetAssistant); }
  const feedbackContainer = createFeedbackContainer(feedback);
  row.appendChild(feedbackContainer);
  const overlay = targetAssistant.querySelector('.message-assistant-overlay');
  if (overlay) {
    overlay.classList.add('overlay-shown');
    overlay.innerHTML = `
      <span>Copying or directly using this response breaches academic integrity guidelines</span>
      <button class="close-overlay-btn" title="Remove warning">&times;</button>`;
    overlay.addEventListener('click', function(e){
      e.stopPropagation();
      overlay.classList.remove('overlay-shown');
      targetAssistant.classList.remove('overlay-active');
      const contentDiv = targetAssistant.querySelector('.message-content');
      if (contentDiv) { contentDiv.classList.remove('content-dim'); }
    });
    targetAssistant.classList.add('edit-locked');
    targetAssistant.classList.add('overlay-active');
  }
  saveFeedbackToServer(feedback, messageId || targetAssistant.dataset.messageId || null);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function ensureFeedbackVisible(_) { /* no-op in inline layout */ }

function showFeedbackForSavedSession(sessionId, feedbackData) {
  if (!feedbackData || feedbackData.length === 0) return;
  feedbackData.forEach(fb => {
    const assistant = chatMessages.querySelector(`.message.assistant[data-message-id="${fb.messageId}"]`);
    if (!assistant) return;
    let row = assistant.closest('.message-row');
    if (!row) { row = document.createElement('div'); row.className = 'message-row'; assistant.replaceWith(row); row.appendChild(assistant); }
    const feedbackContainer = createFeedbackContainer(fb.feedbackContent);
    row.appendChild(feedbackContainer);
    const overlay = assistant.querySelector('.message-assistant-overlay');
  if (overlay) { overlay.classList.add('overlay-shown'); assistant.classList.add('overlay-active'); }
    assistant.classList.add('edit-locked');
  });
}

async function loadChatHistory(messages) {
  chatMessages.innerHTML = '';
  const feedbackByMessageId = new Map();
  if (window.__lastFeedbackData && Array.isArray(window.__lastFeedbackData)) {
    window.__lastFeedbackData.forEach(fb => { if (fb.messageId) feedbackByMessageId.set(String(fb.messageId), fb); });
  }
  messages.forEach(msg => {
    if (msg.role === 'assistant') {
      const row = document.createElement('div'); row.className = 'message-row';
      const messageElement = document.createElement('div'); messageElement.classList.add('message', 'assistant');
      const shouldLock = (Number(msg.collapsed) === 1) || (Number(msg.scale_level) >= 3) || feedbackByMessageId.has(String(msg.message_id));
      if (shouldLock) messageElement.classList.add('edit-locked');
      messageElement.dataset.messageId = msg.message_id;
      const showOverlay = feedbackByMessageId.has(String(msg.message_id));
      if (showOverlay) messageElement.classList.add('overlay-active');
      // build content and overlay nodes without inline style attributes (CSP-safe)
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      try {
        contentDiv.innerHTML = sanitizeHtml(renderMarkdownToHtml(msg.content || '')); 
        // If historic content accidentally contains embedded footers, strip them
        removeEmbeddedTuringFooters(contentDiv);
      } catch (e) {
        const safe = escapeHtml(msg.content || '').replace(/\n/g,'<br>');
        contentDiv.innerHTML = sanitizeHtml(safe);
      }
      const overlayDiv = document.createElement('div');
      overlayDiv.className = 'message-assistant-overlay ' + (showOverlay ? 'overlay-shown' : 'overlay-hidden');
      messageElement.appendChild(contentDiv);
      messageElement.appendChild(overlayDiv);
      // If this message carries persisted references/prompts metadata, rehydrate a footer
      try {
        if (!msg.footer_removed) {
          const footerNode = buildFooterFromMessage(msg);
          if (footerNode) messageElement.appendChild(footerNode);
        }
      } catch (e) { /* best-effort */ }
      row.appendChild(messageElement);
      const fb = feedbackByMessageId.get(String(msg.message_id));
      if (fb) { const fbContainer = createFeedbackContainer(fb.feedbackContent); row.appendChild(fbContainer); }
      chatMessages.appendChild(row);
    } else {
      const row = document.createElement('div'); row.className = 'message-row user-row';
      const messageElement = document.createElement('div'); messageElement.classList.add('message','user');
      messageElement.dataset.messageId = msg.message_id;
  const safeUser = escapeHtml(msg.content || '').replace(/\n/g,'<br>');
  messageElement.innerHTML = `<div class=\"message-content\">${sanitizeHtml(safeUser)}</div>`;
      row.appendChild(messageElement);
      chatMessages.appendChild(row);
    }
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function loadSessions() {
  document.querySelectorAll('.session-list').forEach(list => list.innerHTML = '');
  document.getElementById('new-chats').innerHTML = '';
  const turingContainer = document.getElementById('turing-mode-container');
  if (turingContainer) turingContainer.innerHTML = '';
  try {
    const response = await fetch('/sessions');
    const data = await response.json();
    if (data.success) {
      data.sessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      data.sessions.forEach((session, index) => {
        if (Number(session.is_turing) === 1) {
          const btn = document.createElement('button');
          btn.className = 'session-button turing-session';
          const name = session.session_name || 'Turing Mode';
          btn.id = `session-${session.id}`;
          btn.innerHTML = `
            <div class="turing-left">
              <img class="turing-mode-icon" src="ChatGPT Image Oct 13, 2025, 01_56_50 PM.png" alt="">
              <span class="turing-name" contenteditable="true">${escapeHtml(name)}</span>
            </div>
            <span class="delete-icon" title="Delete">🗑</span>`;
          btn.onclick = () => {
            loadSessionHistory(session.id).then(() => {
              highlightCurrentSession(session.id);
              setTimeout(() => {
                const firstAssistant = document.querySelector('#chat-messages .message.assistant');
                if (firstAssistant && !firstAssistant.classList.contains('edit-locked')) firstAssistant.click();
              }, 50);
            });
          };
          btn.querySelector('.turing-name').addEventListener('blur', (e) => {
            const newName = (e.target.textContent || '').trim() || 'Turing Mode';
            renameSessionOnServer(session.id, newName);
          });
          const del = btn.querySelector('.delete-icon');
          del.onclick = (event) => { event.stopPropagation(); deleteSession(session.id, btn.parentElement.id); };
          turingContainer.appendChild(btn);
          return;
        }
        const button = document.createElement('button');
        button.className = 'session-button';
        // Label sessions using timestamp format: "Session : dd/yy/mm hh:mm" (24h)
        const label = formatSessionLabel(session.updated_at);
        button.textContent = label;
        button.id = `session-${session.id}`;
        button.draggable = true;
        button.ondragstart = drag;
        button.onclick = () => loadSessionHistory(session.id);
        const deleteIcon = document.createElement('span');
        deleteIcon.textContent = '🗑'; deleteIcon.className = 'delete-icon';
        deleteIcon.onclick = (event) => { event.stopPropagation(); deleteSession(session.id, button.parentElement.id); };
        button.appendChild(deleteIcon);
        if (session.group_id) {
          const groupList = document.getElementById(`session-list-group-${session.group_id}`);
          if (groupList) groupList.appendChild(button); else document.getElementById('new-chats').appendChild(button);
        } else {
          document.getElementById('new-chats').appendChild(button);
        }
      });
    } else {
      console.error('Failed to load sessions:', data.message);
    }
  } catch (error) {
    console.error('Error fetching sessions:', error);
  }
}

async function loadSessionHistory(sessionId) {
  hideAndStoreFeedback(session_id);
  session_id = sessionId;
  resetScale();
    highlightCurrentSession(sessionId); 
    const response = await fetch(`/messages?session_id=${sessionId}`);
    const data = await response.json();
    if (data.success) {
      chatMessages.innerHTML = '';
      const isTuring = Number(data.is_turing) === 1;
      window.__isTuringFlag = !!isTuring;
      const messagesWithFeedback = new Set();
      const feedbackByMessageId = new Map();
      if (!isTuring && data.feedbackData && data.feedbackData.length > 0) {
        data.feedbackData.forEach(feedback => { messagesWithFeedback.add(String(feedback.messageId)); feedbackByMessageId.set(String(feedback.messageId), feedback); });
      }
      let prevMsg = null;
      let prevAssistantHadFeedback = false;
      let prevAssistantFeedbackMargin = 0;
      const msgs = Array.isArray(data.messages) ? data.messages.slice() : [];
      if (isTuring) {
        const hasAssistant = msgs.some(m => m.role === 'assistant');
        if (!hasAssistant) msgs.push({ role: 'assistant', content: '', message_id: 'turing-seed', collapsed: 0, scale_level: 1 });
      }
      msgs.forEach((msg, idx) => {
        if (msg.role === 'user') {
          const userMessageDiv = document.createElement('div');
          userMessageDiv.className = 'message user';
          userMessageDiv.textContent = msg.content; userMessageDiv.dataset.messageId = msg.message_id;
          const fb = feedbackByMessageId.get(String(msg.message_id));
          let marginApplied = false;
          if (fb && typeof fb.feedbackMargin === 'number' && !isNaN(fb.feedbackMargin)) {
            userMessageDiv.style.marginTop = fb.feedbackMargin + 'px'; marginApplied = true;
          }
          if (!marginApplied && prevAssistantHadFeedback && typeof prevAssistantFeedbackMargin === 'number' && !isNaN(prevAssistantFeedbackMargin)) {
            userMessageDiv.style.marginTop = prevAssistantFeedbackMargin + 'px';
          }
          chatMessages.appendChild(userMessageDiv);
          setTimeout(() => { feedbackMapping.push({ messageElement: userMessageDiv, feedbackContainer: createFeedbackContainer('Feedback for session') }); }, 0);
        } else if (msg.role === 'assistant') {
          const assistantMessageDiv = document.createElement('div');
          assistantMessageDiv.className = 'message assistant with-feedback';
          // Mark the first assistant in a Turing session for special styling (non-sticky)
          if (isTuring && !document.querySelector('#chat-messages .message.assistant')) {
            assistantMessageDiv.classList.add('turing-message');
          }
          const shouldLock = isTuring ? false : ((Number(msg.collapsed) === 1) || (Number(msg.scale_level) >= 3) || messagesWithFeedback.has(String(msg.message_id)));
          if (shouldLock) assistantMessageDiv.classList.add('edit-locked');
          assistantMessageDiv.dataset.messageId = msg.message_id;
          const showOverlay = isTuring ? false : messagesWithFeedback.has(String(msg.message_id));
          if (showOverlay) assistantMessageDiv.classList.add('overlay-active');
          // Detect true HTML either directly or when stored HTML-escaped in DB
          const decodedCandidate = decodeHtmlEntities(msg.content || '');
          const __isHtml = /<\w+[^>]*>/.test(decodedCandidate);
          const contentDiv = document.createElement('div');
          contentDiv.className = 'message-content';
          try {
            if (__isHtml) contentDiv.innerHTML = sanitizeHtml(decodedCandidate || '');
            else contentDiv.innerHTML = sanitizeHtml(renderMarkdownToHtml(msg.content || ''));
            // Remove any accidentally embedded Turing footer from stored content
            removeEmbeddedTuringFooters(contentDiv);
          } catch (e) {
            const safe = escapeHtml(msg.content || '').replace(/\n/g,'<br>');
            contentDiv.innerHTML = sanitizeHtml(safe);
          }
          const overlay = document.createElement('div');
          overlay.className = 'message-assistant-overlay ' + (showOverlay ? 'overlay-shown' : 'overlay-hidden');
          const overlayText = document.createElement('span');
          overlayText.textContent = 'Copying or directly using this response breaches academic integrity guidelines';
          const closeBtn = document.createElement('button');
          closeBtn.className = 'close-overlay-btn';
          closeBtn.type = 'button';
          closeBtn.textContent = '×';
          overlay.appendChild(overlayText);
          overlay.appendChild(closeBtn);
          assistantMessageDiv.appendChild(contentDiv);
          assistantMessageDiv.appendChild(overlay);
          // Rehydrate persisted references/prompts if present
          try {
            if (!msg.footer_removed) {
              const footerNode = buildFooterFromMessage(msg);
              if (footerNode) assistantMessageDiv.appendChild(footerNode);
            }
          } catch (e) { /* ignore */ }
          if (closeBtn && overlay && contentDiv) {
            closeBtn.addEventListener('click', function(e) {
              e.stopPropagation(); overlay.classList.remove('overlay-shown'); overlay.classList.add('overlay-hidden'); assistantMessageDiv.classList.remove('overlay-active'); contentDiv.classList.remove('content-dim');
            });
            overlay.addEventListener('click', function(e){ e.stopPropagation(); overlay.classList.remove('overlay-shown'); overlay.classList.add('overlay-hidden'); assistantMessageDiv.classList.remove('overlay-active'); contentDiv.classList.remove('content-dim'); });
          }
          chatMessages.appendChild(assistantMessageDiv);
        }
        if (!isTuring && msg.role === 'assistant' && feedbackByMessageId.has(String(msg.message_id))) {
          prevAssistantHadFeedback = true; prevAssistantFeedbackMargin = feedbackByMessageId.get(String(msg.message_id)).feedbackMargin;
        } else { prevAssistantHadFeedback = false; prevAssistantFeedbackMargin = 0; }
        prevMsg = msg;
      });
      if (isTuring) {
        const firstAssistant = document.querySelector('#chat-messages .message.assistant');
        if (firstAssistant) setTimeout(() => { if (!firstAssistant.classList.contains('edit-locked')) firstAssistant.click(); }, 10);
        // Sticky positioning disabled: no special handling
      }
      const userMessages = chatMessages.querySelectorAll('.message.user');
      const lastUserMessage = userMessages[userMessages.length - 1];
      let lastUserFeedback = null; let lastUserScaleLevel = null;
      const lastMsg = data.messages[data.messages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        if (data.feedbackData && data.feedbackData.length > 0) lastUserFeedback = data.feedbackData.find(fb => String(fb.messageId) === String(lastMsg.message_id));
        lastUserScaleLevel = lastMsg.scale_level || 1;
      }
      if (lastUserMessage && lastUserFeedback && lastUserScaleLevel >= 3) lastUserMessage.style.marginBottom = '80px'; else if (lastUserMessage) lastUserMessage.style.marginBottom = '';
      chatMessages.scrollTop = chatMessages.scrollHeight;
      window.__lastFeedbackData = isTuring ? [] : (data.feedbackData || []);
      if (!isTuring && window.__lastFeedbackData.length) showFeedbackForSavedSession(sessionId, window.__lastFeedbackData);
      updateScale(data.scale_levels);
    } else {
      alert('Failed to load session history.');
    }
}

async function deleteSession(sessionId, parentElementId) {
  const response = await fetch(`/delete-session?session_id=${sessionId}`, { method: 'DELETE' });
  const data = await response.json();
  if (data.success) {
    const sessionButton = document.getElementById(`session-${sessionId}`);
    if (sessionButton) sessionButton.remove();
    const parentElement = document.getElementById(parentElementId);
    if (parentElement) parentElement.id = parentElementId;
    chatMessages.innerHTML = '';
  document.querySelectorAll('.feedback-container').forEach(container => { container.classList.add('hidden'); });
  } else {
    alert('Failed to delete the session.');
  }
}

async function startNewChat() {
  hideAndStoreFeedback(session_id);
  try {
    const response = await fetch('/start-session', { method: 'POST' });
    const data = await response.json();
    if (data.success) {
      session_id = data.session_id;
      // Ensure chatMessages element exists (fall back to querying DOM)
      const cm = chatMessages || document.getElementById('chat-messages');
      if (cm) cm.innerHTML = '';
      resetScale();
      addSessionButton(session_id);
      highlightCurrentSession(session_id);
    } else {
      alert('Failed to start a new session.');
    }
  } catch (error) { console.error('Error starting a new session:', error); }
}

function addSessionButton(sessionId) {
  const newChats = document.getElementById('new-chats');
  if (!newChats) { console.error('New chats container not found.'); return; }
  // If a button for this session already exists, don't create a duplicate.
  const existing = document.getElementById(`session-${sessionId}`);
  if (existing) {
    // Ensure it's placed in the new-chats container (or leave as-is) and return.
    if (existing.parentElement && existing.parentElement.id !== 'new-chats') {
      newChats.appendChild(existing);
    }
    return;
  }
  const button = document.createElement('button');
  button.className = 'session-button';
  // Label new sessions using current timestamp in 24h format
  button.textContent = formatSessionLabel(Date.now());
  button.id = `session-${sessionId}`;
  button.draggable = true; button.ondragstart = drag; button.onclick = () => loadSessionHistory(sessionId);
  const deleteIcon = document.createElement('span'); deleteIcon.textContent = '🗑'; deleteIcon.className = 'delete-icon';
  deleteIcon.onclick = (event) => { event.stopPropagation(); deleteSession(sessionId, button.parentElement.id); };
  button.appendChild(deleteIcon);
  newChats.appendChild(button);
}

// Format: "Session : dd/yy/mm hh:mm" with a 24-hour clock
function formatSessionLabel(ts) {
  let d;
  try { d = new Date(ts); } catch (_) { d = new Date(); }
  if (isNaN(d.getTime())) d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `Session : ${dd}/${yy}/${mm} ${hh}:${min}`;
}

async function startTuringMode() {
  try {
    const res = await fetch('/start-turing', { method: 'POST' });
    const data = await res.json();
    if (!data.success) { alert('Failed to start Turing Mode'); return; }
    session_id = data.session_id; __turingInitialMessageId = data.message_id || null;
    await loadSessions();
    highlightCurrentSession(session_id);
    await loadSessionHistory(session_id);
    setTimeout(() => {
      const firstAssistant = document.querySelector('#chat-messages .message.assistant');
      if (firstAssistant) {
        if (!firstAssistant.dataset.messageId && __turingInitialMessageId) firstAssistant.dataset.messageId = String(__turingInitialMessageId);
        if (!firstAssistant.classList.contains('edit-locked')) firstAssistant.click();
      }
    }, 50);
  } catch (e) { console.error('Error starting Turing Mode:', e); }
}

function renameSessionOnServer(id, name) {
  fetch('/rename-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: id, session_name: name }) })
    .then(r => r.json()).then(d => { if (!d.success) console.error('Failed to rename session:', d.message); })
    .catch(err => console.error('Rename session error:', err));
}

window.addEventListener('beforeunload', () => { if (session_id) hideAndStoreFeedback(session_id); });

function saveFeedbackToServer(feedbackContent, message_id = null) {
  fetch('/save-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id, feedbackContent, message_id }) })
    .then(r => r.json()).then(data => { if (!data.success) console.error('Failed to save feedback:', data.message); })
    .catch(err => console.error('Error saving feedback:', err));
}

function hideAndStoreFeedback(sessionId) {
  if (!sessionId) return;
  const feedbackContainers = document.querySelectorAll('.feedback-container');
  sessionFeedback[sessionId] = [];
    feedbackContainers.forEach(container => {
    sessionFeedback[sessionId].push({ content: container.querySelector('.feedback-message').textContent });
    container.classList.add('hidden');
  });
}

const text = '[SDC Turing Tutor]';
let index = 0; const defaultSpeed = 150; const scaleSpeed = 40; let animating = false;
function isAnimating() { return animating; }
function typeWriter(elementId, text, speed, callback) {
  let i = 0; animating = true;
  const targetEl = document.getElementById(elementId);
  if (!targetEl) {
    console.warn(`typeWriter: element with id "${elementId}" not found`);
    animating = false;
    if (callback) callback();
    return;
  }
  function type() {
    if (i < text.length) { targetEl.textContent += text.charAt(i); i++; setTimeout(type, speed); }
    else { animating = false; if (callback) callback(); }
  }
  type();
}

typeWriter('animated-text', text, defaultSpeed);

const scaleDescriptions = {
  'scale-1': 'This represents tasks or processes that are done entirely by humans without any AI involvement.',
  'scale-2': 'AI is used to generate ideas or structure content, but the primary content creation is still human-driven.',
  'scale-3': 'AI is used to assist with editing or refining content that has been primarily generated by a human.',
  'scale-4': 'Both AI and humans are involved in creating and evaluating the content.',
  'scale-5': 'The AI is fully responsible for the task or process with little to no human intervention.'
};

document.querySelectorAll('.scale-item').forEach(item => {
  let hoverTimeout;
  item.addEventListener('mouseover', () => {
    hoverTimeout = setTimeout(() => {
      if (!isAnimating()) {
        const description = scaleDescriptions[item.id];
        const wasActiveBeforeHover = item.classList.contains('active');
  const animatedEl = document.getElementById('animated-text');
  if (animatedEl) animatedEl.textContent = '';
          document.querySelectorAll('.scale-item').forEach(i => i.classList.add('no-pointer'));
        item.classList.add('active');
        typeWriter('animated-text', description, scaleSpeed, () => {
          setTimeout(() => {
            const animatedEl2 = document.getElementById('animated-text');
            if (animatedEl2) {
              animatedEl2.textContent = '';
              typeWriter('animated-text', text, defaultSpeed);
            } else {
              // If the element is gone, ensure we re-enable pointer events
              document.querySelectorAll('.scale-item').forEach(i => i.classList.remove('no-pointer'));
            }
            document.querySelectorAll('.scale-item').forEach(i => i.classList.remove('no-pointer'));
            if (!wasActiveBeforeHover) item.classList.remove('active');
          }, 3500);
        });
      }
    }, 500);
  });
  item.addEventListener('mouseout', () => { clearTimeout(hoverTimeout); });
});

function allowDrop(event) { event.preventDefault(); }

function createNewGroup() {
  const popupContainer = document.createElement('div');
  popupContainer.className = 'popup-container popup-modal';
  const heading = document.createElement('h3'); heading.textContent = 'Create a New Group'; heading.classList.add('no-top-margin'); popupContainer.appendChild(heading);
  const form = document.createElement('form');
  form.onsubmit = (e) => {
    e.preventDefault();
    const groupNameInput = document.getElementById('group-name-input');
    const groupName = groupNameInput.value.trim();
    if (groupName) {
      fetch('/create-group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_name: groupName }) })
        .then(response => response.json()).then(data => {
          if (data.success) { createGroupInUI(data.group_id, groupName); document.body.removeChild(popupContainer); }
          else { const p = document.createElement('p'); p.textContent = 'Error: ' + data.message; p.classList.add('error-text'); form.appendChild(p); }
        }).catch(error => { console.error('Error creating group:', error); const p = document.createElement('p'); p.textContent = 'Error creating group. Please try again.'; p.classList.add('error-text'); form.appendChild(p); });
    } else { const p = document.createElement('p'); p.textContent = 'Please enter a group name.'; p.style.color = 'red'; form.appendChild(p); }
  };
  const inputDiv = document.createElement('div'); inputDiv.classList.add('form-row');
  const label = document.createElement('label'); label.setAttribute('for', 'group-name-input'); label.textContent = 'Group Name:'; label.classList.add('form-label');
  const input = document.createElement('input'); input.type = 'text'; input.id = 'group-name-input'; input.placeholder = `Group ${document.querySelectorAll('.session-group').length + 1}`; input.classList.add('form-input');
  inputDiv.appendChild(label); inputDiv.appendChild(input); form.appendChild(inputDiv);
  const buttonContainer = document.createElement('div'); buttonContainer.classList.add('form-actions');
  const createButton = document.createElement('button'); createButton.type = 'submit'; createButton.textContent = 'Create Group'; createButton.classList.add('btn', 'btn-primary');
  const cancelButton = document.createElement('button'); cancelButton.type = 'button'; cancelButton.textContent = 'Cancel'; cancelButton.classList.add('btn', 'btn-cancel');
  cancelButton.onclick = () => { document.body.removeChild(popupContainer); };
  buttonContainer.appendChild(cancelButton); buttonContainer.appendChild(createButton); form.appendChild(buttonContainer); popupContainer.appendChild(form); document.body.appendChild(popupContainer);
  setTimeout(() => { input.focus(); }, 0);
}

function createGroup() {
  const groupName = prompt('Enter name for new group:', `Group ${document.querySelectorAll('.session-group').length + 1}`);
  if (groupName && groupName.trim()) {
    fetch('/create-group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_name: groupName }) })
      .then(response => response.json()).then(data => { if (data.success) createGroupInUI(data.group_id, groupName); else alert('Failed to create group: ' + data.message); })
      .catch(error => { console.error('Error creating group:', error); alert('Error creating group'); });
  }
}

function createGroupInUI(groupId, groupName) {
  const groupDiv = document.createElement('div'); groupDiv.className = 'session-group'; groupDiv.id = `group-${groupId}`; groupDiv.ondrop = drop; groupDiv.ondragover = allowDrop;
  const groupHeader = document.createElement('div'); groupHeader.className = 'group-header';
  const groupTitle = document.createElement('h4'); groupTitle.contentEditable = true; groupTitle.onblur = () => renameGroup(groupTitle, groupId); groupTitle.textContent = groupName; groupTitle.onclick = () => toggleGroup(groupTitle);
  const deleteIcon = document.createElement('span'); deleteIcon.textContent = '🗑'; deleteIcon.className = 'delete-icon'; deleteIcon.onclick = (event) => { event.stopPropagation(); deleteGroupHandler(groupId); };
  groupHeader.appendChild(groupTitle); groupHeader.appendChild(deleteIcon);
  const sessionListDiv = document.createElement('div'); sessionListDiv.className = 'session-list'; sessionListDiv.id = `session-list-group-${groupId}`;
  groupDiv.appendChild(groupHeader); groupDiv.appendChild(sessionListDiv);
  document.getElementById('session-groups').appendChild(groupDiv);
}

function deleteGroupHandler(groupId) {
  if (confirm('Are you sure you want to delete this group? Sessions will be preserved but ungrouped.')) {
    fetch(`/delete-group?group_id=${groupId}`, { method: 'DELETE' })
      .then(response => response.json()).then(data => {
        if (data.success) {
          const groupElement = document.getElementById(`group-${groupId}`);
          if (groupElement) {
            const sessions = groupElement.querySelectorAll('.session-button');
            const newChats = document.getElementById('new-chats');
            sessions.forEach(session => { newChats.appendChild(session); });
            groupElement.remove();
          }
        } else { alert('Failed to delete group: ' + data.message); }
      }).catch(error => { console.error('Error deleting group:', error); alert('Error deleting group'); });
  }
}

function renameGroup(element, groupId) {
  const newName = element.textContent.trim();
  if (!newName) element.textContent = 'Unnamed Group';
  fetch('/rename-group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_id: groupId, group_name: newName || 'Unnamed Group' }) })
    .then(response => { if (!response.ok) throw new Error(`Server returned ${response.status}: ${response.statusText}`); return response.json(); })
    .then(data => { if (!data.success) console.error('Failed to rename group:', data.message); })
    .catch(error => { console.error('Error renaming group:', error); alert('Failed to save group name. Please try again.'); });
}

function toggleGroup(element) {
  const groupHeader = element.parentElement; const sessionList = groupHeader.nextElementSibling || element.nextElementSibling;
  if (sessionList && sessionList.classList.contains('session-list')) {
    sessionList.style.display = (sessionList.style.display === 'none') ? 'block' : 'none';
  }
}

function drag(event) {
  const sessionId = event.target.id.replace('session-', '');
  event.dataTransfer.setData('text', event.target.id);
  event.dataTransfer.setData('sessionId', sessionId);
}

function drop(event) {
  event.preventDefault();
  const sessionButtonId = event.dataTransfer.getData('text');
  const sessionId = event.dataTransfer.getData('sessionId');
  const sessionButton = document.getElementById(sessionButtonId);
  let targetGroup = event.target;
  while (targetGroup && !targetGroup.classList.contains('session-list') && !targetGroup.classList.contains('session-group')) targetGroup = targetGroup.parentElement;
  if (!targetGroup) return;
  if (targetGroup.classList.contains('session-group')) targetGroup = targetGroup.querySelector('.session-list');
  if (!targetGroup) return;
  const groupId = targetGroup.id.replace('session-list-group-', '');
  targetGroup.appendChild(sessionButton);
  fetch('/update-session-group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId, group_id: groupId === 'new-chats' ? null : groupId }) })
    .then(response => response.json()).then(data => { if (!data.success) console.error('Failed to update session group:', data.message); })
    .catch(error => { console.error('Error updating session group:', error); });
}

async function loadGroups() {
  try {
    const response = await fetch('/groups');
    const data = await response.json();
    if (data.success) {
      document.getElementById('session-groups').innerHTML = '';
      data.groups.forEach(group => { createGroupInUI(group.id, group.group_name); });
      loadSessions();
    } else { console.error('Failed to load groups:', data.message); }
  } catch (error) { console.error('Error fetching groups:', error); }
}

function setMessageInput(text) {
  const input = document.getElementById('message-input');
  if (!input) return;
  input.value = text;
  // Focus the input and place the caret at the end of the inserted text so the
  // user can continue typing immediately. Use a small timeout to ensure the
  // browser has processed focus (helps on some mobile browsers).
  input.focus();
  try {
    const len = input.value.length;
    // set selection to the end
    input.setSelectionRange(len, len);
  } catch (e) {
    // Some older browsers or inputs might not support setSelectionRange; ignore.
  }
}

function showPromptPopup(type) {
  const popup = document.getElementById('prompt-popup');
  const overlay = document.getElementById('popup-overlay');
  const content = popup ? popup.querySelector('.popup-content') : null;
  const promptContent = document.getElementById('prompt-content');
  if (!popup || !overlay || !content || !promptContent) {
    console.warn('showPromptPopup: required DOM nodes missing', { popup: !!popup, overlay: !!overlay, content: !!content, promptContent: !!promptContent });
    return;
  }
  content.querySelectorAll('.close-button').forEach(btn => btn.remove());
  promptContent.innerHTML = '';
  const closeBtn = document.createElement('span');
  closeBtn.className = 'close-button';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', hidePromptPopup);
  content.prepend(closeBtn);
  const h4 = document.createElement('h4');
  const ul = document.createElement('ul');
  const addPrompt = (label) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.textContent = label + (label.endsWith('...') ? '' : ' ...');
    b.addEventListener('click', () => {
      // insert prompt into chat input and close the prompt popup so the user
      // immediately sees the prompt in the chat area
      setMessageInput(label);
      hidePromptPopup();
    });
    li.appendChild(b);
    ul.appendChild(li);
  };
  if (type === 'research') {
    h4.textContent = 'Research Prompts';
    addPrompt('Find me a highly cited reference about');
    addPrompt('What are the latest trends in');
    addPrompt('Provide a summary of recent studies on');
  } else if (type === 'editing') {
    h4.textContent = 'Editing Prompts';
    addPrompt('Suggest tonal changes e.g. Avoid writing in the 1st person');
    addPrompt('Check for grammatical errors in this text');
    addPrompt('Improve the clarity of this paragraph');
  } else if (type === 'drafting') {
    h4.textContent = 'Drafting Prompts';
    addPrompt('Mark this essay against these specific criteria');
    addPrompt('Provide an outline for an essay on');
    addPrompt('Generate a draft introduction for a paper on');
  }
  promptContent.appendChild(h4);
  promptContent.appendChild(ul);
  // Use classes rather than inline styles so CSS rules are respected
  popup.classList.add('visible');
  overlay.classList.add('visible');
}

function hidePromptPopup() {
  const popup = document.getElementById('prompt-popup');
  const overlay = document.getElementById('popup-overlay');
  if (popup) popup.classList.remove('visible');
  if (overlay) overlay.classList.remove('visible');
}

function showChatGPTReferencePopup() {
  const now = new Date();
  const day = now.getDate();
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June','July', 'August', 'September', 'October', 'November', 'December'];
  const month = monthNames[now.getMonth()];
  const year = now.getFullYear();
  const formattedDate = `${day} ${month} ${year}`;
  const droppedPrompt = (window.__lastDroppedPromptText || '').trim();
  const safePrompt = droppedPrompt ? droppedPrompt.replace(/\s+/g, ' ').slice(0, 2000) : '';
  const promptLine = droppedPrompt ? ` Response generated to the prompt: "${safePrompt}".` : '';
  const reference = `OpenAI (2025) ChatGPT [AI language model].${promptLine} Available at: https://chat.openai.com/ (Accessed: ${formattedDate}).`;
  const refEl = document.getElementById('reference-content');
  const popup = document.getElementById('reference-popup');
  const overlay = document.getElementById('popup-overlay');
  if (!refEl || !popup || !overlay) {
    console.warn('showChatGPTReferencePopup: missing DOM elements', { referenceContent: !!refEl, popup: !!popup, overlay: !!overlay });
    // still copy reference to clipboard even if UI popup is absent
    navigator.clipboard.writeText(reference).catch(err => console.error('Error copying reference:', err));
    return;
  }
  refEl.textContent = reference;
  popup.classList.add('visible');
  overlay.classList.add('visible');
  navigator.clipboard.writeText(reference).catch(err => console.error('Error copying reference:', err));
  setupReferenceImageActions();
}

function hideReferencePopup() {
  const popup = document.getElementById('reference-popup'); if (popup) popup.classList.remove('visible');
  const overlay = document.getElementById('popup-overlay'); if (overlay) overlay.classList.remove('visible');
}

const chatgptRefBtn = document.querySelector('.create-reference-button');
if (chatgptRefBtn) {
  chatgptRefBtn.onclick = showChatGPTReferencePopup;
  chatgptRefBtn.onmouseover = null;
  (function enablePromptDragToReference() {
    const chatMessagesEl = document.getElementById('chat-messages'); if (!chatMessagesEl) return;
    function armDraggable(el) {
      if (!el || el.__armedDrag) return; el.__armedDrag = true; el.setAttribute('draggable', 'true');
      el.addEventListener('dragstart', (e) => {
        const txt = (el.innerText || el.textContent || '').trim();
        try {
          e.dataTransfer.setData('text/plain', txt);
          e.dataTransfer.effectAllowed = 'copy';
        } catch (_) {
          // ignore if dataTransfer is not writable in some browsers/environments
        }
        window.__lastDraggedPromptElement = el;
        try {
          // Preferred: render drag image onto an off-screen canvas to avoid
          // injecting visible DOM nodes that can leak text into the layout.
          const rect = el.getBoundingClientRect();
          const DPR = window.devicePixelRatio || 1;
          const cs = getComputedStyle(el);
          // derive font properties from the element so the drag image matches
          const fontSizeRaw = parseFloat(cs.fontSize) || 14;
          const fontSize = fontSizeRaw * DPR;
          const fontFamily = cs.fontFamily || 'system-ui, -apple-system, Roboto, Arial';
          const fontWeight = cs.fontWeight || '400';
          const lineHeightRaw = cs.lineHeight === 'normal' ? Math.round(fontSizeRaw * 1.25) : parseFloat(cs.lineHeight) || Math.round(fontSizeRaw * 1.25);
          const lineHeight = Math.round(lineHeightRaw * DPR);
          const padLeft = parseFloat(cs.paddingLeft) || parseFloat(cs.padding) || 12;
          const padTop = parseFloat(cs.paddingTop) || parseFloat(cs.padding) || 8;
          // use CSS pixel padding when drawing; ctx is scaled by DPR
          const paddingX_css = padLeft;
          const paddingY_css = padTop;
          // width should match the source element width where possible, clamped to a sane max
          const maxCssWidth = 360; // mirror CSS .drag-ghost max-width
          const cssWidth = Math.max(40, Math.min(maxCssWidth, Math.round(rect.width || maxCssWidth)));
          const maxTextWidth = Math.max(8, cssWidth - paddingX_css * 2);
          const text = (txt || '').replace(/\n/g, ' ');
          // measure and wrap text into lines that fit maxTextWidth
          const measureCanvas = document.createElement('canvas');
          const mctx = measureCanvas.getContext('2d');
          mctx.font = `${fontWeight} ${fontSizeRaw}px ${fontFamily}`;
          function wrapText(ctx, str, maxW) {
            const words = String(str).split(' ');
            const lines = [];
            let current = '';
            for (let w of words) {
              const test = current ? (current + ' ' + w) : w;
              if (ctx.measureText(test).width <= maxW) {
                current = test;
              } else {
                if (current) lines.push(current); current = w;
              }
            }
            if (current) lines.push(current);
            return lines;
          }
          const lines = wrapText(mctx, text, maxTextWidth);
          // canvas sizing: use CSS pixel sizes then scale for DPR so the
          // visual size matches the source element (avoids oversized ghosts)
          /* cssWidth computed above */
          const cssHeight = Math.max(1, Math.round(lineHeightRaw * lines.length + paddingY_css * 2));
          const canvas = document.createElement('canvas');
          canvas.width = cssWidth * DPR;
          canvas.height = cssHeight * DPR;
          // ensure the canvas displays at CSS pixel size when appended
          canvas.style.width = cssWidth + 'px';
          canvas.style.height = cssHeight + 'px';
          const ctx = canvas.getContext('2d');
          // scale drawing operations so we can use CSS pixel units below
          ctx.scale(DPR, DPR);
          // draw background rounded rect using CSS units
          ctx.fillStyle = cs.backgroundColor && cs.backgroundColor !== 'transparent' ? cs.backgroundColor : '#007bff';
          roundRect(ctx, 0, 0, cssWidth, cssHeight, (parseFloat(cs.borderRadius) || 12));
          ctx.fill();
          // draw text lines (use CSS font size)
          ctx.fillStyle = (cs.color && cs.color !== 'transparent') ? cs.color : '#ffffff';
          ctx.font = `${fontWeight} ${fontSizeRaw}px ${fontFamily}`;
          ctx.textBaseline = 'top';
          const textX = paddingX_css;
          let y = paddingY_css;
          const available = cssWidth - paddingX_css * 2;
          for (let line of lines) {
            // defensive measure: truncate if a single word exceeds width
            if (ctx.measureText(line).width > available) line = truncateTextToWidth(ctx, line, available);
            ctx.fillText(line, textX, y);
            y += lineHeightRaw;
          }
          const offsetX = Math.round(cssWidth / 2);
          const offsetY = Math.round(cssHeight / 2);
          try {
            // Append canvas off-screen so browsers that require an in-DOM
            // element for setDragImage will use our rendered image instead
            // of falling back to a default file icon.
            canvas.style.position = 'fixed';
            canvas.style.left = '10000px';
            canvas.style.top = '-10000px';
            canvas.style.zIndex = '9999';
            canvas.style.pointerEvents = 'none';
            document.body.appendChild(canvas);
            e.dataTransfer.setDragImage(canvas, offsetX, offsetY);
            // remember canvas so dragend can remove it
            el.__dragGhost = canvas;
          } catch (err) {
            // Fallback to DOM ghost if canvas isn't accepted
            const ghost = document.createElement('div');
            ghost.className = 'drag-ghost';
            ghost.textContent = txt || '';
            ghost.style.left = '10000px';
            ghost.style.top = '-10000px';
            document.body.appendChild(ghost);
            try { e.dataTransfer.setDragImage(ghost, Math.round(rect.width / 2), Math.round(rect.height / 2)); } catch (_) { /* ignore */ }
            el.__dragGhost = ghost;
          }
          try { el.classList.add('dragging'); } catch (_) {}
        } catch (outerErr) {
          console.error('drag ghost creation failed', outerErr);
        }
        chatgptRefBtn.classList.add('drop-target');
      });
  el.addEventListener('dragend', () => { chatgptRefBtn.classList.remove('drop-target'); try { el.classList.remove('dragging'); } catch(_) {} if (el.__dragGhost) { try { el.__dragGhost.remove(); } catch(_) {} el.__dragGhost = null; } });
    }
    chatMessagesEl.querySelectorAll('.message.user').forEach(armDraggable);
    const mo = new MutationObserver((muts) => { muts.forEach(m => m.addedNodes.forEach(node => { if (node instanceof HTMLElement) { if (node.matches && node.matches('.message.user')) armDraggable(node); node.querySelectorAll && node.querySelectorAll('.message.user').forEach(armDraggable); } })); });
    mo.observe(chatMessagesEl, { childList: true, subtree: true });
    chatgptRefBtn.addEventListener('dragenter', (e) => { e.preventDefault(); chatgptRefBtn.classList.add('drop-target'); });
    chatgptRefBtn.addEventListener('dragover', (e) => { e.preventDefault(); chatgptRefBtn.classList.add('drop-target'); });
    chatgptRefBtn.addEventListener('dragleave', () => chatgptRefBtn.classList.remove('drop-target'));
    chatgptRefBtn.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation(); chatgptRefBtn.classList.remove('drop-target');
      const txt = e.dataTransfer.getData('text/plain'); if (!txt) return; window.__lastDroppedPromptText = txt;
      if (window.__isTuringFlag) {
        try { const editable = await ensureAssistantEditor(); if (!editable) throw new Error('No assistant editor found'); await turingInsertReferenceAndPromptImage(editable, txt, window.__lastDraggedPromptElement); return; } catch (err) { console.error('Turing insert failed:', err); return; }
      }
      showChatGPTReferencePopup();
    });
    // Dynamic stylesheet helper used to position touch drag ghosts without setting inline styles (CSP-safe)
    function _ensureDynamicStyleSheet() {
      let s = document.getElementById('dynamic-style-sheet');
      if (!s) {
        s = document.createElement('style'); s.id = 'dynamic-style-sheet'; s.appendChild(document.createTextNode('')); document.head.appendChild(s);
      }
      return s.sheet;
    }
    function _insertPosRule(className, x, y) {
      const sheet = _ensureDynamicStyleSheet();
      const rule = `.${className} { left: ${x}px; top: ${y}px; }`;
      try { return sheet.insertRule(rule, sheet.cssRules.length); } catch (e) { console.error('insertRule failed', e); return -1; }
    }
    function _updatePosRule(ruleIndex, x, y) {
      const sheet = _ensureDynamicStyleSheet();
      if (!sheet || ruleIndex < 0 || ruleIndex >= sheet.cssRules.length) return;
      try { sheet.cssRules[ruleIndex].style.left = x + 'px'; sheet.cssRules[ruleIndex].style.top = y + 'px'; } catch (e) { /* ignore */ }
    }
    function _removePosRule(ruleIndex) {
      const sheet = _ensureDynamicStyleSheet();
      if (!sheet || ruleIndex < 0 || ruleIndex >= sheet.cssRules.length) return;
      try { sheet.deleteRule(ruleIndex); } catch (e) { /* ignore */ }
    }

    let touchState = { active: false, el: null, ghost: null };
    let longPressTimer = null;
    function startTouchDrag(el, touch) {
      touchState.active = true; touchState.el = el; const ghost = document.createElement('div'); ghost.textContent = 'Drag to Reference'; // use CSS class to avoid inline styles
      // Hide the original element during touch-drag so only the touch ghost is visible
      try { el.classList.add('dragging'); } catch (_) {}
      // give the ghost a unique pos-class so we can update its left/top via stylesheet rules
      const uniq = 'touch-ghost-pos-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
      ghost.classList.add('touch-ghost'); ghost.classList.add(uniq);
      document.body.appendChild(ghost);
      // create initial rule off-screen then update on first move
      ghost._posRuleIndex = _insertPosRule(uniq, touch.clientX, touch.clientY);
      touchState.ghost = ghost;
    }
    function endTouchDrag(touch) {
      if (!touchState.active) return; const rect = chatgptRefBtn.getBoundingClientRect(); const x = touch.clientX, y = touch.clientY; if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) { const txt = (touchState.el.innerText || touchState.el.textContent || '').trim(); window.__lastDroppedPromptText = txt; window.__lastDraggedPromptElement = touchState.el; showChatGPTReferencePopup(); }
      // Restore visibility of the original element
      try { if (touchState.el) touchState.el.classList.remove('dragging'); } catch (_) {}
      if (touchState.ghost) { try { if (typeof touchState.ghost._posRuleIndex === 'number') _removePosRule(touchState.ghost._posRuleIndex); } catch(_) {} try { touchState.ghost.remove(); } catch(_) {} }
      touchState = { active: false, el: null, ghost: null }; chatgptRefBtn.classList.remove('drop-target');
    }
    chatMessagesEl.addEventListener('touchstart', (e) => { const msg = e.target.closest && e.target.closest('.message.user'); if (!msg) return; if (longPressTimer) clearTimeout(longPressTimer); const t = e.touches[0]; longPressTimer = setTimeout(() => startTouchDrag(msg, t), 350); }, { passive: true });
  chatMessagesEl.addEventListener('touchmove', (e) => { if (!touchState.active || !touchState.ghost) return; const t = e.touches[0]; try { if (typeof touchState.ghost._posRuleIndex === 'number' && touchState.ghost._posRuleIndex >= 0) _updatePosRule(touchState.ghost._posRuleIndex, t.clientX, t.clientY); } catch (_) {} const rect = chatgptRefBtn.getBoundingClientRect(); const over = (t.clientX >= rect.left && t.clientX <= rect.right && t.clientY >= rect.top && t.clientY <= rect.bottom); chatgptRefBtn.classList.toggle('drop-target', over); }, { passive: true });
    chatMessagesEl.addEventListener('touchend', (e) => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } const t = e.changedTouches && e.changedTouches[0]; if (t) endTouchDrag(t); });
    chatMessagesEl.addEventListener('touchcancel', () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } try { if (touchState.el) touchState.el.classList.remove('dragging'); } catch(_) {} if (touchState.ghost) touchState.ghost.remove(); touchState = { active: false, el: null, ghost: null }; chatgptRefBtn.classList.remove('drop-target'); });
  })();
}

  // Helper: draw rounded rect on canvas
  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  // Helper: truncate text with ellipsis to fit width
  function truncateTextToWidth(ctx, text, maxWidth) {
    if (!text) return '';
    if (ctx.measureText(text).width <= maxWidth) return text;
    let low = 0, high = text.length, best = '';
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = text.slice(0, mid) + '…';
      if (ctx.measureText(candidate).width <= maxWidth) { low = mid + 1; best = candidate; } else { high = mid; }
    }
    return best || text.slice(0, Math.max(0, Math.floor(maxWidth / 10))) + '…';
  }

function waitFor(predicate, intervalMs = 80, tries = 25) { return new Promise((resolve) => { let t = 0; const id = setInterval(() => { const val = typeof predicate === 'function' ? predicate() : null; if (val) { clearInterval(id); resolve(val); } else if (++t >= tries) { clearInterval(id); resolve(null); } }, intervalMs); }); }

async function ensureAssistantEditor() {
  let el = document.querySelector('.assistant-edit-mode .assistant-editable-content');
  if (el) return el;
  const firstAssistant = document.querySelector('#chat-messages .message.assistant');
  if (firstAssistant && !firstAssistant.classList.contains('edit-locked')) { firstAssistant.click(); el = await waitFor(() => document.querySelector('.assistant-edit-mode .assistant-editable-content')); }
  return el;
}

// Extract references/prompts metadata from an editable assistant node
function extractFooterFromEditable(editable) {
  if (!editable) return { references: [], prompts: [] };
  const footer = editable.querySelector('[data-section="turing-footer"]');
  const refs = [];
  const prompts = [];
  if (!footer) return { references: refs, prompts };
  const refsBody = footer.querySelector('[data-section="references-body"]');
  if (refsBody) {
    refsBody.querySelectorAll('.reference-item, p').forEach(p => {
      const txt = (p.textContent || '').trim(); if (txt) refs.push(txt);
    });
  }
  const promptsBody = footer.querySelector('[data-section="prompts-body"]');
  if (promptsBody) {
    promptsBody.querySelectorAll('.reference-image-wrapper, p, .reference-item').forEach(n => {
      if (n.classList && n.classList.contains('reference-image-wrapper')) {
        const img = n.querySelector('img'); if (img && img.src) prompts.push({ type: 'image', src: img.src, alt: img.alt || '' });
      } else {
        const txt = (n.textContent || '').trim(); if (txt) prompts.push(txt);
      }
    });
  }
  return { references: refs, prompts };
}

function buildFooterFromMessage(msg) {
  if (!msg) return null;
  const hasRefs = Array.isArray(msg.references) && msg.references.length > 0;
  const hasPrompts = Array.isArray(msg.prompts) && msg.prompts.length > 0;
  if (!hasRefs && !hasPrompts) return null;
  const footer = document.createElement('div');
  footer.setAttribute('data-section', 'turing-footer');
  footer.className = 'turing-footer';
  if (hasRefs) {
    const refsSection = document.createElement('div'); refsSection.setAttribute('data-section', 'references-section'); refsSection.className = 'turing-section';
    const headingP = document.createElement('p'); const strong = document.createElement('strong'); strong.textContent = 'References'; headingP.appendChild(strong); refsSection.appendChild(headingP);
    const body = document.createElement('div'); body.setAttribute('data-section', 'references-body');
    msg.references.forEach(r => { const p = document.createElement('p'); p.className = 'reference-item'; p.textContent = (typeof r === 'string') ? r : (r.text || ''); body.appendChild(p); });
    refsSection.appendChild(body); footer.appendChild(refsSection);
  }
  if (hasPrompts) {
    const promptsSection = document.createElement('div'); promptsSection.setAttribute('data-section', 'prompts-section'); promptsSection.className = 'turing-section';
    const headingP2 = document.createElement('p'); const strong2 = document.createElement('strong'); strong2.textContent = 'Prompts'; headingP2.appendChild(strong2); promptsSection.appendChild(headingP2);
    const body2 = document.createElement('div'); body2.setAttribute('data-section', 'prompts-body');
    // Normalize a variety of prompt shapes to support legacy and future formats
    const normalized = msg.prompts.map(p => {
      // Strings: consider both data URLs and obvious image URLs
      if (typeof p === 'string') {
        const s = p.trim();
        if (/^data:image\//i.test(s)) return { type: 'image', src: s };
        if (/^(https?:)?\/\//i.test(s) || s.startsWith('/')) {
          if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(s)) return { type: 'image', src: s };
        }
        // otherwise leave as text
        return s;
      }
      if (p && typeof p === 'object') {
        // Most common shape
        if (p.src) return { type: p.type || 'image', src: p.src, alt: p.alt || '' };
        // Alternative keys often seen
        const src = p.dataUrl || p.data || p.image || (p.image && p.image.src) || p.base64 || null;
        if (src && typeof src === 'string') {
          const ss = src.trim();
          if (/^data:image\//i.test(ss) || /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(ss)) return { type: 'image', src: ss, alt: p.alt || '' };
        }
      }
      return p; // leave as-is (text or unknown)
    });
    normalized.forEach(p => {
      if (p && typeof p === 'object' && p.src && (p.type === 'image' || p.type === undefined)) {
        const wrapper = document.createElement('div');
        wrapper.className = 'reference-image-wrapper';
        const img = document.createElement('img');
        img.className = 'reference-image';
        img.src = p.src;
        img.alt = p.alt || '';
        // Defensive: ensure data URL images render at a sane size
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        wrapper.appendChild(img);
        body2.appendChild(wrapper);
      } else if (typeof p === 'string' && p.trim().length) {
        const pp = document.createElement('p'); pp.className = 'prompt-item'; pp.textContent = p; body2.appendChild(pp);
      } else if (p && typeof p === 'object' && p.text) {
        const pp = document.createElement('p'); pp.className = 'prompt-item'; pp.textContent = p.text; body2.appendChild(pp);
      }
    });
    promptsSection.appendChild(body2); footer.appendChild(promptsSection);
  }
  return footer;
}

function buildChatGPTReferenceTextFromPrompt(promptText) {
  const now = new Date(); const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']; const formattedDate = `${now.getDate()} ${monthNames[now.getMonth()]} ${now.getFullYear()}`; const safePrompt = (promptText || '').trim().replace(/\s+/g,' ').slice(0,2000); const promptLine = safePrompt ? ` Response generated to the prompt: "${safePrompt}".` : ''; return `OpenAI (2025) ChatGPT [AI language model].${promptLine} Available at: https://chat.openai.com/ (Accessed: ${formattedDate}).`;
}

// Remove any Turing footer(s) embedded inside given root and trim adjacent <br>.
function removeEmbeddedTuringFooters(root) {
  if (!root) return;
  const nodes = root.querySelectorAll('[data-section="turing-footer"], .turing-footer');
  nodes.forEach(n => {
    try {
      const prev = n.previousSibling; if (prev && prev.nodeType === 1 && prev.nodeName === 'BR') prev.remove();
    } catch(_) {}
    try {
      const next = n.nextSibling; if (next && next.nodeType === 1 && next.nodeName === 'BR') next.remove();
    } catch(_) {}
    try { n.remove(); } catch(_) {}
  });
}

// Apply or refresh the footer under an assistant message from extracted metadata
function applyFooterToAssistant(assistantEl, meta) {
  if (!assistantEl || !meta) return;
  // If there's no metadata provided, keep any existing footer intact.
  const hasRefs = Array.isArray(meta.references) && meta.references.length > 0;
  const hasPrompts = Array.isArray(meta.prompts) && meta.prompts.length > 0;
  if (!hasRefs && !hasPrompts) return;
  // Replace any and all existing footers in this assistant message.
  assistantEl.querySelectorAll('[data-section="turing-footer"], .turing-footer').forEach(n => {
    try {
      const prev = n.previousSibling; if (prev && prev.nodeType === 1 && prev.nodeName === 'BR') prev.remove();
      const next = n.nextSibling; if (next && next.nodeType === 1 && next.nodeName === 'BR') next.remove();
      n.remove();
    } catch(_) {}
  });
  const msg = { references: hasRefs ? meta.references : [], prompts: hasPrompts ? meta.prompts : [] };
  const footer = buildFooterFromMessage(msg);
  if (footer) assistantEl.appendChild(footer);
}

async function turingInsertReferenceAndPromptImage(editableEl, promptText, promptEl) {
  if (!editableEl) return;
  if (!window.html2canvas) {
  await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = '/vendor/html2canvas.min.js'; s.defer = true; s.onload = () => resolve(); s.onerror = () => reject(new Error('Failed to load html2canvas')); document.head.appendChild(s); });
  }
  function ensureFooter(el) { let footer = el.querySelector('[data-section="turing-footer"]'); if (!footer) { footer = document.createElement('div'); footer.setAttribute('data-section', 'turing-footer'); footer.classList.add('turing-footer'); if (el.lastChild) el.appendChild(document.createElement('br')); el.appendChild(footer); } if (footer !== el.lastChild) { el.appendChild(footer); } return footer; }
  function ensureSection(footer, key, titleText) { let section = footer.querySelector(`[data-section="${key}-section"]`); if (!section) { section = document.createElement('div'); section.setAttribute('data-section', `${key}-section`); const headingP = document.createElement('p'); const strong = document.createElement('strong'); strong.textContent = titleText; headingP.appendChild(strong); const body = document.createElement('div'); body.setAttribute('data-section', `${key}-body`); body.classList.add('section-body'); section.appendChild(headingP); section.appendChild(body); if (footer.lastChild) footer.appendChild(document.createElement('br')); footer.appendChild(section); } return section; }
  function getBody(section, key) { let body = section.querySelector(`[data-section="${key}-body"]`); if (!body) { body = document.createElement('div'); body.setAttribute('data-section', `${key}-body`); section.appendChild(body); } return body; }
  function moveOldSectionContentToFooter(el, key, titles, destBody) { const headings = Array.from(el.querySelectorAll('strong, b, h1, h2, h3, h4, h5, h6, p')).filter(n => { if (n.closest('[data-section="turing-footer"]')) return false; const txt = (n.textContent || '').trim().toLowerCase(); return titles.some(t => txt.startsWith(t.toLowerCase())); }); headings.forEach(h => { let cursor = h.nextSibling; const toMove = []; while (cursor && !(cursor.nodeType === 1 && /^(STRONG|B|H1|H2|H3|H4|H5|H6|P)$/.test(cursor.nodeName) && titles.concat(['references','prompts']).some(t => ((cursor.textContent||'').trim().toLowerCase().startsWith(t.toLowerCase())))) && !cursor.closest?.('[data-section="turing-footer"]')) { const next = cursor.nextSibling; toMove.push(cursor); cursor = next; } toMove.forEach(node => destBody.appendChild(node)); h.remove(); }); }
  const footer = ensureFooter(editableEl); const refsSection = ensureSection(footer, 'references', 'References'); const promptsSection = ensureSection(footer, 'prompts', 'Prompts'); const refsBody = getBody(refsSection, 'references'); const promptsBody = getBody(promptsSection, 'prompts');
  moveOldSectionContentToFooter(editableEl, 'references', ['References','Citations','Bibliography'], refsBody);
  moveOldSectionContentToFooter(editableEl, 'prompts', ['Prompts'], promptsBody);
  const refText = buildChatGPTReferenceTextFromPrompt(promptText);
  // avoid duplicate identical references
  const existingRef = Array.from(refsBody.querySelectorAll('.reference-item')).find(n => (n.textContent || '').trim() === refText.trim());
  if (!existingRef) {
    const refP = document.createElement('p'); refP.className = 'reference-item'; refP.textContent = refText; refsBody.appendChild(refP);
  } else {
    // refresh existing reference text (updates access date etc)
    existingRef.textContent = refText;
  }
  const pair = turingFindPairFromPromptEl(promptEl) || turingFindDefaultPair(); if (!pair) return;
  const container = turingBuildCaptureContainer(pair);
  // keep capture container in the viewport but hidden to avoid html2canvas using an iframe
  container.classList.add('turing-capture-hidden');
  document.body.appendChild(container);
  try {
    await new Promise(r => setTimeout(r, 50));
    const canvas = await window.html2canvas(container, { backgroundColor: '#ffffff', scale: window.devicePixelRatio || 2 });
    const dataUrl = canvas.toDataURL('image/png');
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'Prompt and AI excerpt';
  img.classList.add('reference-image');
    // wrap the image in a constrained wrapper so it cannot push out the layout
    const wrapper = document.createElement('div');
    wrapper.className = 'reference-image-wrapper';
    wrapper.appendChild(img);
    promptsBody.appendChild(wrapper);
  } finally {
    container.remove();
  }
  editableEl.dispatchEvent(new Event('input', { bubbles: true }));
}

function turingFindPairFromPromptEl(promptEl) { if (!promptEl) return null; let ai = promptEl.nextElementSibling; while (ai && !(ai.classList && ai.classList.contains('assistant'))) ai = ai.nextElementSibling; if (!ai) ai = document.querySelector('#chat-messages .message.assistant:last-of-type'); return ai ? { promptEl, assistantEl: ai } : null; }
function turingFindDefaultPair() { const ai = document.querySelector('#chat-messages .message.assistant:last-of-type'); if (!ai) return null; let user = ai.previousElementSibling; while (user && !(user.classList && user.classList.contains('user'))) user = user.previousElementSibling; return user ? { promptEl: user, assistantEl: ai } : null; }
function turingBuildCaptureContainer(pair) {
  const wrap = document.createElement('div');
  wrap.className = 'turing-capture-container';
  const h = document.createElement('div');
  h.className = 'turing-capture-heading';
  h.textContent = 'Chat excerpt';
  const p = pair.promptEl.cloneNode(true);
  const a = pair.assistantEl.cloneNode(true);
  // apply semantic classes rather than inline styles so CSS (not inline styles) controls rendering
  p.classList.add('turing-prompt');
  a.classList.add('turing-assistant');
  // remove UI chrome that shouldn't appear in capture (sticky turing bar, edit chrome, overlays, footers)
  p.querySelectorAll('.assistant-edit-toolbar, .assistant-edit-close').forEach(n => n.remove());
  // Remove the sticky Turing header bar and any overlay/toolbar in the assistant clone
  a.querySelectorAll('.assistant-edit-toolbar, .assistant-edit-close, .message-assistant-overlay, .turing-bar').forEach(n => n.remove());
  // Remove the aggregated footer (References/Prompts) from the capture to keep it focused on the message body
  a.querySelectorAll('.turing-footer,[data-section="turing-footer"]').forEach(n => n.remove());
  wrap.appendChild(h);
  wrap.appendChild(p);
  wrap.appendChild(a);
  return wrap;
}


function setupReferenceImageActions() {
  const copyBtn = document.getElementById('copy-image-btn');
  const dlBtn = document.getElementById('download-image-btn');
  if (!copyBtn || !dlBtn) return;
  function findPairFromPromptEl(promptEl) { if (!promptEl) return null; let ai = promptEl.nextElementSibling; while (ai && !(ai.classList && ai.classList.contains('assistant'))) ai = ai.nextElementSibling; if (!ai) ai = document.querySelector('#chat-messages .message.assistant:last-of-type'); return ai ? { promptEl, assistantEl: ai } : null; }
  function findDefaultPair() { const ai = document.querySelector('#chat-messages .message.assistant:last-of-type'); if (!ai) return null; let user = ai.previousElementSibling; while (user && !(user.classList && user.classList.contains('user'))) user = user.previousElementSibling; return user ? { promptEl: user, assistantEl: ai } : null; }
  function buildCaptureContainer(pair) {
    const wrap = document.createElement('div');
    wrap.className = 'turing-capture-container';
    const h = document.createElement('div');
    h.className = 'turing-capture-heading';
    h.textContent = 'Chat excerpt';
    const p = pair.promptEl.cloneNode(true);
    const a = pair.assistantEl.cloneNode(true);
    p.classList.add('turing-prompt');
    a.classList.add('turing-assistant');
    p.querySelectorAll('.assistant-edit-toolbar, .assistant-edit-close').forEach(n => n.remove());
    // Remove sticky Turing header and footer/metainfo from assistant clone
    a.querySelectorAll('.assistant-edit-toolbar, .assistant-edit-close, .message-assistant-overlay, .turing-bar').forEach(n => n.remove());
    a.querySelectorAll('.turing-footer,[data-section="turing-footer"]').forEach(n => n.remove());
    wrap.appendChild(h);
    wrap.appendChild(p);
    wrap.appendChild(a);
    return wrap;
  }
  async function renderImageCanvas(container) { if (!window.html2canvas) throw new Error('html2canvas not loaded'); await new Promise(r => setTimeout(r, 50)); return await window.html2canvas(container, { backgroundColor: '#ffffff', scale: window.devicePixelRatio || 2 }); }
  async function copyImageFlow() {
    try {
      const pair = findPairFromPromptEl(window.__lastDraggedPromptElement) || findDefaultPair();
      if (!pair) return alert('Could not find a user prompt and assistant reply to export.');
  const cont = buildCaptureContainer(pair);
  // keep container in viewport but invisible to avoid html2canvas iframe/document.write
  cont.classList.add('turing-capture-hidden');
  document.body.appendChild(cont);
      try { const canvas = await renderImageCanvas(cont); const blob = await new Promise(res => canvas.toBlob(res, 'image/png')); const item = new ClipboardItem({ 'image/png': blob }); await navigator.clipboard.write([item]); } finally { cont.remove(); }
    } catch (e) { console.error('Copy image failed, falling back to download:', e); await downloadImageFlow(); }
  }
  async function downloadImageFlow() {
    try {
      const pair = findPairFromPromptEl(window.__lastDraggedPromptElement) || findDefaultPair();
      if (!pair) return alert('Could not find a user prompt and assistant reply to export.');
  const cont = buildCaptureContainer(pair);
  cont.classList.add('turing-capture-hidden');
  document.body.appendChild(cont);
      try { const canvas = await renderImageCanvas(cont); const a = document.createElement('a'); a.download = 'chat-snippet.png'; a.href = canvas.toDataURL('image/png'); document.body.appendChild(a); a.click(); a.remove(); } finally { cont.remove(); }
    } catch (e) { console.error('Download image failed:', e); alert('Unable to create image. Please try again.'); }
  }
  copyBtn.onclick = copyImageFlow; dlBtn.onclick = downloadImageFlow;
}

function togglePromptButtons() {
  const button = document.querySelector('.prompt-examples-button');
  const promptButtons = document.querySelector('.prompt-buttons');
  button.classList.toggle('active');
  promptButtons.style.display = button.classList.contains('active') ? 'flex' : 'none';
  const buttonRect = button.getBoundingClientRect();
  promptButtons.style.position = 'fixed';
  promptButtons.style.left = `${buttonRect.right}px`;
  promptButtons.style.top = `${buttonRect.top}px`;
}

document.addEventListener('click', (event) => {
  const button = document.querySelector('.prompt-examples-button');
  const promptButtons = document.querySelector('.prompt-buttons');
  if (!button.contains(event.target) && !promptButtons.contains(event.target)) {
    promptButtons.style.display = 'none';
    button.classList.remove('active');
  }
});

window.addEventListener('resize', () => {
  const button = document.querySelector('.prompt-examples-button');
  const promptButtons = document.querySelector('.prompt-buttons');
  promptButtons.style.display = 'none';
  button.classList.remove('active');
});

function highlightCurrentSession(sessionId) {
  document.querySelectorAll('.session-button').forEach(button => {
    if (button.id === `session-${sessionId}`) button.classList.add('active-session'); else button.classList.remove('active-session');
  });
}

// Assistant edit-mode: open an assistant message in a focused overlay for editing
function enterAssistantEditMode(targetAssistant) {
  if (!targetAssistant) return null;
  if (targetAssistant.classList.contains('edit-locked')) return null;
  // If an edit-mode overlay already exists, remove it first
  const existing = document.querySelector('.assistant-edit-mode');
  if (existing) existing.remove();

  // Build overlay
  const wrapper = document.createElement('div');
  wrapper.className = 'assistant-edit-mode';
  wrapper.setAttribute('role', 'dialog');

  const closeBtn = document.createElement('button');
  closeBtn.className = 'assistant-edit-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close editor');
  closeBtn.innerHTML = '×';
  // Auto-save on close to preserve prompt screenshots and references
  closeBtn.addEventListener('click', () => saveEdit());

  const toolbar = document.createElement('div');
  toolbar.className = 'assistant-edit-toolbar';
  // Simple toolbar: Save / Close
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = '💾 Save';
  saveBtn.addEventListener('click', () => saveEdit());
  // Decipher button: assess content up to References using server feedback
  const decipherBtn = document.createElement('button');
  decipherBtn.type = 'button';
  decipherBtn.className = 'decipher-btn';
  decipherBtn.title = 'Decipher and assess (🔍)';
  decipherBtn.textContent = '🔍 Decipher';
  decipherBtn.addEventListener('click', () => {
    try {
      // Get current editable HTML and trim at References section
      const editableEl = wrapper.querySelector('.assistant-editable-content');
      let html = editableEl ? editableEl.innerHTML || '' : '';
      const lower = html.toLowerCase();
      const refIdx = lower.indexOf('>references<');
      if (refIdx > -1) {
        // Roughly trim content before the heading tag that contains 'References'
        html = html.slice(0, refIdx);
      }
      const cleaned = sanitizeHtml(html);
      // Send to server via websocket to generate feedback/assessment
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'generateFeedback', content: cleaned, session_id }));
        showPopup(document.getElementById('scale-popup'), 'Assessing content against rubric…');
      } else {
        console.warn('WebSocket not open; cannot send decipher request');
      }
    } catch (e) {
      console.error('Decipher click failed:', e);
    }
  });
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = '✖ Close';
  cancelBtn.title = 'Close editor';
  cancelBtn.addEventListener('click', () => exitAssistantEditMode(wrapper, false, targetAssistant));
  toolbar.appendChild(saveBtn);
  toolbar.appendChild(decipherBtn);
  toolbar.appendChild(cancelBtn);

  const editable = document.createElement('div');
  editable.className = 'assistant-editable-content';
  editable.contentEditable = 'true';
  // Populate with the message content (preserve basic markup)
  const contentEl = targetAssistant.querySelector('.message-content');
  // sanitize the content before allowing editing to avoid executing scripts
  editable.innerHTML = sanitizeHtml(contentEl ? contentEl.innerHTML : '');

  // Also include any existing References/Prompts footer in the editor so it
  // remains visible and is preserved on save. We clone it into the editable
  // area and let the save flow re-extract metadata from this copy.
  try {
    const existingFooter = targetAssistant.querySelector('[data-section="turing-footer"], .turing-footer');
    const footerRemoved = targetAssistant.dataset.footerRemoved === '1';
    if (existingFooter && !footerRemoved) {
      const cloned = existingFooter.cloneNode(true);
      editable.appendChild(document.createElement('br'));
      editable.appendChild(cloned);
    }
  } catch (_) { /* non-fatal */ }

  wrapper.appendChild(closeBtn);
  wrapper.appendChild(toolbar);
  // Criteria rail on the right side of the popup
  (function addCriteriaRail() {
    const rail = document.createElement('aside');
    rail.className = 'assistant-edit-criteria-rail';
    const items = [
      { key: 'P1', tip: 'Use research to identify a range of potential diseases for each patient (≥4 per patient).' },
      { key: 'P2', tip: 'Create a detailed method: tests, techniques, equipment (sizes/quantities/PPE) informed by suspected diseases.' },
      { key: 'M2', tip: 'Explain the rationale for tests and techniques chosen based on suspected diseases (builds on P2/M1).' },
      { key: 'D1', tip: 'Justify the choice and settings of appropriate equipment for chosen tests and techniques.' }
    ];
    items.forEach(it => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'criteria-chip';
      b.textContent = it.key;
      b.setAttribute('data-tip', it.tip);
      rail.appendChild(b);
    });
    wrapper.appendChild(rail);
  })();
  // Feedback popup container inside edit mode
  const fbPopup = document.createElement('div');
  fbPopup.className = 'assistant-edit-feedback-popup';
  const fbInner = document.createElement('div');
  fbInner.className = 'assistant-edit-feedback-content';
  const fbClose = document.createElement('button');
  fbClose.type = 'button';
  fbClose.className = 'assistant-edit-feedback-close';
  fbClose.textContent = '×';
  fbClose.title = 'Close feedback';
  fbClose.addEventListener('click', () => fbPopup.classList.remove('visible'));
  fbPopup.appendChild(fbClose);
  fbPopup.appendChild(fbInner);
  wrapper.appendChild(fbPopup);
  wrapper.appendChild(editable);
  document.body.appendChild(wrapper);

  // Apply layout helpers to expand chat and hide sidebar while editing
  document.querySelector('.sidebar')?.classList.add('hide-sidebar');
  document.querySelector('.chat-container')?.classList.add('expand-chat-area');
  document.querySelector('.meta-container')?.classList.add('expand-meta-container');

  // Focus editable
  setTimeout(() => { editable.focus(); }, 10);

  // Save handler
  async function saveEdit() {
    // Copy edited HTML back into the target assistant element
    try {
  // Sanitize edited HTML before writing back and sending to server
  const cleaned = sanitizeHtml(editable.innerHTML || '');
  // Strip any embedded Turing footer from the body we save back
  const tmp = document.createElement('div');
  tmp.innerHTML = cleaned;
  removeEmbeddedTuringFooters(tmp);
  if (contentEl) contentEl.innerHTML = tmp.innerHTML;
      targetAssistant.dataset.edited = '1';
      // Attempt to persist change to the server if message_id present
      let messageId = targetAssistant.dataset.messageId;
      // Fallback: try to locate a numeric assistant id if the seed has a placeholder id
      if (!messageId || Number.isNaN(parseInt(messageId, 10))) {
        const firstAssistant = document.querySelector('#chat-messages .message.assistant');
        if (firstAssistant && firstAssistant.dataset && !Number.isNaN(parseInt(firstAssistant.dataset.messageId, 10))) {
          messageId = firstAssistant.dataset.messageId;
        }
      }
      // Always include session_id for server-side fallback; only send message_id when it's a valid integer
  const payload = { content: tmp.innerHTML, session_id };
      // extract any references/prompts the user added in the editor and include them with the save
      try {
        const rawMeta = extractFooterFromEditable(editable);
        // Upload any data URL screenshots first, replace with canonical URL-based prompts
        const meta = await uploadDataUrlPrompts(rawMeta);
        const hasRefs = meta && Array.isArray(meta.references) && meta.references.length > 0;
        const hasPrompts = meta && Array.isArray(meta.prompts) && meta.prompts.length > 0;
        if (hasRefs) payload.references = meta.references;
        if (hasPrompts) payload.prompts = meta.prompts;
        // If user removed both sections, ensure footer is removed and remembered
        if (!hasRefs && !hasPrompts) {
          try { removeEmbeddedTuringFooters(targetAssistant); } catch(_) {}
          targetAssistant.dataset.footerRemoved = '1';
          payload.footer_removed = true;
        } else {
          // Apply or refresh footer in the UI using canonical URLs
          try { applyFooterToAssistant(targetAssistant, meta); } catch (_) {}
          targetAssistant.dataset.footerRemoved = '0';
          payload.footer_removed = false;
        }
      } catch (e) { console.warn('Could not extract/upload editor metadata:', e); }
      const parsed = parseInt(messageId, 10);
      if (!Number.isNaN(parsed)) payload.message_id = parsed;
      try {
        await fetch('/update-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        // Update sticky Turing message header counts after save
        try { if (targetAssistant.classList.contains('turing-message')) updateTuringBarCounts(targetAssistant); } catch(_) {}
      } catch (err) { console.warn('Failed to persist edited message:', err); }
    } finally {
      exitAssistantEditMode(wrapper, true, targetAssistant);
    }
  }

  return wrapper;
}

// Show feedback as a popup within the Turing edit overlay
function showEditFeedbackPopup(text, editWrapper) {
  try {
    if (!editWrapper) editWrapper = document.querySelector('.assistant-edit-mode');
    if (!editWrapper) return;
    const popup = editWrapper.querySelector('.assistant-edit-feedback-popup');
    const content = editWrapper.querySelector('.assistant-edit-feedback-content');
    if (!popup || !content) return;
    content.textContent = '';
    // Render simple markdown to HTML for readability
    const html = renderMarkdownToHtml(text);
    content.innerHTML = sanitizeHtml(html || escapeHtml(text));
    popup.classList.add('visible');
    // cache last feedback for quick recall
    editWrapper.__lastFeedbackText = String(text);
  } catch (e) {
    console.error('showEditFeedbackPopup failed', e);
  }
}

// Parse feedback lines and apply traffic light classes to criteria chips
function applyTrafficLightsFromFeedback(text, editWrapper) {
  if (!editWrapper) editWrapper = document.querySelector('.assistant-edit-mode');
  const rail = editWrapper ? editWrapper.querySelector('.assistant-edit-criteria-rail') : null;
  if (!rail) return;
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const statuses = {};
  ['P1','P2','M2','D1'].forEach(k => {
    const line = lines.find(l => l.toUpperCase().startsWith(k + ':')) || '';
    const low = line.toLowerCase();
    let status = null;
    if (/(distinction|excellent|strong)/.test(low)) status = 'distinction';
    else if (/(merit|good|adequate)/.test(low)) status = 'merit';
    else if (/(pass|meets|basic|minimal)/.test(low)) status = 'pass';
    else if (/(not met|missing|insufficient|needs)/.test(low)) status = 'fail';
    statuses[k] = status;
  });
  rail.querySelectorAll('.criteria-chip').forEach(chip => {
    const key = chip.textContent.trim();
    chip.classList.remove('chip-pass','chip-merit','chip-distinction','chip-fail');
    const s = statuses[key];
    if (s === 'distinction') chip.classList.add('chip-distinction');
    else if (s === 'merit') chip.classList.add('chip-merit');
    else if (s === 'pass') chip.classList.add('chip-pass');
    else if (s === 'fail') chip.classList.add('chip-fail');
  });
}

// Add a small clipboard icon above the first criteria chip that reopens feedback popup
function showCriteriaClipboard(editWrapper, feedbackText) {
  if (!editWrapper) editWrapper = document.querySelector('.assistant-edit-mode');
  const rail = editWrapper ? editWrapper.querySelector('.assistant-edit-criteria-rail') : null;
  if (!rail) return;
  // Ensure only one clipboard trigger exists
  let clip = rail.querySelector('.criteria-clipboard-trigger');
  const firstChip = rail.querySelector('.criteria-chip');
  if (!firstChip) return;
  if (!clip) {
    clip = document.createElement('button');
    clip.type = 'button';
    clip.className = 'criteria-clipboard-trigger';
    clip.title = 'Show assessment feedback';
    clip.textContent = '📋';
    clip.addEventListener('click', () => {
      const last = editWrapper.__lastFeedbackText || feedbackText || '';
      if (last) showEditFeedbackPopup(last, editWrapper);
    });
    // Insert above the first chip
    rail.insertBefore(clip, firstChip);
  }
}

// Replace any data URL image prompts with uploaded URLs via /upload-image
async function uploadDataUrlPrompts(meta) {
  if (!meta || typeof meta !== 'object') return { references: [], prompts: [] };
  const out = { references: Array.isArray(meta.references) ? meta.references : [], prompts: [] };
  const prompts = Array.isArray(meta.prompts) ? meta.prompts : [];
  for (const p of prompts) {
    try {
      if (p && typeof p === 'object' && (p.type === 'image' || !p.type) && typeof p.src === 'string' && /^data:image\//i.test(p.src)) {
        const resp = await fetch('/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl: p.src })
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data && data.success && data.url) {
          out.prompts.push({ type: 'image', src: data.url, alt: p.alt || '' });
        } else {
          out.prompts.push(p);
        }
      } else {
        out.prompts.push(p);
      }
    } catch (_) {
      out.prompts.push(p);
    }
  }
  return out;
}

function exitAssistantEditMode(wrapper, saved, targetAssistant) {
  if (!wrapper) return;
  wrapper.remove();
  // restore layout
  const sidebarEl = document.querySelector('.sidebar');
  const chatEl = document.querySelector('.chat-container');
  const metaEl = document.querySelector('.meta-container');
  // remove the classes first
  if (sidebarEl) sidebarEl.classList.remove('hide-sidebar');
  if (chatEl) chatEl.classList.remove('expand-chat-area');
  if (metaEl) metaEl.classList.remove('expand-meta-container');
  // clear any inline styles or lingering animation state that could keep the sidebar hidden
  [sidebarEl, chatEl, metaEl].forEach(el => {
    if (!el) return;
    try {
      el.style.animation = '';
      el.style.transition = '';
      el.style.width = '';
      el.style.opacity = '';
      el.style.display = '';
    } catch (_) {}
  });
  // trigger a reflow so styles are recomputed
  try { void (sidebarEl && sidebarEl.offsetWidth); } catch (_) {}
  // If saving, optionally emit an input event on the assistant to notify other handlers
  if (saved && targetAssistant) {
    const contentEl = targetAssistant.querySelector('.message-content');
    if (contentEl) contentEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Delegate clicks on assistant messages to enter edit mode (unless locked)
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest('.message.assistant');
  if (!el) return;
  // prevent triggering when clicking inside editor UI if it exists
  if (document.querySelector('.assistant-edit-mode')) return;
  if (el.classList.contains('edit-locked')) return;
  // Only respond to primary button clicks
  if (e.button !== 0) return;
  // don't trigger when click originates from a control inside the message (e.g., overlay buttons)
  if (e.target.closest && e.target.closest('.message-assistant-overlay')) return;
  enterAssistantEditMode(el);
});

const popupOverlay = document.getElementById('popup-overlay');
if (popupOverlay) {
  popupOverlay.addEventListener('click', function () { hidePromptPopup(); hideReferencePopup(); });
}

const promptPopup = document.getElementById('prompt-popup');
if (promptPopup) {
  promptPopup.addEventListener('click', function (e) { if (e.target === promptPopup) hidePromptPopup(); });
  promptPopup.addEventListener('click', function (e) { if (e.target.classList.contains('close-button')) hidePromptPopup(); });
}

const referencePopup = document.getElementById('reference-popup');
if (referencePopup) {
  referencePopup.addEventListener('click', function (e) { if (e.target === referencePopup) hideReferencePopup(); });
  const refClose = referencePopup.querySelector('.close-button'); if (refClose) refClose.addEventListener('click', hideReferencePopup);
}

// Assist: wire up removed inline handlers
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('turing-mode-button')?.addEventListener('click', startTuringMode);
  document.getElementById('new-chat-button')?.addEventListener('click', startNewChat);
  document.getElementById('new-group-button')?.addEventListener('click', createNewGroup);
  document.querySelector('.prompt-examples-button')?.addEventListener('click', togglePromptButtons);
  document.querySelectorAll('.prompt-buttons .prompt-button').forEach(btn => {
    btn.addEventListener('click', () => { const type = btn.dataset.type; if (type) showPromptPopup(type); });
  });
  document.querySelector('.send-message-button')?.addEventListener('click', sendMessage);
  const input = document.getElementById('message-input');
  if (input) {
    // listen for Enter on both keypress (fallback) and keydown for modern browsers
    input.addEventListener('keypress', handleKeyPress);
    input.addEventListener('keydown', handleKeyPress);
    input.addEventListener('input', resizeInput);
  }
  // When in a Turing session, set up sticky turing message behavior after DOM is ready
  // Sticky Turing header disabled: allow assistant messages to scroll normally
});

// ----- Turing Message (sticky, collapsible, aggregates screenshots) -----
function setupStickyTuringMessage() {
  const firstAssistant = document.querySelector('#chat-messages .message.assistant');
  if (!firstAssistant) return;
  // Mark as Turing message and move to top of list to ensure sticky works
  firstAssistant.classList.add('turing-message');
  if (firstAssistant.parentElement === chatMessages) {
    // Ensure it's the first child inside chatMessages
    if (chatMessages.firstChild !== firstAssistant) chatMessages.insertBefore(firstAssistant, chatMessages.firstChild);
  } else if (firstAssistant.parentElement && firstAssistant.parentElement.classList.contains('message-row')) {
    // If wrapped in a row, move the row to the top
    const row = firstAssistant.parentElement;
    if (row.parentElement === chatMessages && chatMessages.firstChild !== row) chatMessages.insertBefore(row, chatMessages.firstChild);
  }
  ensureTuringBar(firstAssistant);
  updateTuringBarCounts(firstAssistant);
  // Collapse on scroll beyond a small threshold
  const onScroll = () => {
    const sc = chatMessages.scrollTop || 0;
    if (sc > 80) firstAssistant.classList.add('collapsed'); else firstAssistant.classList.remove('collapsed');
  };
  chatMessages.removeEventListener('scroll', chatMessages.__turingScrollHandler || (()=>{}));
  chatMessages.__turingScrollHandler = onScroll;
  chatMessages.addEventListener('scroll', onScroll);
  // Initial state
  onScroll();
}

function ensureTuringBar(assistantEl) {
  if (!assistantEl) return;
  let bar = assistantEl.querySelector('.turing-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'turing-bar';
    const left = document.createElement('div'); left.className = 'turing-bar-left'; left.innerHTML = '<span class="dot"></span><strong>Turing message</strong>';
    const right = document.createElement('div'); right.className = 'turing-bar-right'; right.innerHTML = '<span class="count-refs">Refs: 0</span><span class="sep">·</span><span class="count-prompts">Shots: 0</span>';
    bar.appendChild(left); bar.appendChild(right);
    assistantEl.prepend(bar);
  }
}

function updateTuringBarCounts(assistantEl) {
  if (!assistantEl) return;
  const footer = assistantEl.querySelector('.turing-footer');
  let refs = 0, shots = 0;
  if (footer) {
    refs = footer.querySelectorAll('[data-section="references-body"] .reference-item').length;
    shots = footer.querySelectorAll('[data-section="prompts-body"] .reference-image-wrapper').length;
  }
  const r1 = assistantEl.querySelector('.turing-bar .count-refs'); if (r1) r1.textContent = `Refs: ${refs}`;
  const r2 = assistantEl.querySelector('.turing-bar .count-prompts'); if (r2) r2.textContent = `Shots: ${shots}`;
}
