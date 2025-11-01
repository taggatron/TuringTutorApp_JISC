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
  const lines = String(text).split(/\r?\n/);
  let out = '';
  let inList = false;

  // accumulate consecutive non-list lines into paragraphs
  let paragraphBuffer = [];
  function flushParagraph() {
    if (paragraphBuffer.length === 0) return;
    const joined = paragraphBuffer.join(' ');
    out += `<p>${processInlineMarkdown(joined)}</p>`;
    paragraphBuffer = [];
  }

  try {
    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (line === '---' || line === '***') {
        if (inList) { out += '</ul>'; inList = false; }
        flushParagraph();
        out += '<hr/>';
        continue;
      }

      const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
      if (headingMatch) {
        if (inList) { out += '</ul>'; inList = false; }
        flushParagraph();
        const level = Math.min(3, (line.match(/^#+/)||[''])[0].length);
        const content = headingMatch[1];
        out += `<h${level}>${processInlineMarkdown(content)}</h${level}>`;
        continue;
      }

      if (/^[-•]\s+/.test(line)) {
        flushParagraph();
        if (!inList) { out += '<ul>'; inList = true; }
        const item = line.replace(/^[-•]\s+/, '');
        out += `<li>${processInlineMarkdown(item)}</li>`;
        continue;
      }

      // blank line: paragraph boundary
      if (line === '') {
        if (inList) { out += '</ul>'; inList = false; }
        flushParagraph();
        continue;
      }

      // accumulate into paragraph
      paragraphBuffer.push(line);
    }
    flushParagraph();
  } catch (e) {
    console.error('Error rendering markdown:', e);
    return '';
  }

  if (inList) out += '</ul>';
  return out;

  function processInlineMarkdown(s) {
    let escaped = escapeHtml(s);
    // Bold **text** (multiline safe)
    escaped = escaped.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    // Simple italic (single * on both sides) - conservative
    escaped = escaped.replace(/(^|\s)\*([^*]+?)\*(\s|$)/g, '$1<em>$2</em>$3');
    // Autolink
    escaped = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return escaped;
  }
}

// Sanitize HTML before inserting into the DOM.
// Uses DOMParser to walk the fragment and remove disallowed nodes and attributes.
// Whitelist tags and attributes; strip event handlers, <script>, <iframe>, <style>, and any
// href/src that start with javascript:, data:, or vbscript:.
function sanitizeHtml(dirtyHtml) {
  try {
    if (!dirtyHtml) return '';
    const parser = new DOMParser();
    // parse as fragment inside a body so we can serialize later
    const doc = parser.parseFromString(`<body>${dirtyHtml}</body>`, 'text/html');
    const root = (doc && doc.body) ? doc.body : doc;

    const allowedTags = new Set(['A','P','BR','STRONG','B','EM','I','UL','LI','H1','H2','H3','H4','H5','H6','DIV','SPAN']);

    const walk = (node) => {
      let child = node.firstChild;
      while (child) {
        const next = child.nextSibling;
        if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.nodeName.toUpperCase();
          if (!allowedTags.has(tag)) {
            // move children up to parent, if possible
            const parent = child.parentNode;
            if (parent) {
              while (child.firstChild) parent.insertBefore(child.firstChild, child);
              parent.removeChild(child);
            } else {
              // no parent (shouldn't happen for body children) — replace with text node
              const txt = document.createTextNode(child.textContent || '');
              try { node.replaceChild(txt, child); } catch (e) { /* best-effort */ }
            }
            child = next;
            continue;
          }

          // Clean attributes
          const attrs = Array.from(child.attributes || []);
          for (const attr of attrs) {
            const name = attr.name.toLowerCase();
            const val = attr.value || '';
            // Remove event handlers and style/class/id attributes
            if (name.startsWith('on') || name === 'style' || name === 'class' || name === 'id') {
              child.removeAttribute(attr.name);
              continue;
            }
            if (name === 'href' && tag === 'A') {
              const v = val.trim().toLowerCase();
              if (v.startsWith('javascript:') || v.startsWith('data:') || v.startsWith('vbscript:')) {
                child.removeAttribute('href');
              } else {
                child.setAttribute('rel', 'noopener noreferrer');
                child.setAttribute('target', '_blank');
              }
              continue;
            }
            // remove any other attribute
            child.removeAttribute(attr.name);
          }
        }
        // descend into next level
        if (child && child.firstChild) walk(child);
        child = next;
      }
    };

    walk(root);
    return (root && root.innerHTML) ? root.innerHTML : '';
  } catch (err) {
    // Fallback: escape everything
    try { return escapeHtml(String(dirtyHtml)); } catch (e) { return ''; }
  }
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
        // initialize streaming accumulator for robust markdown rendering across chunks
        botMessageDiv._accumulatedRaw = '';
        botMessageDiv._visibleRaw = '';
        botMessageDiv._lastAppend = 0;
        botMessageDiv._renderTimer = null;
      }
  const contentDiv = botMessageDiv.querySelector('.message-content');
  // If server indicates markdown formatting, accumulate the raw text and render progressively
  if (!botMessageDiv._accumulatedRaw) botMessageDiv._accumulatedRaw = '';
  if (!botMessageDiv._visibleRaw) botMessageDiv._visibleRaw = '';
  if (message.format === 'markdown' || message.format === undefined) {
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
            // Render the visible subset (sanitize to avoid XSS)
            contentDiv.innerHTML = sanitizeHtml(renderMarkdownToHtml(botMessageDiv._visibleRaw));
            chatMessages.scrollTop = chatMessages.scrollHeight;
          } else {
            // No buffered content; if no new data for a short while, stop the timer
              if (Date.now() - botMessageDiv._lastAppend > 300) {
              clearInterval(botMessageDiv._renderTimer);
              botMessageDiv._renderTimer = null;
              // Ensure final render includes any leftover visibleRaw (sanitized)
              contentDiv.innerHTML = sanitizeHtml(renderMarkdownToHtml(botMessageDiv._visibleRaw));
            }
          }
        } catch (e) {
          // on any render error, fallback to appending raw text
          const safe = escapeHtml(message.content || '').replace(/\n/g, '<br>');
          contentDiv.innerHTML += sanitizeHtml(safe);
        }
      }, TICK_MS);
    }
    } else {
      // non-markdown fallback: append raw text safely
      const safe = escapeHtml(message.content || '').replace(/\n/g, '<br>');
      contentDiv.innerHTML += sanitizeHtml(safe);
    }
      chatMessages.scrollTop = chatMessages.scrollHeight;
    } else if (message.type === 'scale') {
      updateScale(message.data);
      if (message.data.some(level => level >= 3)) {
        const assistantMessages = document.querySelectorAll('.message.assistant');
        for (let i = assistantMessages.length - 1; i >= 0; i--) {
          const lastAssistant = assistantMessages[i];
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
        displayFeedback(message.content, message.message_id);
        console.log('Feedback updated in the container:', message.content);
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
  feedbackContainer.style.display = 'block';
  feedbackContainer.style.position = 'relative';
  feedbackContainer.querySelector('.feedback-message').textContent = feedback;
  feedbackContainer.addEventListener('click', function() {
    const feedbackText = this.querySelector('.feedback-message').textContent;
    setMessageInput(feedbackText);
  });
  return feedbackContainer;
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
  const message = input.value;
  if (message.trim()) {
    botMessageDiv = null;
    // Clear input immediately to give responsive feedback to the user
    input.value = '';
    input.style.height = 'auto';
    try {
      ws.send(JSON.stringify({ content: message, session_id }));
    } catch (err) {
      console.error('WebSocket send failed:', err);
    }
    const userMessage = document.createElement('div');
    userMessage.className = 'message user';
    const previousMapping = feedbackMapping[feedbackMapping.length - 1];
    const hasFeedback = previousMapping && previousMapping.feedbackContainer.style.display !== 'none' && previousMapping.feedbackContainer.querySelector('.feedback-message').textContent.trim() !== '';
    if (hasFeedback) setDynamicTopMargin(userMessage, previousMapping.feedbackContainer);
    userMessage.textContent = message;
    const oldPlaceholder = chatMessages.querySelector('.user.placeholder-message');
    if (oldPlaceholder) oldPlaceholder.remove();
    chatMessages.appendChild(userMessage);
    const feedbackContainer = createFeedbackContainer('');
    feedbackMapping.push({ messageElement: userMessage, feedbackContainer });
  // input already cleared above
    chatMessages.scrollTop = chatMessages.scrollHeight;
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(0, 0);
      const upArrowEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38, bubbles: true });
      input.dispatchEvent(upArrowEvent);
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
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <span>Copying or directly using this response breaches academic integrity guidelines</span>
      <button class="close-overlay-btn" title="Remove warning">&times;</button>`;
    overlay.addEventListener('click', function(e){
      e.stopPropagation();
      overlay.style.display = 'none';
      targetAssistant.classList.remove('overlay-active');
      const contentDiv = targetAssistant.querySelector('.message-content');
      if (contentDiv) { contentDiv.style.opacity = '1'; contentDiv.style.pointerEvents = 'auto'; }
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
    if (overlay) { overlay.style.display = 'flex'; assistant.classList.add('overlay-active'); }
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
      } catch (e) {
        const safe = escapeHtml(msg.content || '').replace(/\n/g,'<br>');
        contentDiv.innerHTML = sanitizeHtml(safe);
      }
      const overlayDiv = document.createElement('div');
      overlayDiv.className = 'message-assistant-overlay ' + (showOverlay ? 'overlay-shown' : 'overlay-hidden');
      messageElement.appendChild(contentDiv);
      messageElement.appendChild(overlayDiv);
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
        button.textContent = `Session ${index + 1}`;
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
        const shouldLock = isTuring ? false : ((Number(msg.collapsed) === 1) || (Number(msg.scale_level) >= 3) || messagesWithFeedback.has(String(msg.message_id)));
        if (shouldLock) assistantMessageDiv.classList.add('edit-locked');
        assistantMessageDiv.dataset.messageId = msg.message_id;
        const showOverlay = isTuring ? false : messagesWithFeedback.has(String(msg.message_id));
        if (showOverlay) assistantMessageDiv.classList.add('overlay-active');
        const __isHtml = /<\w+[\s\S]*?>[\s\S]*<\/\w+>/i.test(msg.content || '');
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        try {
          if (__isHtml) contentDiv.innerHTML = sanitizeHtml(msg.content || '');
          else contentDiv.innerHTML = sanitizeHtml(renderMarkdownToHtml(msg.content || ''));
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
        if (closeBtn && overlay && contentDiv) {
          closeBtn.addEventListener('click', function(e) {
            e.stopPropagation(); overlay.classList.remove('overlay-shown'); overlay.classList.add('overlay-hidden'); assistantMessageDiv.classList.remove('overlay-active'); contentDiv.style.opacity = '1'; contentDiv.style.pointerEvents = 'auto';
          });
          overlay.addEventListener('click', function(e){ e.stopPropagation(); overlay.classList.remove('overlay-shown'); overlay.classList.add('overlay-hidden'); assistantMessageDiv.classList.remove('overlay-active'); contentDiv.style.opacity = '1'; contentDiv.style.pointerEvents = 'auto'; });
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
    document.querySelectorAll('.feedback-container').forEach(container => { container.style.display = 'none'; });
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
  const sessionButtons = document.querySelectorAll('.session-button');
  let highestSessionNumber = 0;
  sessionButtons.forEach(button => {
    const buttonText = button.textContent.replace('🗑', '').trim();
    const matches = buttonText.match(/\d+/);
    if (matches && matches.length > 0) {
      const sessionNumber = parseInt(matches[0]);
      if (sessionNumber > highestSessionNumber) highestSessionNumber = sessionNumber;
    }
  });
  const newSessionNumber = highestSessionNumber + 1;
  const button = document.createElement('button');
  button.className = 'session-button';
  button.textContent = `Session ${newSessionNumber}`;
  button.id = `session-${sessionId}`;
  button.draggable = true; button.ondragstart = drag; button.onclick = () => loadSessionHistory(sessionId);
  const deleteIcon = document.createElement('span'); deleteIcon.textContent = '🗑'; deleteIcon.className = 'delete-icon';
  deleteIcon.onclick = (event) => { event.stopPropagation(); deleteSession(sessionId, button.parentElement.id); };
  button.appendChild(deleteIcon);
  newChats.appendChild(button);
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
    container.style.display = 'none';
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
        document.querySelectorAll('.scale-item').forEach(i => i.style.pointerEvents = 'none');
        item.classList.add('active');
        typeWriter('animated-text', description, scaleSpeed, () => {
          setTimeout(() => {
            const animatedEl2 = document.getElementById('animated-text');
            if (animatedEl2) {
              animatedEl2.textContent = '';
              typeWriter('animated-text', text, defaultSpeed);
            } else {
              // If the element is gone, ensure we re-enable pointer events
              document.querySelectorAll('.scale-item').forEach(i => i.style.pointerEvents = 'auto');
            }
            document.querySelectorAll('.scale-item').forEach(i => i.style.pointerEvents = 'auto');
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
  popupContainer.className = 'popup-container';
  Object.assign(popupContainer.style, { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: '2000', backgroundColor: 'white', padding: '20px', boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)', borderRadius: '8px' });
  const heading = document.createElement('h3'); heading.textContent = 'Create a New Group'; heading.style.marginTop = '0'; popupContainer.appendChild(heading);
  const form = document.createElement('form');
  form.onsubmit = (e) => {
    e.preventDefault();
    const groupNameInput = document.getElementById('group-name-input');
    const groupName = groupNameInput.value.trim();
    if (groupName) {
      fetch('/create-group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_name: groupName }) })
        .then(response => response.json()).then(data => {
          if (data.success) { createGroupInUI(data.group_id, groupName); document.body.removeChild(popupContainer); }
          else { const p = document.createElement('p'); p.textContent = 'Error: ' + data.message; p.style.color = 'red'; form.appendChild(p); }
        }).catch(error => { console.error('Error creating group:', error); const p = document.createElement('p'); p.textContent = 'Error creating group. Please try again.'; p.style.color = 'red'; form.appendChild(p); });
    } else { const p = document.createElement('p'); p.textContent = 'Please enter a group name.'; p.style.color = 'red'; form.appendChild(p); }
  };
  const inputDiv = document.createElement('div'); inputDiv.style.marginBottom = '15px';
  const label = document.createElement('label'); label.setAttribute('for', 'group-name-input'); label.textContent = 'Group Name:'; label.style.display = 'block'; label.style.marginBottom = '5px';
  const input = document.createElement('input'); input.type = 'text'; input.id = 'group-name-input'; input.placeholder = `Group ${document.querySelectorAll('.session-group').length + 1}`; Object.assign(input.style, { width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #ccc' });
  inputDiv.appendChild(label); inputDiv.appendChild(input); form.appendChild(inputDiv);
  const buttonContainer = document.createElement('div'); buttonContainer.style.display = 'flex'; buttonContainer.style.justifyContent = 'space-between';
  const createButton = document.createElement('button'); createButton.type = 'submit'; createButton.textContent = 'Create Group'; Object.assign(createButton.style, { padding: '8px 12px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' });
  const cancelButton = document.createElement('button'); cancelButton.type = 'button'; cancelButton.textContent = 'Cancel'; Object.assign(cancelButton.style, { padding: '8px 12px', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' });
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
        e.dataTransfer.setData('text/plain', txt); e.dataTransfer.effectAllowed = 'copy';
        window.__lastDraggedPromptElement = el;
        try {
          const rect = el.getBoundingClientRect(); const cs = getComputedStyle(el);
          const ghost = el.cloneNode(true);
          Object.assign(ghost.style, { position: 'fixed', top: '-10000px', left: '-10000px', width: rect.width + 'px', height: rect.height + 'px', boxSizing: 'border-box', background: cs.backgroundColor || '#007bff', color: cs.color || '#fff', borderRadius: cs.borderRadius || '15px', padding: cs.padding || '10px', lineHeight: cs.lineHeight, font: cs.font, whiteSpace: 'pre-wrap', boxShadow: '0 6px 14px rgba(0,0,0,0.18)', pointerEvents: 'none', zIndex: 9999, opacity: '1', overflow: 'hidden', backgroundClip: 'padding-box' });
          document.body.appendChild(ghost);
          const offsetX = (e.clientX || 0) - rect.left; const offsetY = (e.clientY || 0) - rect.top;
          if (e.dataTransfer && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(ghost, Math.max(0, Math.min(rect.width, offsetX)), Math.max(0, Math.min(rect.height, offsetY)));
          el.__dragGhost = ghost;
        } catch (_) { }
        chatgptRefBtn.classList.add('drop-target');
      });
      el.addEventListener('dragend', () => { chatgptRefBtn.classList.remove('drop-target'); if (el.__dragGhost) { try { el.__dragGhost.remove(); } catch(_) {} el.__dragGhost = null; } });
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
    let touchState = { active: false, el: null, ghost: null }; let longPressTimer = null;
    function startTouchDrag(el, touch) {
      touchState.active = true; touchState.el = el; const ghost = document.createElement('div'); ghost.textContent = 'Drag to Reference'; Object.assign(ghost.style, { position: 'fixed', left: touch.clientX + 'px', top: touch.clientY + 'px', transform: 'translate(-50%, -150%)', background: '#2d8cff', color: '#fff', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', zIndex: 9999 }); document.body.appendChild(ghost); touchState.ghost = ghost;
    }
    function endTouchDrag(touch) {
      if (!touchState.active) return; const rect = chatgptRefBtn.getBoundingClientRect(); const x = touch.clientX, y = touch.clientY; if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) { const txt = (touchState.el.innerText || touchState.el.textContent || '').trim(); window.__lastDroppedPromptText = txt; window.__lastDraggedPromptElement = touchState.el; showChatGPTReferencePopup(); }
      if (touchState.ghost) touchState.ghost.remove(); touchState = { active: false, el: null, ghost: null }; chatgptRefBtn.classList.remove('drop-target');
    }
    chatMessagesEl.addEventListener('touchstart', (e) => { const msg = e.target.closest && e.target.closest('.message.user'); if (!msg) return; if (longPressTimer) clearTimeout(longPressTimer); const t = e.touches[0]; longPressTimer = setTimeout(() => startTouchDrag(msg, t), 350); }, { passive: true });
    chatMessagesEl.addEventListener('touchmove', (e) => { if (!touchState.active || !touchState.ghost) return; const t = e.touches[0]; touchState.ghost.style.left = t.clientX + 'px'; touchState.ghost.style.top = t.clientY + 'px'; const rect = chatgptRefBtn.getBoundingClientRect(); const over = (t.clientX >= rect.left && t.clientX <= rect.right && t.clientY >= rect.top && t.clientY <= rect.bottom); chatgptRefBtn.classList.toggle('drop-target', over); }, { passive: true });
    chatMessagesEl.addEventListener('touchend', (e) => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } const t = e.changedTouches && e.changedTouches[0]; if (t) endTouchDrag(t); });
    chatMessagesEl.addEventListener('touchcancel', () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } if (touchState.ghost) touchState.ghost.remove(); touchState = { active: false, el: null, ghost: null }; chatgptRefBtn.classList.remove('drop-target'); });
  })();
}

function waitFor(predicate, intervalMs = 80, tries = 25) { return new Promise((resolve) => { let t = 0; const id = setInterval(() => { const val = typeof predicate === 'function' ? predicate() : null; if (val) { clearInterval(id); resolve(val); } else if (++t >= tries) { clearInterval(id); resolve(null); } }, intervalMs); }); }

async function ensureAssistantEditor() {
  let el = document.querySelector('.assistant-edit-mode .assistant-editable-content');
  if (el) return el;
  const firstAssistant = document.querySelector('#chat-messages .message.assistant');
  if (firstAssistant && !firstAssistant.classList.contains('edit-locked')) { firstAssistant.click(); el = await waitFor(() => document.querySelector('.assistant-edit-mode .assistant-editable-content')); }
  return el;
}

function buildChatGPTReferenceTextFromPrompt(promptText) {
  const now = new Date(); const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']; const formattedDate = `${now.getDate()} ${monthNames[now.getMonth()]} ${now.getFullYear()}`; const safePrompt = (promptText || '').trim().replace(/\s+/g,' ').slice(0,2000); const promptLine = safePrompt ? ` Response generated to the prompt: "${safePrompt}".` : ''; return `OpenAI (2025) ChatGPT [AI language model].${promptLine} Available at: https://chat.openai.com/ (Accessed: ${formattedDate}).`;
}

async function turingInsertReferenceAndPromptImage(editableEl, promptText, promptEl) {
  if (!editableEl) return;
  if (!window.html2canvas) {
  await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = '/vendor/html2canvas.min.js'; s.defer = true; s.onload = () => resolve(); s.onerror = () => reject(new Error('Failed to load html2canvas')); document.head.appendChild(s); });
  }
  function ensureFooter(el) { let footer = el.querySelector('[data-section="turing-footer"]'); if (!footer) { footer = document.createElement('div'); footer.setAttribute('data-section', 'turing-footer'); footer.style.marginTop = '16px'; if (el.lastChild) el.appendChild(document.createElement('br')); el.appendChild(footer); } if (footer !== el.lastChild) { el.appendChild(footer); } return footer; }
  function ensureSection(footer, key, titleText) { let section = footer.querySelector(`[data-section="${key}-section"]`); if (!section) { section = document.createElement('div'); section.setAttribute('data-section', `${key}-section`); const headingP = document.createElement('p'); const strong = document.createElement('strong'); strong.textContent = titleText; headingP.appendChild(strong); const body = document.createElement('div'); body.setAttribute('data-section', `${key}-body`); body.style.marginTop = '6px'; section.appendChild(headingP); section.appendChild(body); if (footer.lastChild) footer.appendChild(document.createElement('br')); footer.appendChild(section); } return section; }
  function getBody(section, key) { let body = section.querySelector(`[data-section="${key}-body"]`); if (!body) { body = document.createElement('div'); body.setAttribute('data-section', `${key}-body`); section.appendChild(body); } return body; }
  function moveOldSectionContentToFooter(el, key, titles, destBody) { const headings = Array.from(el.querySelectorAll('strong, b, h1, h2, h3, h4, h5, h6, p')).filter(n => { if (n.closest('[data-section="turing-footer"]')) return false; const txt = (n.textContent || '').trim().toLowerCase(); return titles.some(t => txt.startsWith(t.toLowerCase())); }); headings.forEach(h => { let cursor = h.nextSibling; const toMove = []; while (cursor && !(cursor.nodeType === 1 && /^(STRONG|B|H1|H2|H3|H4|H5|H6|P)$/.test(cursor.nodeName) && titles.concat(['references','prompts']).some(t => ((cursor.textContent||'').trim().toLowerCase().startsWith(t.toLowerCase())))) && !cursor.closest?.('[data-section="turing-footer"]')) { const next = cursor.nextSibling; toMove.push(cursor); cursor = next; } toMove.forEach(node => destBody.appendChild(node)); h.remove(); }); }
  const footer = ensureFooter(editableEl); const refsSection = ensureSection(footer, 'references', 'References'); const promptsSection = ensureSection(footer, 'prompts', 'Prompts'); const refsBody = getBody(refsSection, 'references'); const promptsBody = getBody(promptsSection, 'prompts');
  moveOldSectionContentToFooter(editableEl, 'references', ['References','Citations','Bibliography'], refsBody);
  moveOldSectionContentToFooter(editableEl, 'prompts', ['Prompts'], promptsBody);
  const refText = buildChatGPTReferenceTextFromPrompt(promptText); const refP = document.createElement('p'); refP.className = 'reference-item'; refP.textContent = refText; refsBody.appendChild(refP);
  const pair = turingFindPairFromPromptEl(promptEl) || turingFindDefaultPair(); if (!pair) return;
  const container = turingBuildCaptureContainer(pair); container.style.position = 'fixed'; container.style.left = '-10000px'; container.style.top = '0'; document.body.appendChild(container);
  try {
    await new Promise(r => setTimeout(r, 50));
    const canvas = await window.html2canvas(container, { backgroundColor: '#ffffff', scale: window.devicePixelRatio || 2 });
    const dataUrl = canvas.toDataURL('image/png');
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Prompt and AI excerpt';
    img.style.maxWidth = '100%';
    img.style.border = '1px solid #e5e7eb';
    img.style.borderRadius = '8px';
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
function turingBuildCaptureContainer(pair) { const wrap = document.createElement('div'); wrap.className = 'turing-capture-container'; Object.assign(wrap.style, { maxWidth: '760px', padding: '16px', background: '#ffffff', color: '#111827', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif', border: '1px solid #e5e7eb', borderRadius: '12px', boxShadow: '0 6px 18px rgba(0,0,0,0.08)' }); const h = document.createElement('div'); h.textContent = 'Chat excerpt'; h.style.fontWeight = '600'; h.style.marginBottom = '12px'; wrap.appendChild(h); const p = pair.promptEl.cloneNode(true); const a = pair.assistantEl.cloneNode(true); p.style.background = '#007bff'; p.style.color = '#ffffff'; p.style.textAlign = 'right'; p.style.marginLeft = 'auto'; a.style.background = '#f1f1f1'; a.style.color = '#000000'; a.style.width = '100%'; p.style.borderRadius = '15px'; a.style.borderRadius = '15px'; p.style.padding = '10px 12px'; a.style.padding = '10px 12px'; p.style.marginBottom = '8px'; p.querySelectorAll('.assistant-edit-toolbar, .assistant-edit-close').forEach(n => n.remove()); a.querySelectorAll('.assistant-edit-toolbar, .assistant-edit-close, .message-assistant-overlay').forEach(n => n.remove()); wrap.appendChild(p); wrap.appendChild(a); return wrap; }


function setupReferenceImageActions() {
  const copyBtn = document.getElementById('copy-image-btn');
  const dlBtn = document.getElementById('download-image-btn');
  if (!copyBtn || !dlBtn) return;
  function findPairFromPromptEl(promptEl) { if (!promptEl) return null; let ai = promptEl.nextElementSibling; while (ai && !(ai.classList && ai.classList.contains('assistant'))) ai = ai.nextElementSibling; if (!ai) ai = document.querySelector('#chat-messages .message.assistant:last-of-type'); return ai ? { promptEl, assistantEl: ai } : null; }
  function findDefaultPair() { const ai = document.querySelector('#chat-messages .message.assistant:last-of-type'); if (!ai) return null; let user = ai.previousElementSibling; while (user && !(user.classList && user.classList.contains('user'))) user = user.previousElementSibling; return user ? { promptEl: user, assistantEl: ai } : null; }
  function buildCaptureContainer(pair) { const wrap = document.createElement('div'); wrap.className = 'turing-capture-container'; Object.assign(wrap.style, { maxWidth: '760px', padding: '16px', background: '#ffffff', color: '#111827', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif', border: '1px solid #e5e7eb', borderRadius: '12px', boxShadow: '0 6px 18px rgba(0,0,0,0.08)' }); const h = document.createElement('div'); h.textContent = 'Chat excerpt'; h.style.fontWeight = '600'; h.style.marginBottom = '12px'; wrap.appendChild(h); const p = pair.promptEl.cloneNode(true); const a = pair.assistantEl.cloneNode(true); p.style.background = '#007bff'; p.style.color = '#ffffff'; p.style.textAlign = 'right'; p.style.marginLeft = 'auto'; a.style.background = '#f1f1f1'; a.style.color = '#000000'; a.style.width = '100%'; p.style.borderRadius = '15px'; a.style.borderRadius = '15px'; p.style.padding = '10px 12px'; a.style.padding = '10px 12px'; p.style.marginBottom = '8px'; p.querySelectorAll('.assistant-edit-toolbar, .assistant-edit-close').forEach(n => n.remove()); a.querySelectorAll('.assistant-edit-toolbar, .assistant-edit-close, .message-assistant-overlay').forEach(n => n.remove()); wrap.appendChild(p); wrap.appendChild(a); return wrap; }
  async function renderImageCanvas(container) { if (!window.html2canvas) throw new Error('html2canvas not loaded'); await new Promise(r => setTimeout(r, 50)); return await window.html2canvas(container, { backgroundColor: '#ffffff', scale: window.devicePixelRatio || 2 }); }
  async function copyImageFlow() { try { const pair = findPairFromPromptEl(window.__lastDraggedPromptElement) || findDefaultPair(); if (!pair) return alert('Could not find a user prompt and assistant reply to export.'); const cont = buildCaptureContainer(pair); cont.style.position = 'fixed'; cont.style.left = '-10000px'; cont.style.top = '0'; document.body.appendChild(cont); try { const canvas = await renderImageCanvas(cont); const blob = await new Promise(res => canvas.toBlob(res, 'image/png')); const item = new ClipboardItem({ 'image/png': blob }); await navigator.clipboard.write([item]); } finally { cont.remove(); } } catch (e) { console.error('Copy image failed, falling back to download:', e); await downloadImageFlow(); } }
  async function downloadImageFlow() { try { const pair = findPairFromPromptEl(window.__lastDraggedPromptElement) || findDefaultPair(); if (!pair) return alert('Could not find a user prompt and assistant reply to export.'); const cont = buildCaptureContainer(pair); cont.style.position = 'fixed'; cont.style.left = '-10000px'; cont.style.top = '0'; document.body.appendChild(cont); try { const canvas = await renderImageCanvas(cont); const a = document.createElement('a'); a.download = 'chat-snippet.png'; a.href = canvas.toDataURL('image/png'); document.body.appendChild(a); a.click(); a.remove(); } finally { cont.remove(); } } catch (e) { console.error('Download image failed:', e); alert('Unable to create image. Please try again.'); } }
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
  closeBtn.addEventListener('click', () => exitAssistantEditMode(wrapper, false, targetAssistant));

  const toolbar = document.createElement('div');
  toolbar.className = 'assistant-edit-toolbar';
  // Simple toolbar: Save / Cancel
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => saveEdit());
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => exitAssistantEditMode(wrapper, false, targetAssistant));
  toolbar.appendChild(saveBtn);
  toolbar.appendChild(cancelBtn);

  const editable = document.createElement('div');
  editable.className = 'assistant-editable-content';
  editable.contentEditable = 'true';
  // Populate with the message content (preserve basic markup)
  const contentEl = targetAssistant.querySelector('.message-content');
  // sanitize the content before allowing editing to avoid executing scripts
  editable.innerHTML = sanitizeHtml(contentEl ? contentEl.innerHTML : '');

  wrapper.appendChild(closeBtn);
  wrapper.appendChild(toolbar);
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
      if (contentEl) contentEl.innerHTML = cleaned;
      targetAssistant.dataset.edited = '1';
      // Attempt to persist change to the server if message_id present
      const messageId = targetAssistant.dataset.messageId;
      // Always include session_id for server-side fallback; only send message_id when it's a valid integer
      const payload = { content: cleaned, session_id };
      const parsed = parseInt(messageId, 10);
      if (!Number.isNaN(parsed)) payload.message_id = parsed;
      try {
        await fetch('/update-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (err) { console.warn('Failed to persist edited message:', err); }
    } finally {
      exitAssistantEditMode(wrapper, true, targetAssistant);
    }
  }

  return wrapper;
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
});
