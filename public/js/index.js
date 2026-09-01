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

// Hide the welcome screen once the first message is appended
function hideWelcomeState() {
  const welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.remove();
}

function createAssistantHeader() {
  const headerDiv = document.createElement('div');
  headerDiv.className = 'message-assistant-header';
  headerDiv.innerHTML = `
    <div class="assistant-avatar">
      <img src="Alanbotlogo.svg" alt="Turing Tutor Logo" class="assistant-avatar-img">
    </div>
    <span class="assistant-name">Turing Tutor</span>
  `;
  return headerDiv;
}

function syncTuringMessageEmptyState(messageElement) {
  if (!messageElement?.classList.contains('turing-message')) return;

  const content = messageElement.querySelector('.message-content');
  const footer = messageElement.querySelector('[data-section="turing-footer"], .turing-footer');
  const meaningfulSelector = 'img, video, audio, table, pre, blockquote, ul li, ol li, hr';
  const hasMeaningfulContent = (element) => Boolean(element && (
    (element.textContent || '').replace(/\u200B/g, '').trim() ||
    element.querySelector(meaningfulSelector)
  ));

  messageElement.classList.toggle(
    'turing-message-empty',
    !hasMeaningfulContent(content) && !hasMeaningfulContent(footer)
  );
}

function showWelcomeState() {
  const cm = chatMessages || document.getElementById('chat-messages');
  if (!cm) return;
  cm.innerHTML = `
    <div id="chat-welcome" class="chat-welcome">
        <div class="chat-welcome-inner">
            <div class="chat-welcome-logo">
                <img src="sdc-logo.svg" alt="SDC Logo" height="40">
            </div>
            <h2 class="chat-welcome-title">How can I help you today?</h2>
            <p class="chat-welcome-subtitle">Start a conversation or try one of these prompts:</p>
            <div class="chat-starter-prompts">
                <button class="chat-starter-btn"
                    data-prompt="Explain this topic in a way a student can understand and give me 3 key points to remember.">
                    <span class="starter-icon">📚</span>
                    <span class="starter-text">Explain a topic simply<br><small>Get a clear breakdown with key points</small></span>
                </button>
                <button class="chat-starter-btn"
                    data-prompt="Help me plan an essay on this subject. Include structure, arguments and evidence.">
                    <span class="starter-icon">📝</span>
                    <span class="starter-text">Plan an essay<br><small>Structure your arguments & key points</small></span>
                </button>
                <button class="chat-starter-btn"
                    data-prompt="Give me feedback on this work. Highlight strengths and areas for improvement.">
                    <span class="starter-icon">💡</span>
                    <span class="starter-text">Get feedback on work<br><small>Strengths & areas to improve</small></span>
                </button>
            </div>
        </div>
    </div>`;

  cm.querySelectorAll('.chat-starter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      if (prompt) {
        const msgInput = document.getElementById('message-input');
        if (msgInput) {
          msgInput.value = prompt;
          msgInput.focus();
          msgInput.dispatchEvent(new Event('input'));
        }
      }
    });
  });
}

// Local storage manager for offline / guest persistence
const LocalStore = {
  getSessions() {
    try {
      const data = localStorage.getItem('turing_sessions');
      return data ? JSON.parse(data) : [];
    } catch (_) { return []; }
  },
  saveSessions(sessions) {
    try {
      localStorage.setItem('turing_sessions', JSON.stringify(sessions));
    } catch (_) {}
  },
  createSession(name, isTuring = false) {
    const sessions = this.getSessions();
    const id = Date.now();
    const newSess = {
      id,
      session_name: name || (isTuring ? 'Turing Mode' : `Session ${Date.now()}`),
      is_turing: isTuring ? 1 : 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      group_id: null
    };
    sessions.unshift(newSess);
    this.saveSessions(sessions);
    this.saveScaleLevel(id, 1);
    return newSess;
  },
  deleteSession(sessionId) {
    const sessions = this.getSessions().filter(s => String(s.id) !== String(sessionId));
    this.saveSessions(sessions);
    try {
      localStorage.removeItem(`turing_msgs_${sessionId}`);
      localStorage.removeItem(`turing_fb_${sessionId}`);
      localStorage.removeItem(`turing_scales_${sessionId}`);
    } catch (_) {}
  },
  renameSession(sessionId, newName) {
    const sessions = this.getSessions();
    const sess = sessions.find(s => String(s.id) === String(sessionId));
    if (sess) {
      sess.session_name = newName;
      sess.updated_at = new Date().toISOString();
      this.saveSessions(sessions);
    }
  },
  updateSessionGroup(sessionId, groupId) {
    const sessions = this.getSessions();
    const sess = sessions.find(s => String(s.id) === String(sessionId));
    if (sess) {
      sess.group_id = groupId;
      sess.updated_at = new Date().toISOString();
      this.saveSessions(sessions);
    }
  },
  getMessages(sessionId) {
    try {
      const data = localStorage.getItem(`turing_msgs_${sessionId}`);
      return data ? JSON.parse(data) : [];
    } catch (_) { return []; }
  },
  saveMessages(sessionId, messages) {
    try {
      localStorage.setItem(`turing_msgs_${sessionId}`, JSON.stringify(messages));
    } catch (_) {}
  },
  addMessage(sessionId, message) {
    const msgs = this.getMessages(sessionId);
    const msgId = message.message_id || message.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newMsg = {
      id: msgId,
      message_id: msgId,
      session_id: sessionId,
      role: message.role || 'user',
      content: message.content || '',
      collapsed: message.collapsed || 0,
      scale_level: message.scale_level || 1,
      references: message.references || [],
      prompts: message.prompts || [],
      timestamp: Date.now()
    };
    msgs.push(newMsg);
    this.saveMessages(sessionId, msgs);
    return newMsg;
  },
  updateMessageContent(messageId, content, references, prompts) {
    const sessions = this.getSessions();
    for (const sess of sessions) {
      const msgs = this.getMessages(sess.id);
      let found = false;
      for (const m of msgs) {
        if (String(m.id) === String(messageId) || String(m.message_id) === String(messageId)) {
          m.content = content;
          if (references !== undefined) m.references = references;
          if (prompts !== undefined) m.prompts = prompts;
          found = true;
          break;
        }
      }
      if (found) {
        this.saveMessages(sess.id, msgs);
        break;
      }
    }
  },
  getFeedback(sessionId) {
    try {
      const data = localStorage.getItem(`turing_fb_${sessionId}`);
      return data ? JSON.parse(data) : [];
    } catch (_) { return []; }
  },
  saveFeedback(sessionId, feedback) {
    try {
      const current = this.getFeedback(sessionId);
      current.push(feedback);
      localStorage.setItem(`turing_fb_${sessionId}`, JSON.stringify(current));
    } catch (_) {}
  },
  getScaleLevels(sessionId) {
    try {
      const data = localStorage.getItem(`turing_scales_${sessionId}`);
      return data ? JSON.parse(data) : [1];
    } catch (_) { return [1]; }
  },
  saveScaleLevel(sessionId, level) {
    try {
      const current = this.getScaleLevels(sessionId);
      if (!current.includes(level)) current.push(level);
      localStorage.setItem(`turing_scales_${sessionId}`, JSON.stringify(current));
    } catch (_) {}
  },
  getGroups() {
    try {
      const data = localStorage.getItem('turing_groups');
      return data ? JSON.parse(data) : [];
    } catch (_) { return []; }
  },
  saveGroups(groups) {
    try {
      localStorage.setItem('turing_groups', JSON.stringify(groups));
    } catch (_) {}
  },
  createGroup(name) {
    const groups = this.getGroups();
    const newGroup = { id: `grp_${Date.now()}`, group_name: name || 'Unnamed Group' };
    groups.push(newGroup);
    this.saveGroups(groups);
    return newGroup;
  },
  deleteGroup(groupId) {
    const groups = this.getGroups().filter(g => String(g.id) !== String(groupId));
    this.saveGroups(groups);
    const sessions = this.getSessions();
    sessions.forEach(s => { if (String(s.group_id) === String(groupId)) s.group_id = null; });
    this.saveSessions(sessions);
  },
  renameGroup(groupId, newName) {
    const groups = this.getGroups();
    const grp = groups.find(g => String(g.id) === String(groupId));
    if (grp) {
      grp.group_name = newName;
      this.saveGroups(groups);
    }
  }
};

// Initialize WebSocket connection if available (for local Node server)
let ws = null;
try {
  // Only connect WebSocket if running on localhost or with explicit WebSocket backend
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    const wsProtocol = (location.protocol === 'https:') ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${location.host}`;
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => console.debug('WebSocket connected to', wsUrl));
    ws.addEventListener('error', () => console.debug('WebSocket not available, will use HTTP streaming'));
  }
} catch (e) {
  console.debug('WebSocket not supported or failed to initialize:', e);
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
let isNewSession = false;
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

function handleWebSocketMessage(message) {
  try {
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
        const headerDiv = createAssistantHeader();
        botMessageDiv.appendChild(headerDiv);
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
            span.innerHTML = '🔑 Copying or directly using this response breaches academic integrity guidelines';
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
        try {
          const activeEditor = document.querySelector('.assistant-edit-mode');
          activeEditor?.querySelector('.decipher-wait-overlay')?.classList.remove('visible', 'cogs-ready');
          activeEditor?.classList.remove('decipher-active');
          activeEditor?.__handleDecipherDone?.(true);
        } catch(_) {}
        // Clear loading state and debounce flag when feedback arrives
        try { setCriteriaLoading(false); } catch(_) {}
        window.__decipherInFlight = false;
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
        window.__decipherInFlight = false;
        try {
          const activeEditor = document.querySelector('.assistant-edit-mode');
          activeEditor?.__handleDecipherDone?.(false);
        } catch(_) {}
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
    } else if (message.type === 'session-renamed' || message.type === 'session-name-updated') {
      const targetId = message.session_id;
      const newTitle = message.session_name || message.title;
      if (targetId && newTitle) {
        const sessionBtn = document.getElementById(`session-${targetId}`);
        if (sessionBtn) {
          const span = sessionBtn.querySelector('.session-name, .turing-name');
          if (span) span.textContent = newTitle;
        } else {
          loadSessions();
        }
      }
    }
  } catch (e) {
    console.error('Error in handleWebSocketMessage:', e);
  }
}

if (ws) {
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    } catch (e) {
      console.error('Error parsing WebSocket message:', e);
    }
  };
}

async function sendViaHttpStream(messageContent, targetSessionId) {
  try {
    const localMsgs = LocalStore.getMessages(targetSessionId);
    const conversationHistory = localMsgs.map(m => ({ role: m.role, content: m.content }));

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: messageContent,
        session_id: targetSessionId,
        conversationHistory,
        is_turing: !!window.__isTuringFlag
      })
    });

    if (!res.ok) {
      console.error('Chat API stream failed:', res.status);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'done') {
              if (data.fullContent) {
                LocalStore.addMessage(targetSessionId, {
                  role: 'assistant',
                  content: data.fullContent,
                  scale_level: 1,
                  collapsed: 0
                });
              }
            } else if (data.type === 'scale') {
              if (Array.isArray(data.data) && data.data.length > 0) {
                LocalStore.saveScaleLevel(targetSessionId, data.data[0]);
              }
              handleWebSocketMessage(data);
            } else if (data.type === 'feedback') {
              LocalStore.saveFeedback(targetSessionId, {
                messageId: data.message_id || 'stream',
                feedbackContent: data.content
              });
              handleWebSocketMessage(data);
            } else if (data.type === 'session-renamed') {
              LocalStore.renameSession(targetSessionId, data.session_name || data.title);
              handleWebSocketMessage(data);
            } else {
              handleWebSocketMessage(data);
            }
          } catch (_) {}
        }
      }
    }
  } catch (err) {
    console.error('Error in sendViaHttpStream:', err);
  }
}

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

// Expand tools UI when a draggable item is dragged over the tools toggle.
(() => {
  const toolsToggle = document.getElementById('tools-toggle');
  const promptHeader = toolsToggle ? toolsToggle.closest('.prompt-header') : null;
  if (!toolsToggle || !promptHeader) return;

  function addExpanded() { promptHeader.classList.add('expanded'); }
  function removeExpanded() { promptHeader.classList.remove('expanded'); }

  toolsToggle.addEventListener('dragenter', (e) => { e.preventDefault(); addExpanded(); });
  toolsToggle.addEventListener('dragover', (e) => { e.preventDefault(); addExpanded(); });
  toolsToggle.addEventListener('dragleave', (e) => { removeExpanded(); });
  toolsToggle.addEventListener('drop', removeExpanded);

  // Also listen on the whole promptHeader so a dragged item that moves across
  // the revealed area collapses correctly.
  promptHeader.addEventListener('dragleave', (e) => { removeExpanded(); });
})();

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
  
  let maxLevel = 1;
  if (activeLevels.size > 0) {
    maxLevel = Math.max(...Array.from(activeLevels));
  }
  
  const scaleNames = {
    5: "Full AI",
    4: "AI + Human Evaluation",
    3: "AI Editing",
    2: "Ideas & Structure",
    1: "No AI"
  };
  
  const summaryTitle = document.getElementById('summary-assessment-title');
  if (summaryTitle) {
    summaryTitle.textContent = scaleNames[maxLevel] || "No AI";
  }

  document.querySelectorAll('.scale-item').forEach(item => {
    const level = parseInt(item.id.replace('scale-', ''), 10);
    if (activeLevels.has(level)) {
      item.classList.add('active');
      item.classList.remove('inactive');
    } else {
      item.classList.add('inactive');
      item.classList.remove('active');
    }
    
    if (level === maxLevel) {
      item.classList.add('current-assessment');
    } else {
      item.classList.remove('current-assessment');
    }
  });
}

function resetScale() {
  activeLevels.clear();
  document.querySelectorAll('.scale-item').forEach(item => {
    item.classList.add('inactive');
    item.classList.remove('active');
    item.classList.remove('current-assessment');
  });
  const summaryTitle = document.getElementById('summary-assessment-title');
  if (summaryTitle) {
    summaryTitle.textContent = "No AI";
  }
}

function handleKeyPress(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

async function sendMessage() {
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

    if (!session_id) {
      let createdId = null;
      try {
        const response = await fetch('/start-session', { method: 'POST' });
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            createdId = data.session_id;
          }
        }
      } catch (error) {
        console.debug('Server start-session failed, using LocalStore:', error);
      }

      if (!createdId) {
        const newSess = LocalStore.createSession();
        createdId = newSess.id;
      }

      session_id = createdId;
      isNewSession = true;
      highlightCurrentSession(session_id);
    }

    const resource_ids = (typeof ResourcesApp !== 'undefined') ? ResourcesApp.getAttachedResourceIds() : [];
    const currentAttached = (typeof ResourcesApp !== 'undefined') ? ResourcesApp.getAttachedResources() : [];

    // Persist user message locally
    LocalStore.addMessage(session_id, { 
      role: 'user', 
      content: message,
      references: currentAttached.map(r => ({ id: r.id, title: r.title, url: r.url, domain: r.domain, type: r.type }))
    });

    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ content: message, session_id, resource_ids }));
      } else {
        sendViaHttpStream(message, session_id);
      }

      const currentBtn = document.getElementById(`session-${session_id}`);
      const currentSpan = currentBtn ? currentBtn.querySelector('.session-name, .turing-name') : null;
      const currentName = currentSpan ? (currentSpan.textContent || '') : '';
      const isDefaultTitle = !currentName || /^Session(\s+\d+)?$/i.test(currentName.trim()) || /^Session\s+\d{10,}/i.test(currentName.trim());

      if (isNewSession || isDefaultTitle) {
        isNewSession = false;
        const titlingUrl = (location.hostname === 'localhost' && ws) ? '/generate-session-title' : '/api/generate-title';
        fetch(titlingUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CSRF-Token': window.csrfToken || ''
          },
          body: JSON.stringify({ session_id, prompt: message })
        }).then(res => res.json()).then(data => {
          if (data.success && (data.title || data.session_name)) {
            const newTitle = data.title || data.session_name;
            LocalStore.renameSession(session_id, newTitle);
            const sessionBtn = document.getElementById(`session-${session_id}`);
            if (sessionBtn) {
              const span = sessionBtn.querySelector('.session-name, .turing-name');
              if (span) span.textContent = newTitle;
            } else {
              loadSessions().then(() => highlightCurrentSession(session_id));
            }
          }
        }).catch(e => console.debug('Error generating session title:', e));
      }
    } catch (err) {
      console.error('Send message failed:', err);
    }
    const userMessage = document.createElement('div');
    userMessage.className = 'message user';
    const previousMapping = feedbackMapping[feedbackMapping.length - 1];
    const hasFeedback = previousMapping && previousMapping.feedbackContainer && previousMapping.feedbackContainer.style.display !== 'none' && previousMapping.feedbackContainer.querySelector('.feedback-message') && previousMapping.feedbackContainer.querySelector('.feedback-message').textContent.trim() !== '';
    if (hasFeedback) setDynamicTopMargin(userMessage, previousMapping.feedbackContainer);

    // Render attached resource badges if any were included
    if (currentAttached.length > 0) {
      const badgeContainer = document.createElement('div');
      badgeContainer.className = 'msg-attached-resources';
      currentAttached.forEach(r => {
        const badge = document.createElement('a');
        badge.className = 'msg-resource-badge';
        badge.href = r.url || '#';
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        const isDoc = r.type === 'document';
        badge.innerHTML = `${isDoc ? '📄' : '🌐'} <span>${escapeHtml(r.title || r.url || 'Resource')}</span>`;
        badgeContainer.appendChild(badge);
      });
      userMessage.appendChild(badgeContainer);
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'message-text';
    textSpan.textContent = message;
    const metaSpan = document.createElement('span');
    metaSpan.className = 'message-meta';
    const now = new Date();
    metaSpan.innerHTML = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 6 11 13 8 10"></polyline><polyline points="22 6 15 13 12 10"></polyline></svg>`;
    userMessage.appendChild(textSpan);
    userMessage.appendChild(metaSpan);
    const oldPlaceholder = chatMessages.querySelector('.user.placeholder-message');
    if (oldPlaceholder) oldPlaceholder.remove();
    chatMessages.appendChild(userMessage);
    hideWelcomeState();

    // Clear attached chips after sending
    if (typeof ResourcesApp !== 'undefined') {
      ResourcesApp.clearAttachedResources();
    }

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
      <span>🔑 Copying or directly using this response breaches academic integrity guidelines</span>
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
  const hasRealMessages = Array.isArray(messages) && messages.some(msg => msg && msg.content && msg.content.trim() !== '');
  if (!hasRealMessages && !window.__isTuringFlag) {
    showWelcomeState();
    return;
  }
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
      const headerDiv = createAssistantHeader();
      messageElement.appendChild(headerDiv);
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
  const turingContainer = document.getElementById('turing-mode-container') || document.getElementById('new-chats');
  if (turingContainer) turingContainer.innerHTML = '';
  try {
    let sessions = [];
    try {
      const response = await fetch('/sessions');
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.sessions)) {
          sessions = data.sessions.slice();
        }
      }
    } catch (_) {}

    if (sessions.length === 0) {
      sessions = LocalStore.getSessions();
    }

    if (sessions.length > 0) {
      const sessionNumberMap = buildSessionNumberMap(sessions);
      sessions.sort((a, b) => getSessionSortValue(b) - getSessionSortValue(a));
      sessions.forEach((session) => {
        if (Number(session.is_turing) === 1) {
          const btn = document.createElement('button');
          btn.className = 'session-button turing-session';
          const name = session.session_name || 'Turing Mode';
          btn.id = `session-${session.id}`;
          btn.innerHTML = `
            <div class="turing-left">
              <img class="turing-mode-icon" src="ChatGPT Image Oct 13, 2025, 01_56_50 PM.png" alt="">
              <span class="turing-name" contenteditable="false" spellcheck="false" style="outline: none;">${escapeHtml(name)}</span>
            </div>
            <span class="edit-icon" title="Edit">✎</span>
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
              const newName = (e.target.textContent || '').trim() || name;
              e.target.contentEditable = 'false';
              renameSessionOnServer(session.id, newName);
          });
          btn.querySelector('.turing-name').addEventListener('keydown', (e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
          });
          btn.querySelector('.turing-name').addEventListener('click', (e) => {
              if (e.currentTarget.isContentEditable) e.stopPropagation();
          });
          btn.querySelector('.edit-icon').addEventListener('click', (e) => {
              e.stopPropagation();
              const span = btn.querySelector('.turing-name');
              span.contentEditable = 'true';
              span.focus();
              const range = document.createRange();
              range.selectNodeContents(span);
              range.collapse(false);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
          });
          const del = btn.querySelector('.delete-icon');
          del.onclick = (event) => { event.stopPropagation(); deleteSession(session.id, btn.parentElement.id); };
          turingContainer.appendChild(btn);
          return;
        }
        const button = document.createElement('button');
        button.className = 'session-button';
        const sessionNumber = sessionNumberMap.get(session.id);
        const labelText = session.session_name || formatSessionLabel(sessionNumber, session.created_at || session.updated_at);
        button.id = `session-${session.id}`;
        button.draggable = true;
        button.ondragstart = drag;
        button.innerHTML = `
          <div class="session-name-container" style="flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <span class="session-name" contenteditable="false" spellcheck="false" style="outline: none;">${escapeHtml(labelText)}</span>
          </div>
          <span class="edit-icon" title="Edit">✎</span>
          <span class="delete-icon" title="Delete">🗑</span>
        `;
        button.onclick = () => loadSessionHistory(session.id);
        
        button.querySelector('.session-name').addEventListener('blur', (e) => {
            const newName = (e.target.textContent || '').trim() || labelText;
            e.target.contentEditable = 'false';
            renameSessionOnServer(session.id, newName);
        });
        button.querySelector('.session-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        });
        button.querySelector('.session-name').addEventListener('click', (e) => {
            if (e.currentTarget.isContentEditable) e.stopPropagation();
        });
        button.querySelector('.edit-icon').addEventListener('click', (e) => {
            e.stopPropagation();
            const span = button.querySelector('.session-name');
            span.contentEditable = 'true';
            span.focus();
            document.execCommand('selectAll', false, null);
        });
        const deleteIcon = button.querySelector('.delete-icon');
        deleteIcon.onclick = (event) => { event.stopPropagation(); deleteSession(session.id, button.parentElement.id); };
        if (session.group_id) {
          const groupList = document.getElementById(`session-list-group-${session.group_id}`);
          if (groupList) groupList.appendChild(button); else document.getElementById('new-chats').appendChild(button);
        } else {
          document.getElementById('new-chats').appendChild(button);
        }
      });
    }
  } catch (error) {
    console.debug('Error fetching sessions:', error);
  }
}

async function loadSessionHistory(sessionId) {
  hideAndStoreFeedback(session_id);
  session_id = sessionId;
  resetScale();
  highlightCurrentSession(sessionId); 

  let data = null;
  try {
    const response = await fetch(`/messages?session_id=${sessionId}`);
    if (response.ok) {
      const parsed = await response.json();
      if (parsed.success) data = parsed;
    }
  } catch (_) {}

  if (!data) {
    const sessions = LocalStore.getSessions();
    const localSess = sessions.find(s => String(s.id) === String(sessionId));
    data = {
      success: true,
      is_turing: localSess ? localSess.is_turing : 0,
      messages: LocalStore.getMessages(sessionId),
      feedbackData: LocalStore.getFeedback(sessionId),
      scale_levels: LocalStore.getScaleLevels(sessionId)
    };
  }

  if (data && data.success) {
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

        // Render any stored attached resource references
        const refs = Array.isArray(msg.references) ? msg.references : (typeof msg.references === 'string' ? JSON.parse(msg.references || '[]') : []);
        if (refs && refs.length > 0) {
          const badgeContainer = document.createElement('div');
          badgeContainer.className = 'msg-attached-resources';
          refs.forEach(r => {
            const badge = document.createElement('a');
            badge.className = 'msg-resource-badge';
            badge.href = r.url || '#';
            badge.target = '_blank';
            badge.rel = 'noopener noreferrer';
            const isDoc = r.type === 'document';
            badge.innerHTML = `${isDoc ? '📄' : '🌐'} <span>${escapeHtml(r.title || r.url || 'Resource')}</span>`;
            badgeContainer.appendChild(badge);
          });
          userMessageDiv.appendChild(badgeContainer);
        }

        const textSpan = document.createElement('span');
        textSpan.className = 'message-text';
        textSpan.textContent = msg.content;
        const metaSpan = document.createElement('span');
        metaSpan.className = 'message-meta';
        const now = new Date();
        metaSpan.innerHTML = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 6 11 13 8 10"></polyline><polyline points="22 6 15 13 12 10"></polyline></svg>`;
        userMessageDiv.dataset.messageId = msg.message_id;
        userMessageDiv.appendChild(textSpan);
        userMessageDiv.appendChild(metaSpan);
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
        const headerDiv = createAssistantHeader();
        assistantMessageDiv.appendChild(headerDiv);
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
        overlayText.innerHTML = '🔑 Copying or directly using this response breaches academic integrity guidelines';
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
        syncTuringMessageEmptyState(assistantMessageDiv);
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
    }
    const userMessages = chatMessages.querySelectorAll('.message.user');
    const lastUserMessage = userMessages[userMessages.length - 1];
    let lastUserFeedback = null; let lastUserScaleLevel = null;
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      if (data.feedbackData && data.feedbackData.length > 0) lastUserFeedback = data.feedbackData.find(fb => String(fb.messageId) === String(lastMsg.message_id));
      lastUserScaleLevel = lastMsg.scale_level || 1;
    }
    if (lastUserMessage && lastUserFeedback && lastUserScaleLevel >= 3) lastUserMessage.style.marginBottom = '80px'; else if (lastUserMessage) lastUserMessage.style.marginBottom = '';
    chatMessages.scrollTop = chatMessages.scrollHeight;
    window.__lastFeedbackData = isTuring ? [] : (data.feedbackData || []);
    if (!isTuring && window.__lastFeedbackData.length) showFeedbackForSavedSession(sessionId, window.__lastFeedbackData);
    updateScale(data.scale_levels || [1]);
  }
}

async function deleteSession(sessionId, parentElementId) {
  LocalStore.deleteSession(sessionId);
  try {
    await fetch(`/delete-session?session_id=${sessionId}`, { method: 'DELETE' });
  } catch (_) {}
  const sessionButton = document.getElementById(`session-${sessionId}`);
  if (sessionButton) sessionButton.remove();
  const parentElement = document.getElementById(parentElementId);
  if (parentElement) parentElement.id = parentElementId;
  chatMessages.innerHTML = '';
  document.querySelectorAll('.feedback-container').forEach(container => { container.classList.add('hidden'); });
  startNewChat();
}

async function startNewChat() {
  hideAndStoreFeedback(session_id);
  session_id = null;
  isNewSession = true;
  try {
    const cm = chatMessages || document.getElementById('chat-messages');
    if (cm) {
      cm.innerHTML = '';
      showWelcomeState();
    }
    resetScale();
    document.querySelectorAll('.session-button').forEach(btn => btn.classList.remove('active'));
  } catch (error) { console.error('Error starting a new session:', error); }
}

// Format: "Session {n} : dd/mm/yy hh:mm" with a 24-hour clock
function formatSessionLabel(sessionNumber, ts) {
  let ms = safeTimestampToMs(ts);
  if (ms === null) ms = Date.now();
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const prefix = sessionNumber ? `Session ${sessionNumber}` : 'Session';
  return `${prefix} : ${dd}/${mm}/${yy} ${hh}:${min}`;
}

function buildSessionNumberMap(sessions = []) {
  const map = new Map();
  const standardSessions = sessions.filter((session) => Number(session.is_turing) !== 1);
  standardSessions.sort((a, b) => {
    const aTime = safeTimestampToMs(a.created_at) ?? safeTimestampToMs(a.updated_at) ?? Number(a.id) ?? 0;
    const bTime = safeTimestampToMs(b.created_at) ?? safeTimestampToMs(b.updated_at) ?? Number(b.id) ?? 0;
    if (aTime === bTime) return (Number(a.id) || 0) - (Number(b.id) || 0);
    return aTime - bTime;
  });
  standardSessions.forEach((session, idx) => {
    map.set(session.id, idx + 1);
  });
  return map;
}

function getSessionSortValue(session) {
  const updated = safeTimestampToMs(session && session.updated_at);
  if (updated !== null) return updated;
  const created = safeTimestampToMs(session && session.created_at);
  if (created !== null) return created;
  const fallback = Number(session && session.id);
  return Number.isFinite(fallback) ? fallback : 0;
}

function safeTimestampToMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (!value && value !== 0) return null;
  const d = new Date(value);
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : ms;
}

async function startTuringMode() {
  try {
    let newSessId = null;
    let newMsgId = null;
    try {
      const res = await fetch('/start-turing', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          newSessId = data.session_id;
          newMsgId = data.message_id;
        }
      }
    } catch (_) {}

    if (!newSessId) {
      const sess = LocalStore.createSession('Turing Mode', true);
      newSessId = sess.id;
      const blankMsg = LocalStore.addMessage(newSessId, { role: 'assistant', content: '', scale_level: 1, collapsed: 0 });
      newMsgId = blankMsg.id;
    }

    session_id = newSessId;
    isNewSession = true;
    __turingInitialMessageId = newMsgId || null;
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
  LocalStore.renameSession(id, name);
  fetch('/rename-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: id, session_name: name }) })
    .catch(() => {});
}

window.addEventListener('beforeunload', () => { if (session_id) hideAndStoreFeedback(session_id); });

function saveFeedbackToServer(feedbackContent, message_id = null) {
  if (session_id) {
    LocalStore.saveFeedback(session_id, { messageId: message_id || 'stream', feedbackContent });
  }
  fetch('/save-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id, feedbackContent, message_id }) })
    .catch(() => {});
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
      const localGrp = LocalStore.createGroup(groupName);
      createGroupInUI(localGrp.id, groupName);
      try { document.body.removeChild(popupContainer); } catch(_) {}
      fetch('/create-group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_name: groupName }) })
        .catch(() => {});
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
    const localGrp = LocalStore.createGroup(groupName.trim());
    createGroupInUI(localGrp.id, groupName.trim());
    fetch('/create-group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_name: groupName.trim() }) })
      .catch(() => {});
  }
}

function createGroupInUI(groupId, groupName) {
  const existing = document.getElementById(`group-${groupId}`);
  if (existing) return;
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
    LocalStore.deleteGroup(groupId);
    const groupElement = document.getElementById(`group-${groupId}`);
    if (groupElement) {
      const sessions = groupElement.querySelectorAll('.session-button');
      const newChats = document.getElementById('new-chats');
      sessions.forEach(session => { newChats.appendChild(session); });
      groupElement.remove();
    }
    fetch(`/delete-group?group_id=${groupId}`, { method: 'DELETE' })
      .catch(() => {});
  }
}

function renameGroup(element, groupId) {
  const newName = element.textContent.trim() || 'Unnamed Group';
  element.textContent = newName;
  LocalStore.renameGroup(groupId, newName);
  fetch('/rename-group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_id: groupId, group_name: newName }) })
    .catch(() => {});
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
  LocalStore.updateSessionGroup(sessionId, groupId === 'new-chats' ? null : groupId);
  fetch('/update-session-group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId, group_id: groupId === 'new-chats' ? null : groupId }) })
    .catch(() => {});
}

async function loadGroups() {
  try {
    let groups = [];
    try {
      const response = await fetch('/groups');
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.groups)) {
          groups = data.groups;
        }
      }
    } catch (_) {}

    if (groups.length === 0) {
      groups = LocalStore.getGroups();
    }

    const groupsEl = document.getElementById('session-groups');
    if (groupsEl) groupsEl.innerHTML = '';
    groups.forEach(group => { createGroupInUI(group.id, group.group_name); });
    await loadSessions();
  } catch (error) { console.debug('Error fetching groups:', error); }
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
}

const promptReferenceDropTarget = document.getElementById('tools-toggle') || chatgptRefBtn;
if (promptReferenceDropTarget) {
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
        promptReferenceDropTarget.classList.add('drop-target');
      });
  el.addEventListener('dragend', () => { promptReferenceDropTarget.classList.remove('drop-target'); try { el.classList.remove('dragging'); } catch(_) {} if (el.__dragGhost) { try { el.__dragGhost.remove(); } catch(_) {} el.__dragGhost = null; } });
    }
    chatMessagesEl.querySelectorAll('.message.user').forEach(armDraggable);
    const mo = new MutationObserver((muts) => { muts.forEach(m => m.addedNodes.forEach(node => { if (node instanceof HTMLElement) { if (node.matches && node.matches('.message.user')) armDraggable(node); node.querySelectorAll && node.querySelectorAll('.message.user').forEach(armDraggable); } })); });
    mo.observe(chatMessagesEl, { childList: true, subtree: true });
    promptReferenceDropTarget.addEventListener('dragenter', (e) => { e.preventDefault(); promptReferenceDropTarget.classList.add('drop-target'); });
    promptReferenceDropTarget.addEventListener('dragover', (e) => { e.preventDefault(); promptReferenceDropTarget.classList.add('drop-target'); });
    promptReferenceDropTarget.addEventListener('dragleave', () => promptReferenceDropTarget.classList.remove('drop-target'));
    promptReferenceDropTarget.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation(); promptReferenceDropTarget.classList.remove('drop-target');
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
      if (!touchState.active) return; const rect = promptReferenceDropTarget.getBoundingClientRect(); const x = touch.clientX, y = touch.clientY; if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) { const txt = (touchState.el.innerText || touchState.el.textContent || '').trim(); window.__lastDroppedPromptText = txt; window.__lastDraggedPromptElement = touchState.el; showChatGPTReferencePopup(); }
      // Restore visibility of the original element
      try { if (touchState.el) touchState.el.classList.remove('dragging'); } catch (_) {}
      if (touchState.ghost) { try { if (typeof touchState.ghost._posRuleIndex === 'number') _removePosRule(touchState.ghost._posRuleIndex); } catch(_) {} try { touchState.ghost.remove(); } catch(_) {} }
      touchState = { active: false, el: null, ghost: null }; promptReferenceDropTarget.classList.remove('drop-target');
    }
    chatMessagesEl.addEventListener('touchstart', (e) => { const msg = e.target.closest && e.target.closest('.message.user'); if (!msg) return; if (longPressTimer) clearTimeout(longPressTimer); const t = e.touches[0]; longPressTimer = setTimeout(() => startTouchDrag(msg, t), 350); }, { passive: true });
  chatMessagesEl.addEventListener('touchmove', (e) => { if (!touchState.active || !touchState.ghost) return; const t = e.touches[0]; try { if (typeof touchState.ghost._posRuleIndex === 'number' && touchState.ghost._posRuleIndex >= 0) _updatePosRule(touchState.ghost._posRuleIndex, t.clientX, t.clientY); } catch (_) {} const rect = promptReferenceDropTarget.getBoundingClientRect(); const over = (t.clientX >= rect.left && t.clientX <= rect.right && t.clientY >= rect.top && t.clientY <= rect.bottom); promptReferenceDropTarget.classList.toggle('drop-target', over); }, { passive: true });
    chatMessagesEl.addEventListener('touchend', (e) => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } const t = e.changedTouches && e.changedTouches[0]; if (t) endTouchDrag(t); });
    chatMessagesEl.addEventListener('touchcancel', () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } try { if (touchState.el) touchState.el.classList.remove('dragging'); } catch(_) {} if (touchState.ghost) touchState.ghost.remove(); touchState = { active: false, el: null, ghost: null }; promptReferenceDropTarget.classList.remove('drop-target'); });
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
  if (button && promptButtons) {
      button.classList.toggle('active');
  }
}

document.addEventListener('click', (event) => {
  const button = document.querySelector('.prompt-examples-button');
  const promptButtons = document.querySelector('.prompt-buttons');
  if (button && promptButtons && !button.contains(event.target) && !promptButtons.contains(event.target)) {
    button.classList.remove('active');
  }
});

window.addEventListener('resize', () => {
  const button = document.querySelector('.prompt-examples-button');
  if (button) button.classList.remove('active');
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

  // Root dialog overlay
  const wrapper = document.createElement('div');
  wrapper.className = 'assistant-edit-mode';
  wrapper.setAttribute('role', 'dialog');
  wrapper.setAttribute('aria-label', 'Turing Tutor Assessment Workspace');

  // Inner app container
  const app = document.createElement('div');
  app.className = 'app';

  // 1. Topbar
  const topbar = document.createElement('header');
  topbar.className = 'topbar';

  const brand = document.createElement('div');
  brand.className = 'brand';

  const brandMark = document.createElement('div');
  brandMark.className = 'brand-mark';
  const brandImg = document.createElement('img');
  brandImg.src = '/Alanbotlogo_green.svg';
  brandImg.alt = 'Alan Turing icon';
  brandMark.appendChild(brandImg);

  const brandCopy = document.createElement('div');
  brandCopy.className = 'brand-copy';
  const brandH1 = document.createElement('h1');
  brandH1.innerHTML = 'Turing Tutor <span class="brand-tag">Assessment response</span>';
  const brandSub = document.createElement('p');
  brandSub.textContent = 'Write, refine and review your work in a focused Turing Tutor workspace.';
  brandCopy.appendChild(brandH1);
  brandCopy.appendChild(brandSub);

  brand.appendChild(brandMark);
  brand.appendChild(brandCopy);

  const headerActions = document.createElement('div');
  headerActions.className = 'header-actions';

  const savedDiv = document.createElement('div');
  savedDiv.className = 'saved';
  const savedDot = document.createElement('span');
  savedDot.className = 'dot';
  const saveLabel = document.createElement('span');
  saveLabel.id = 'saveLabel';
  saveLabel.textContent = 'Saved';
  savedDiv.appendChild(savedDot);
  savedDiv.appendChild(saveLabel);

  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.className = 'mode';
  modeBtn.innerHTML = '<span class="mode-icon"><img src="/Turing%20Tutor%20Enigma.svg" alt="Enigma Machine"></span> Turing Mode <span class="chevron">⌄</span>';
  modeBtn.addEventListener('click', () => {
    if (typeof startTuringMode === 'function') startTuringMode();
  });

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'close assistant-edit-close';
  closeBtn.setAttribute('title', 'Close');
  closeBtn.setAttribute('aria-label', 'Close editor');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => saveEdit(true));

  headerActions.appendChild(savedDiv);
  headerActions.appendChild(modeBtn);
  headerActions.appendChild(closeBtn);

  topbar.appendChild(brand);
  topbar.appendChild(headerActions);
  app.appendChild(topbar);

  // 2. Main Workspace
  const workspace = document.createElement('main');
  workspace.className = 'workspace';

  // Toast container
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.id = 'toast';
  toast.textContent = 'Saved successfully';
  wrapper.appendChild(toast);

  let toastTimer = null;
  function showToast(msg, duration = 1400) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add('show');
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  // Toolbar
  const toolbar = document.createElement('section');
  toolbar.className = 'toolbar assistant-edit-toolbar';
  toolbar.setAttribute('aria-label', 'Editor toolbar');

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn primary save-btn';
  saveBtn.id = 'saveBtn';
  saveBtn.textContent = '▣ Save';
  saveBtn.addEventListener('click', () => {
    saveEdit(false);
  });

  const decipherBtn = document.createElement('button');
  decipherBtn.type = 'button';
  decipherBtn.className = 'btn decipher decipher-btn';
  decipherBtn.id = 'decipherBtn';
  decipherBtn.innerHTML = '<span class="sparkle">✦</span><span id="decipherLabel">Decipher</span>';
  const decipherLabel = decipherBtn.querySelector('#decipherLabel');

  const styleSelect = document.createElement('select');
  styleSelect.className = 'select';
  styleSelect.id = 'styleSelect';
  styleSelect.setAttribute('aria-label', 'Text style');
  styleSelect.innerHTML = [
    '<option value="">Text Style</option>',
    '<option value="Body">Body</option>',
    '<option value="Heading 1">Heading 1</option>',
    '<option value="Heading 2">Heading 2</option>',
    '<option value="Quote">Quote</option>'
  ].join('');

  styleSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'Heading 1') document.execCommand('formatBlock', false, 'h1');
    else if (val === 'Heading 2') document.execCommand('formatBlock', false, 'h2');
    else if (val === 'Body') document.execCommand('formatBlock', false, 'p');
    else if (val === 'Quote') document.execCommand('formatBlock', false, 'blockquote');
    editable.focus();
  });

  const divider = document.createElement('div');
  divider.className = 'divider';

  const unitChip = document.createElement('div');
  unitChip.className = 'unit-chip unit-title-btn';
  unitChip.id = 'unitChip';
  unitChip.textContent = 'F217: Biomedical Techniques';

  // Criteria chips
  const criteriaContainer = document.createElement('div');
  criteriaContainer.className = 'criteria assistant-edit-criteria-rail';
  const items = [
    { key: 'P1', tip: 'Use research to identify a range of potential diseases for each patient (≥4 per patient).' },
    { key: 'P2', tip: 'Create a detailed method: tests, techniques, equipment (sizes/quantities/PPE) informed by suspected diseases.' },
    { key: 'M2', tip: 'Explain the rationale for tests and techniques chosen based on suspected diseases (builds on P2/M1).' },
    { key: 'D1', tip: 'Justify the choice and settings of appropriate equipment for chosen tests and techniques.' }
  ];
  const criterionLabel = document.createElement('span');
  criterionLabel.className = 'tiny-purple';
  criterionLabel.id = 'criterionLabel';
  criterionLabel.textContent = 'F217 · P1';

  items.forEach((it, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'criterion criteria-chip' + (idx === 0 ? ' active' : '');
    b.textContent = it.key;
    b.setAttribute('data-tip', it.tip);
    b.addEventListener('click', () => {
      b.classList.toggle('active');
      const activeKeys = Array.from(criteriaContainer.querySelectorAll('.criterion.active, .criteria-chip.active')).map(c => c.textContent.trim());
      criterionLabel.textContent = 'F217' + (activeKeys.length ? ' · ' + activeKeys.join(' · ') : '');
    });
    criteriaContainer.appendChild(b);
  });

  toolbar.appendChild(saveBtn);
  toolbar.appendChild(decipherBtn);
  toolbar.appendChild(styleSelect);
  toolbar.appendChild(divider);
  toolbar.appendChild(unitChip);
  toolbar.appendChild(criteriaContainer);
  workspace.appendChild(toolbar);

  // PDF modal for unit specification
  const pdfModal = document.createElement('div');
  pdfModal.className = 'unit-pdf-modal';
  const pdfBackdrop = document.createElement('div');
  pdfBackdrop.className = 'unit-pdf-backdrop';
  const pdfDialog = document.createElement('div');
  pdfDialog.className = 'unit-pdf-dialog';
  const pdfHeader = document.createElement('div');
  pdfHeader.className = 'unit-pdf-header';
  const pdfTitle = document.createElement('div');
  pdfTitle.className = 'unit-pdf-title';
  pdfTitle.textContent = 'F217: Biomedical Techniques — Specification';
  const pdfClose = document.createElement('button');
  pdfClose.type = 'button';
  pdfClose.className = 'unit-pdf-close';
  pdfClose.textContent = '×';
  const pdfBody = document.createElement('div');
  pdfBody.className = 'unit-pdf-body';
  const pdfFrame = document.createElement('iframe');
  pdfFrame.className = 'unit-pdf-frame';
  pdfFrame.src = '/AAQ_Specificaiton_cambridge-advanced-national-in-human-biology.pdf';
  pdfFrame.setAttribute('title', 'Unit Specification PDF');
  pdfFrame.setAttribute('aria-label', 'Unit Specification PDF');
  pdfFrame.setAttribute('loading', 'eager');
  pdfBody.appendChild(pdfFrame);
  pdfHeader.appendChild(pdfTitle);
  pdfHeader.appendChild(pdfClose);
  pdfDialog.appendChild(pdfHeader);
  pdfDialog.appendChild(pdfBody);
  pdfModal.appendChild(pdfBackdrop);
  pdfModal.appendChild(pdfDialog);
  wrapper.appendChild(pdfModal);

  function openPdfModal() {
    pdfModal.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }
  function closePdfModal() {
    pdfModal.classList.remove('visible');
    document.body.style.overflow = '';
  }
  pdfClose.addEventListener('click', closePdfModal);
  pdfBackdrop.addEventListener('click', closePdfModal);
  unitChip.addEventListener('click', openPdfModal);

  // Decipher logic
  let decipherResetTimer = null;
  function handleDecipherDone(success = true) {
    if (decipherResetTimer) clearTimeout(decipherResetTimer);
    if (decipherLabel) decipherLabel.textContent = 'Deciphered ✓';
    showToast(success ? 'Decipher complete' : 'Decipher finished', 1400);
    decipherResetTimer = setTimeout(() => {
      decipherBtn.classList.remove('decoding');
      if (decipherLabel) decipherLabel.textContent = 'Decipher';
    }, 1250);
  }
  wrapper.__handleDecipherDone = handleDecipherDone;

  decipherBtn.addEventListener('click', () => {
    try {
      if (window.__decipherInFlight || decipherBtn.classList.contains('decoding')) return;
      window.__decipherInFlight = true;

      decipherBtn.classList.add('decoding');
      if (decipherLabel) decipherLabel.textContent = 'Deciphering…';
      showToast('Analysing your text…', 2000);

      showDecipherWait();
      setCriteriaLoading(true, wrapper);

      const editableEl = wrapper.querySelector('.assistant-editable-content, .editor');
      let html = editableEl ? editableEl.innerHTML || '' : '';
      const lower = html.toLowerCase();
      const refIdx = lower.indexOf('>references<');
      if (refIdx > -1) {
        html = html.slice(0, refIdx);
      }
      const cleaned = sanitizeHtml(html);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'generateFeedback', content: cleaned, session_id }));
        showPopup(document.getElementById('scale-popup'), 'Assessing content against rubric…');
      } else {
        showPopup(document.getElementById('scale-popup'), 'Assessing content against rubric…');
        fetch('/api/decipher', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: cleaned, session_id })
        }).then(r => r.json()).then(data => {
          if (data.success && data.feedback) {
            handleWebSocketMessage({ type: 'feedback', content: data.feedback });
          } else {
            console.error('Decipher failed:', data);
            setCriteriaLoading(false, wrapper);
            window.__decipherInFlight = false;
            handleDecipherDone(false);
          }
        }).catch(err => {
          console.error('Decipher fetch failed:', err);
          setCriteriaLoading(false, wrapper);
          window.__decipherInFlight = false;
          handleDecipherDone(false);
        });
      }
    } catch (e) {
      console.error('Decipher click failed:', e);
      setCriteriaLoading(false, wrapper);
      window.__decipherInFlight = false;
      handleDecipherDone(false);
    }
  });

  // Paper card
  const paper = document.createElement('section');
  paper.className = 'paper';

  // Feedback popup container inside edit mode
  const fbPopup = document.createElement('div');
  fbPopup.className = 'assistant-edit-feedback-popup';
  fbPopup.setAttribute('contenteditable', 'false');
  const fbInner = document.createElement('div');
  fbInner.className = 'assistant-edit-feedback-content';
  const fbClose = document.createElement('button');
  fbClose.type = 'button';
  fbClose.className = 'assistant-edit-feedback-close';
  fbClose.textContent = '×';
  fbClose.title = 'Close feedback';
  fbClose.addEventListener('click', () => hideEditFeedbackPopup(wrapper));
  fbPopup.appendChild(fbClose);
  fbPopup.appendChild(fbInner);
  paper.appendChild(fbPopup);

  // Decipher waiting overlay (loads and animates the Enigma SVG)
  const waitOverlay = document.createElement('div');
  waitOverlay.className = 'decipher-wait-overlay';
  waitOverlay.setAttribute('role', 'status');
  waitOverlay.setAttribute('aria-live', 'polite');
  waitOverlay.setAttribute('aria-busy', 'true');
  const waitPanel = document.createElement('div');
  waitPanel.className = 'decipher-wait-panel';
  const waitVisual = document.createElement('div');
  waitVisual.className = 'decipher-wait-visual';
  const waitInner = document.createElement('div');
  waitInner.className = 'decipher-wait-content';
  waitVisual.appendChild(waitInner);
  const waitCopy = document.createElement('div');
  waitCopy.className = 'decipher-wait-copy';
  const waitEyebrow = document.createElement('div');
  waitEyebrow.className = 'decipher-wait-eyebrow';
  waitEyebrow.innerHTML = '<span class="decipher-wait-status-dot" aria-hidden="true"></span><span>Turing assessment</span>';
  const waitCaption = document.createElement('h2');
  waitCaption.className = 'decipher-wait-caption';
  waitCaption.textContent = 'Assessing learner work against the criteria';
  const waitDetail = document.createElement('p');
  waitDetail.className = 'decipher-wait-detail';
  waitDetail.textContent = 'Comparing the response with your selected assessment criteria. This may take a moment.';
  const waitProgress = document.createElement('div');
  waitProgress.className = 'decipher-wait-progress';
  waitProgress.setAttribute('aria-hidden', 'true');
  waitCopy.appendChild(waitEyebrow);
  waitCopy.appendChild(waitCaption);
  waitCopy.appendChild(waitDetail);
  waitCopy.appendChild(waitProgress);
  waitPanel.appendChild(waitVisual);
  waitPanel.appendChild(waitCopy);
  waitOverlay.appendChild(waitPanel);
  paper.appendChild(waitOverlay);

  // Contenteditable
  const editable = document.createElement('div');
  editable.id = 'editor';
  editable.className = 'editor assistant-editable-content';
  editable.contentEditable = 'true';
  editable.setAttribute('spellcheck', 'true');

  const removeGeneratedAssessmentPanels = (root) => {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('.assistant-edit-feedback-popup').forEach((panel) => panel.remove());
  };
  const contentEl = targetAssistant.querySelector('.message-content');
  removeGeneratedAssessmentPanels(contentEl);
  editable.innerHTML = sanitizeHtml(contentEl ? contentEl.innerHTML : '');
  removeGeneratedAssessmentPanels(editable);

  try {
    const existingFooter = targetAssistant.querySelector('[data-section="turing-footer"], .turing-footer');
    const footerRemoved = targetAssistant.dataset.footerRemoved === '1';
    if (existingFooter && !footerRemoved) {
      const cloned = existingFooter.cloneNode(true);
      editable.appendChild(document.createElement('br'));
      editable.appendChild(cloned);
    }
  } catch (_) { /* non-fatal */ }

  paper.appendChild(editable);

  // Paper footer
  const paperFooter = document.createElement('footer');
  paperFooter.className = 'paper-footer';

  const footerLeft = document.createElement('div');
  footerLeft.className = 'footer-left';
  const footerStatusPill = document.createElement('span');
  footerStatusPill.className = 'status-pill';
  footerStatusPill.innerHTML = '<span class="dot"></span> Saved';
  const wordCountWrap = document.createElement('span');
  const wordCountSpan = document.createElement('span');
  wordCountSpan.id = 'wordCount';
  wordCountSpan.textContent = '0';
  wordCountWrap.appendChild(wordCountSpan);
  wordCountWrap.appendChild(document.createTextNode(' words'));
  footerLeft.appendChild(footerStatusPill);
  footerLeft.appendChild(wordCountWrap);

  const footerRight = document.createElement('div');
  footerRight.className = 'footer-right';
  const focusEditorSpan = document.createElement('span');
  focusEditorSpan.textContent = 'Focus editor';
  footerRight.appendChild(criterionLabel);
  footerRight.appendChild(focusEditorSpan);

  paperFooter.appendChild(footerLeft);
  paperFooter.appendChild(footerRight);
  paper.appendChild(paperFooter);

  workspace.appendChild(paper);
  app.appendChild(workspace);
  wrapper.appendChild(app);
  document.body.appendChild(wrapper);

  // Word count & input change tracking
  function updateWords() {
    const text = (editable.innerText || '').trim();
    const count = text ? text.split(/\s+/).length : 0;
    wordCountSpan.textContent = count;
    saveLabel.textContent = 'Unsaved changes';
  }
  editable.addEventListener('input', updateWords);
  updateWords();

  // Apply layout helpers to expand chat and hide sidebar while editing
  document.querySelector('.sidebar')?.classList.add('hide-sidebar');
  document.querySelector('.chat-container')?.classList.add('expand-chat-area');
  document.querySelector('.meta-container')?.classList.add('expand-meta-container');

  // Focus editable
  setTimeout(() => { editable.focus(); }, 10);

  // Save handler
  async function saveEdit(shouldExit = true) {
    try {
      saveLabel.textContent = 'Saved just now';
      showToast('Saved successfully');

      const cleaned = sanitizeHtml(editable.innerHTML || '');
      const tmp = document.createElement('div');
      tmp.innerHTML = cleaned;
      removeGeneratedAssessmentPanels(tmp);
      removeEmbeddedTuringFooters(tmp);
      if (contentEl) contentEl.innerHTML = tmp.innerHTML;
      targetAssistant.dataset.edited = '1';

      let messageId = targetAssistant.dataset.messageId;
      if (!messageId || Number.isNaN(parseInt(messageId, 10))) {
        const firstAssistant = document.querySelector('#chat-messages .message.assistant');
        if (firstAssistant && firstAssistant.dataset && !Number.isNaN(parseInt(firstAssistant.dataset.messageId, 10))) {
          messageId = firstAssistant.dataset.messageId;
        }
      }

      const payload = { content: tmp.innerHTML, session_id };
      try {
        const rawMeta = extractFooterFromEditable(editable);
        const meta = await uploadDataUrlPrompts(rawMeta);
        const hasRefs = meta && Array.isArray(meta.references) && meta.references.length > 0;
        const hasPrompts = meta && Array.isArray(meta.prompts) && meta.prompts.length > 0;
        if (hasRefs) payload.references = meta.references;
        if (hasPrompts) payload.prompts = meta.prompts;
        if (!hasRefs && !hasPrompts) {
          try { removeEmbeddedTuringFooters(targetAssistant); } catch(_) {}
          targetAssistant.dataset.footerRemoved = '1';
          payload.footer_removed = true;
        } else {
          try { applyFooterToAssistant(targetAssistant, meta); } catch (_) {}
          targetAssistant.dataset.footerRemoved = '0';
          payload.footer_removed = false;
        }
      } catch (e) { console.warn('Could not extract/upload editor metadata:', e); }

      syncTuringMessageEmptyState(targetAssistant);
      const parsed = parseInt(messageId, 10);
      if (!Number.isNaN(parsed)) payload.message_id = parsed;
      try {
        LocalStore.updateMessageContent(messageId, payload.content, payload.references, payload.prompts);
        await fetch('/update-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        try { if (targetAssistant.classList.contains('turing-message')) updateTuringBarCounts(targetAssistant); } catch(_) {}
      } catch (err) { console.warn('Failed to persist edited message to server:', err); }
    } finally {
      if (shouldExit) {
        exitAssistantEditMode(wrapper, true, targetAssistant);
      }
    }
  }

  // Wrap the two labelled cog paths so CSS rotation preserves each path's original SVG transform.
  function prepareDecipherCogs() {
    const svg = waitInner.querySelector('svg');
    if (!svg) return [];
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (!svg.dataset.cogsPrepared) {
      const inkscapeNs = 'http://www.inkscape.org/namespaces/inkscape';
      const cogs = Array.from(svg.querySelectorAll('*')).filter((node) =>
        node.getAttributeNS(inkscapeNs, 'label') === 'cogr' || node.getAttribute('inkscape:label') === 'cogr'
      );
      cogs.forEach((cog, index) => {
        const cogWrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        cogWrapper.classList.add('decipher-cog');
        cogWrapper.classList.add(index % 2 === 0 ? 'decipher-cog-clockwise' : 'decipher-cog-counterclockwise');
        cog.parentNode.insertBefore(cogWrapper, cog);
        cogWrapper.appendChild(cog);
      });
      svg.dataset.cogsPrepared = '1';
    }
    return Array.from(svg.querySelectorAll('.decipher-cog'));
  }

  // Helper: show/hide decipher wait overlay and load inline SVG once
  async function showDecipherWait() {
    try {
      wrapper.classList.add('decipher-active');
      if (!waitInner.dataset.loaded) {
        const resp = await fetch('/Turing Tutor Enigma.svg');
        const svgText = await resp.text();
        // Inline the SVG so CSS animations can target elements
        waitInner.innerHTML = svgText;
        waitInner.dataset.loaded = '1';
      }
      const cogs = prepareDecipherCogs();
      waitOverlay.classList.remove('cogs-ready');
      waitOverlay.classList.add('visible');
      requestAnimationFrame(() => {
        cogs.forEach((cog) => {
          try {
            const bounds = cog.getBBox();
            cog.style.transformOrigin = `${bounds.x + bounds.width / 2}px ${bounds.y + bounds.height / 2}px`;
          } catch (_) { /* SVG may still be laying out; the fallback origin remains safe. */ }
        });
        waitOverlay.classList.add('cogs-ready');
      });
    } catch (e) { console.warn('Could not load Enigma SVG:', e); waitOverlay.classList.add('visible'); }
  }
  function hideDecipherWait() {
    waitOverlay.classList.remove('visible', 'cogs-ready');
    wrapper.classList.remove('decipher-active');
  }

  return wrapper;
}

// Show feedback as a popup within the Turing edit overlay
function showEditFeedbackPopup(text, editWrapper) {
  try {
    if (!editWrapper) editWrapper = document.querySelector('.assistant-edit-mode');
    if (!editWrapper) return;
    const popups = Array.from(editWrapper.querySelectorAll('.assistant-edit-feedback-popup'));
    const popup = popups.find((candidate) => candidate.parentElement === editWrapper) || popups[0];
    const content = popup?.querySelector('.assistant-edit-feedback-content');
    if (!popup || !content) return;
    // Keep one reusable result panel; remove any panels persisted by older editor sessions.
    popups.forEach((candidate) => { if (candidate !== popup) candidate.remove(); });
    content.textContent = '';
    // Render simple markdown to HTML for readability
    const html = renderMarkdownToHtml(text);
    content.innerHTML = sanitizeHtml(html || escapeHtml(text));
    const editable = editWrapper.querySelector('.assistant-editable-content');
    if (editable) {
      editable.querySelectorAll('.assistant-edit-feedback-popup').forEach((candidate) => candidate.remove());
      popup.classList.remove('embedded');
      if (popup.parentElement !== editWrapper || popup.nextElementSibling !== editable) {
        editWrapper.insertBefore(popup, editable);
      }
      if (typeof editWrapper.scrollTo === 'function') {
        editWrapper.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        editWrapper.scrollTop = 0;
      }
    }
    popup.classList.add('visible');
    // cache last feedback for quick recall
    editWrapper.__lastFeedbackText = String(text);
  } catch (e) {
    console.error('showEditFeedbackPopup failed', e);
  }
}

function hideEditFeedbackPopup(editWrapper) {
  try {
    if (!editWrapper) editWrapper = document.querySelector('.assistant-edit-mode');
    if (!editWrapper) return;
    const popup = editWrapper.querySelector('.assistant-edit-feedback-popup');
    if (!popup) return;
    popup.classList.remove('visible', 'embedded');
    const editable = editWrapper.querySelector('.assistant-editable-content');
    if (editable && popup.parentElement !== editWrapper) {
      editWrapper.insertBefore(popup, editable);
    }
  } catch (e) {
    console.error('hideEditFeedbackPopup failed', e);
  }
}

// Parse feedback lines and apply traffic light classes to criteria chips
function applyTrafficLightsFromFeedback(text, editWrapper) {
  if (!editWrapper) editWrapper = document.querySelector('.assistant-edit-mode');
  const rail = editWrapper ? editWrapper.querySelector('.assistant-edit-criteria-rail') : null;
  if (!rail) return;
  // Clear loading state when applying real statuses
  rail.querySelectorAll('.criteria-chip').forEach(chip => chip.classList.remove('chip-loading'));
  const rawText = String(text || '').trim();
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const statuses = {};
  ['P1','P2','M2','D1'].forEach(k => {
    // Prefer a line that starts with optional markdown heading then the key and a delimiter
    // Matches: "P1:", "P1 -", "### P1:", "##   D1 —"
    let line = lines.find(l => new RegExp(`^\\s*#{0,6}\\s*${k}\\s*(?:[:\\-—])`, 'i').test(l));
    // Fallback: any line containing the key
    if (!line) line = lines.find(l => new RegExp(`\\b${k}\\b`, 'i').test(l)) || '';
    const low = line.toLowerCase();
    let status = null;
    if (/(distinction|excellent|strong)/.test(low)) status = 'distinction';
    else if (/(merit|good|adequate)/.test(low)) status = 'merit';
    else if (/(pass|meets|basic|minimal)/.test(low)) status = 'pass';
    else if (/(not met|missing|insufficient|needs)/.test(low)) status = 'fail';
    // If still unknown, infer from global summary keywords
    if (!status) {
      const g = rawText.toLowerCase();
      if (/overall\s+distinction|high distinction/.test(g)) status = 'distinction';
      else if (/overall\s+merit|solid merit/.test(g)) status = 'merit';
      else if (/overall\s+pass|meets minimum/.test(g)) status = 'pass';
      else if (/overall\s+fail|does not meet/.test(g)) status = 'fail';
    }
    statuses[k] = status || null;
  });
  // Force a reflow before applying classes to avoid first-click paint issues
  void rail.offsetWidth;
  rail.querySelectorAll('.criteria-chip').forEach(chip => {
    const key = chip.textContent.trim();
    chip.classList.remove('chip-pass','chip-merit','chip-distinction','chip-fail');
    const s = statuses[key];
    if (s === 'distinction') chip.classList.add('chip-distinction');
    else if (s === 'merit') chip.classList.add('chip-merit');
    else if (s === 'pass') chip.classList.add('chip-pass');
    else if (s === 'fail') chip.classList.add('chip-fail');
    else {
      // No match: briefly toggle to force repaint, leaving neutral state
      if (typeof window !== 'undefined' && window.__DEV__ !== false) {
        try {
          console.debug('[criteria] No status detected for', key, 'from feedback:', rawText);
        } catch (_) {}
      }
      chip.style.transform = 'scale(1.001)';
      // eslint-disable-next-line no-unused-expressions
      chip.offsetHeight;
      chip.style.transform = '';
    }
  });
  // Ensure the rail is visible and styles applied immediately
  rail.classList.add('criteria-updated');
}

// Set or clear a temporary loading state on criteria chips
function setCriteriaLoading(isLoading, editWrapper) {
  if (!editWrapper) editWrapper = document.querySelector('.assistant-edit-mode');
  const rail = editWrapper ? editWrapper.querySelector('.assistant-edit-criteria-rail') : null;
  if (!rail) return;
  rail.querySelectorAll('.criteria-chip').forEach(chip => {
    if (isLoading) chip.classList.add('chip-loading'); else chip.classList.remove('chip-loading');
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

  // ---- Sidebar collapse toggle ----
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebar = document.getElementById('sidebar');
  if (sidebarToggleBtn && sidebar) {
    // Restore state from localStorage
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
      sidebar.classList.add('collapsed');
    }
    sidebarToggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    });
  }

  // ---- Starter prompt buttons (welcome state) ----
  document.querySelectorAll('.chat-starter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      if (prompt) {
        const msgInput = document.getElementById('message-input');
        if (msgInput) {
          msgInput.value = prompt;
          msgInput.focus();
          // Trigger auto-resize
          msgInput.dispatchEvent(new Event('input'));
        }
      }
    });
  });
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


  // Tools popup toggle
  const tToggle = document.getElementById('tools-toggle');
  const exPrompts = document.querySelector('.example-prompts');
  if (tToggle && exPrompts) {
      tToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          exPrompts.classList.toggle('show-popup');
      });
      document.addEventListener('click', (e) => {
          if (!exPrompts.contains(e.target) && e.target !== tToggle) {
              exPrompts.classList.remove('show-popup');
          }
      });
  }

  // AI Assessment detail toggle
  const assessmentToggle = document.getElementById('assessment-detail-toggle');
  const detailedView = document.getElementById('assessment-detailed-view');
  const summaryBar = document.querySelector('.ai-assessment-summary-bar');
  
  if (assessmentToggle && detailedView) {
      let isDetailed = true;
      if (summaryBar) summaryBar.style.display = 'none';

      assessmentToggle.addEventListener('click', (e) => {
          isDetailed = !isDetailed;
          if (!isDetailed) {
              detailedView.style.display = 'none';
              if (summaryBar) summaryBar.style.display = 'flex';
              assessmentToggle.classList.add('collapsed');
          } else {
              detailedView.style.display = 'block';
              if (summaryBar) summaryBar.style.display = 'none';
              assessmentToggle.classList.remove('collapsed');
          }
      });
  }

  // AI Guidelines Modal Logic
  const aiGuidelinesLink = document.getElementById('ai-guidelines-link');
  const aiGuidelinesModal = document.getElementById('ai-guidelines-modal');
  const closeGuidelinesModal = document.getElementById('close-guidelines-modal');

  if (aiGuidelinesLink && aiGuidelinesModal) {
      aiGuidelinesLink.addEventListener('click', (e) => {
          e.preventDefault();
          aiGuidelinesModal.classList.add('visible');
      });

      if (closeGuidelinesModal) {
          closeGuidelinesModal.addEventListener('click', () => {
              aiGuidelinesModal.classList.remove('visible');
          });
      }

      // Close when clicking outside the panel
      aiGuidelinesModal.addEventListener('click', (e) => {
          if (e.target === aiGuidelinesModal) {
              aiGuidelinesModal.classList.remove('visible');
          }
      });
  }


// ── Sidebar Examples Accordion ────────────────────────────────────────────────
(function initExamplesAccordion() {
  const accordionBtn = document.getElementById('examples-accordion-btn');
  const accordionPanel = document.getElementById('examples-dropdown');
  if (!accordionBtn || !accordionPanel) return;

  // Toggle outer accordion
  accordionBtn.addEventListener('click', () => {
    const isOpen = accordionBtn.getAttribute('aria-expanded') === 'true';
    accordionBtn.setAttribute('aria-expanded', String(!isOpen));
    accordionPanel.classList.toggle('open', !isOpen);
  });

  // Toggle inner category dropdowns
  accordionPanel.querySelectorAll('.nav-accordion-category-btn').forEach(catBtn => {
    catBtn.addEventListener('click', () => {
      const isOpen = catBtn.getAttribute('aria-expanded') === 'true';
      catBtn.setAttribute('aria-expanded', String(!isOpen));
      const list = catBtn.nextElementSibling;
      if (list) list.classList.toggle('open', !isOpen);
    });
  });

  // Prompt buttons: insert text into message input
  accordionPanel.querySelectorAll('.nav-prompt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt') || btn.textContent.trim();
      if (typeof setMessageInput === 'function') {
        setMessageInput(prompt);
      } else {
        const input = document.getElementById('message-input');
        if (input) { input.value = prompt; input.focus(); }
      }
    });
  });
})();
// ── End Sidebar Examples Accordion ───────────────────────────────────────────


// ══ AI Analytics System ═══════════════════════════════════════════════════════
(function() {
  'use strict';

  const STORE_KEY = 'tt_ai_analytics_v1';
  const LEVEL_META = {
    5: { label: 'Full AI',              color: '#e884fc', soft: '#f6d7fd' },
    4: { label: 'AI + Human',           color: '#a93eed', soft: '#ead8fa' },
    3: { label: 'AI Editing',           color: '#4ba8d8', soft: '#dceff8' },
    2: { label: 'Ideas & Structure',    color: '#4b10c4', soft: '#e9deff' },
    1: { label: 'No AI',               color: '#aeb1c4', soft: '#eef0f5' },
  };

  /* ── Storage helpers ──────────────────────────────────────────────────── */
  function loadRecords() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
    catch(_) { return []; }
  }
  function saveRecords(records) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(records)); } catch(_) {}
  }
  function recordAssessment(level) {
    if (!level || level < 1 || level > 5) return;
    const records = loadRecords();
    records.push({ level: level, ts: Date.now() });
    // Keep max 5000 records
    if (records.length > 5000) records.splice(0, records.length - 5000);
    saveRecords(records);
  }

  /* ── Hook into updateScale ────────────────────────────────────────────── */
  // Wrap the global updateScale so every call also records analytics
  const _origUpdateScale = window.updateScale || (typeof updateScale !== 'undefined' ? updateScale : null);
  function patchUpdateScale() {
    // Patch via a MutationObserver on the scale's DOM instead, to be safe
    const scaleRoot = document.getElementById('ai-assessment-scale');
    if (!scaleRoot) return;
    const mo = new MutationObserver(() => {
      const current = scaleRoot.querySelector('.scale-item.current-assessment');
      if (current) {
        const lvl = parseInt(current.id.replace('scale-', ''), 10);
        if (!isNaN(lvl)) recordAssessment(lvl);
      }
    });
    mo.observe(scaleRoot, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }
  patchUpdateScale();

  /* ── Period filter ────────────────────────────────────────────────────── */
  let activePeriod = 7;
  function filterByPeriod(records, period) {
    if (period === 'all') return records;
    const cutoff = Date.now() - period * 24 * 60 * 60 * 1000;
    return records.filter(r => r.ts >= cutoff);
  }

  /* ── Stat cards ───────────────────────────────────────────────────────── */
  function renderStatCards(records) {
    const el = document.getElementById('analytics-stat-cards');
    if (!el) return;
    const total = records.length;
    const avgLevel = total ? (records.reduce((s,r) => s + r.level, 0) / total).toFixed(1) : '—';
    // Most common
    const freq = {};
    records.forEach(r => { freq[r.level] = (freq[r.level]||0) + 1; });
    const topLevel = total ? Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0] : null;
    const topName  = topLevel ? LEVEL_META[topLevel].label : '—';
    // Days active
    const days = new Set(records.map(r => new Date(r.ts).toDateString())).size;

    el.innerHTML = `
      <div class="analytics-stat-card">
        <span class="stat-label">Total prompts</span>
        <span class="stat-value">${total}</span>
        <span class="stat-sub">assessed this period</span>
      </div>
      <div class="analytics-stat-card">
        <span class="stat-label">Avg AI level</span>
        <span class="stat-value">${avgLevel}</span>
        <span class="stat-sub">out of 5</span>
      </div>
      <div class="analytics-stat-card">
        <span class="stat-label">Most common</span>
        <span class="stat-value" style="font-size:1rem;padding-top:4px">${topName}</span>
        <span class="stat-sub">usage pattern</span>
      </div>
      <div class="analytics-stat-card">
        <span class="stat-label">Days active</span>
        <span class="stat-value">${days}</span>
        <span class="stat-sub">with AI use</span>
      </div>`;
  }

  /* ── Bar chart ────────────────────────────────────────────────────────── */
  function renderBarChart(records, period) {
    const canvas = document.getElementById('analytics-chart');
    const empty  = document.getElementById('analytics-chart-empty');
    if (!canvas || !empty) return;

    if (records.length === 0) {
      canvas.style.display = 'none';
      empty.style.display = 'flex';
      return;
    }
    canvas.style.display = 'block';
    empty.style.display = 'none';

    // Build daily buckets
    const days = period === 'all'
      ? Math.max(7, Math.ceil((Date.now() - Math.min(...records.map(r=>r.ts))) / 86400000) + 1)
      : (period === 30 ? 30 : 7);

    const buckets = [];
    for (let d = days - 1; d >= 0; d--) {
      const dayStart = new Date(); dayStart.setHours(0,0,0,0); dayStart.setDate(dayStart.getDate() - d);
      const dayEnd   = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
      const dayRecords = records.filter(r => r.ts >= dayStart.getTime() && r.ts < dayEnd.getTime());
      // Count per level
      const counts = {1:0,2:0,3:0,4:0,5:0};
      dayRecords.forEach(r => counts[r.level]++);
      buckets.push({ label: dayStart.toLocaleDateString('en-GB', {day:'numeric',month:'short'}), counts });
    }

    const DPR = window.devicePixelRatio || 1;
    const W   = canvas.clientWidth  || 700;
    const H   = 160;
    canvas.width  = W * DPR;
    canvas.height = H * DPR;
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);

    const PAD = { top: 16, right: 12, bottom: 28, left: 30 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top  - PAD.bottom;

    const maxCount = Math.max(1, ...buckets.map(b => Object.values(b.counts).reduce((s,v)=>s+v,0)));

    // Background
    ctx.clearRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(90,60,180,0.07)';
    ctx.lineWidth = 1;
    const gridLines = 4;
    for (let g = 0; g <= gridLines; g++) {
      const y = PAD.top + chartH - (g / gridLines) * chartH;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + chartW, y); ctx.stroke();
      // Y label
      ctx.fillStyle = 'rgba(90,80,130,0.5)';
      ctx.font = `${10 * 1}px Inter, system-ui`;
      ctx.textAlign = 'right';
      ctx.fillText(Math.round((g / gridLines) * maxCount), PAD.left - 4, y + 3);
    }

    const barGap    = Math.max(2, Math.floor(chartW / buckets.length * 0.18));
    const barWidth  = Math.max(4, Math.floor(chartW / buckets.length) - barGap);

    buckets.forEach((bucket, i) => {
      const x      = PAD.left + i * (barWidth + barGap) + barGap / 2;
      let   yOffset = PAD.top + chartH;

      // Stacked bars – level 1 (bottom) to 5 (top)
      [1,2,3,4,5].forEach(level => {
        const count = bucket.counts[level];
        if (count === 0) return;
        const barH = (count / maxCount) * chartH;
        yOffset -= barH;
        ctx.fillStyle = LEVEL_META[level].color;
        const r = Math.min(4, barWidth / 2);
        // Rounded top only
        ctx.beginPath();
        ctx.moveTo(x, yOffset + barH);
        ctx.lineTo(x, yOffset + r);
        ctx.quadraticCurveTo(x, yOffset, x + r, yOffset);
        ctx.lineTo(x + barWidth - r, yOffset);
        ctx.quadraticCurveTo(x + barWidth, yOffset, x + barWidth, yOffset + r);
        ctx.lineTo(x + barWidth, yOffset + barH);
        ctx.closePath();
        ctx.fill();
      });

      // X labels – only show every N-th
      const step = Math.max(1, Math.ceil(buckets.length / 8));
      if (i % step === 0 || i === buckets.length - 1) {
        ctx.fillStyle = 'rgba(90,80,130,0.55)';
        ctx.font = `${9}px Inter, system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText(bucket.label, x + barWidth / 2, PAD.top + chartH + 16);
      }
    });
  }

  /* ── Donut chart ──────────────────────────────────────────────────────── */
  function renderDonut(records) {
    const canvas = document.getElementById('analytics-donut');
    const legend = document.getElementById('analytics-legend');
    if (!canvas || !legend) return;

    const freq = {1:0,2:0,3:0,4:0,5:0};
    records.forEach(r => { freq[r.level]++ });
    const total = records.length;

    const DPR = window.devicePixelRatio || 1;
    const SIZE = 140;
    canvas.width  = SIZE * DPR;
    canvas.height = SIZE * DPR;
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);

    const cx = SIZE / 2, cy = SIZE / 2, R = 52, r = 32;
    let startAngle = -Math.PI / 2;

    ctx.clearRect(0, 0, SIZE, SIZE);

    if (total === 0) {
      // Empty ring
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.arc(cx, cy, r, Math.PI * 2, 0, true);
      ctx.fillStyle = '#eef0f5';
      ctx.fill();
    } else {
      [5,4,3,2,1].forEach(level => {
        const count = freq[level];
        if (!count) return;
        const angle = (count / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, R, startAngle, startAngle + angle);
        ctx.arc(cx, cy, r, startAngle + angle, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = LEVEL_META[level].color;
        ctx.fill();
        startAngle += angle;
      });
    }

    // Centre label
    ctx.fillStyle = '#4b10c4';
    ctx.font = `bold ${18}px Inter, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total, cx, cy - 7);
    ctx.font = `${9}px Inter, system-ui`;
    ctx.fillStyle = 'rgba(90,80,130,0.6)';
    ctx.fillText('prompts', cx, cy + 8);

    // Legend
    legend.innerHTML = [5,4,3,2,1].map(level => {
      const count = freq[level];
      const pct   = total ? Math.round(count / total * 100) : 0;
      return `<div class="analytics-legend-item">
        <span class="analytics-legend-dot" style="background:${LEVEL_META[level].color}"></span>
        <span class="analytics-legend-name">${LEVEL_META[level].label}</span>
        <span class="analytics-legend-count">${count}</span>
        <span class="analytics-legend-pct">${pct}%</span>
      </div>`;
    }).join('');
  }

  /* ── Current View State ('overview' | 'advanced') ─────────────────────── */
  let activeView = 'overview';

  function toggleAnalyticsView() {
    activeView = (activeView === 'overview') ? 'advanced' : 'overview';
    const overviewEl = document.getElementById('analytics-overview-view');
    const advancedEl = document.getElementById('analytics-advanced-view');
    const toggleBtn  = document.getElementById('analytics-view-toggle-btn');
    const toggleText = document.getElementById('analytics-view-toggle-text');

    if (activeView === 'advanced') {
      if (overviewEl) overviewEl.style.display = 'none';
      if (advancedEl) advancedEl.style.display = 'flex';
      if (toggleBtn) toggleBtn.classList.add('active');
      if (toggleText) toggleText.textContent = 'Overview';
    } else {
      if (overviewEl) overviewEl.style.display = 'flex';
      if (advancedEl) advancedEl.style.display = 'none';
      if (toggleBtn) toggleBtn.classList.remove('active');
      if (toggleText) toggleText.textContent = 'Advanced Stats';
    }
    renderAnalytics();
  }

  /* ── Mathematical & Statistical Functions ──────────────────────────────── */
  function erf(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }

  function normalCdf(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }

  function normalTwoTailedP(z) {
    if (isNaN(z) || !isFinite(z)) return 1;
    return Math.max(0.0001, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))));
  }

  function tDistributionTwoTailedP(t, df) {
    if (isNaN(t) || isNaN(df) || df <= 0 || !isFinite(t)) return 1;
    t = Math.abs(t);
    if (df > 30) return normalTwoTailedP(t);
    // Regularized incomplete beta approximation for small df
    const x = df / (df + t * t);
    const a = df / 2;
    const b = 0.5;
    function logGamma(z) {
      const c = [57.1562356658629235, -59.5979603554754912, 14.1360979747417471,
                 -0.4919089676901978, 0.339946499848118887e-4, 0.465236289270485756e-4,
                 -0.983744753048795646e-4, 0.158088703224370015e-3, -0.210264441724104883e-3,
                 0.217439618115212643e-3, -0.164318106536763890e-3, 0.844182239838527433e-4,
                 -0.261908384015814087e-4, 0.368991826595316234e-5];
      let y = z, x0 = 0.99999999999999709182;
      for (let j = 0; j < 14; j++) x0 += c[j] / (++y);
      const t0 = z + 14 - 0.5;
      return 0.5 * Math.log(2 * Math.PI) + (z - 0.5) * Math.log(t0) - t0 + Math.log(x0);
    }
    function incBeta(xVal, aVal, bVal) {
      if (xVal <= 0) return 0;
      if (xVal >= 1) return 1;
      const lbeta = logGamma(aVal) + logGamma(bVal) - logGamma(aVal + bVal);
      const front = Math.exp(Math.log(xVal) * aVal + Math.log(1 - xVal) * bVal - lbeta) / aVal;
      let f = 1, cVal = 1, dVal = 0;
      for (let i = 1; i <= 40; i++) {
        const m = i / 2;
        const num = (i % 2 === 0)
          ? (m * (bVal - m) * xVal) / ((aVal + 2 * m - 1) * (aVal + 2 * m))
          : -((aVal + m) * (aVal + bVal + m) * xVal) / ((aVal + 2 * m) * (aVal + 2 * m + 1));
        dVal = 1 + num * dVal;
        if (Math.abs(dVal) < 1e-30) dVal = 1e-30;
        dVal = 1 / dVal;
        cVal = 1 + num / cVal;
        if (Math.abs(cVal) < 1e-30) cVal = 1e-30;
        const delta = cVal * dVal;
        f *= delta;
        if (Math.abs(delta - 1) < 1e-10) break;
      }
      return front * (f - 1);
    }
    const p = incBeta(x, a, b);
    return Math.max(0.0001, Math.min(1, isNaN(p) ? normalTwoTailedP(t) : p));
  }

  function formatPValue(p) {
    if (isNaN(p) || p === null) return '—';
    if (p < 0.001) return '< 0.001';
    return `= ${p.toFixed(3)}`;
  }

  /* ── 1. Linear Regression (OLS) Test ── */
  function computeLinearRegression(records) {
    const n = records.length;
    if (n < 3) return null;
    const sorted = [...records].sort((a, b) => a.ts - b.ts);
    const t0 = sorted[0].ts;
    const xs = sorted.map(r => (r.ts - t0) / 86400000); // Days from first point
    const ys = sorted.map(r => r.level);

    const xMean = xs.reduce((s, v) => s + v, 0) / n;
    const yMean = ys.reduce((s, v) => s + v, 0) / n;

    let ssXX = 0, ssYY = 0, ssXY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - xMean;
      const dy = ys[i] - yMean;
      ssXX += dx * dx;
      ssYY += dy * dy;
      ssXY += dx * dy;
    }

    if (ssXX === 0) {
      return { n, slope: 0, intercept: yMean, r: 0, r2: 0, t: 0, p: 1, se: 0, isSig: false, direction: 'stable' };
    }

    const slope = ssXY / ssXX;
    const intercept = yMean - slope * xMean;
    const r = ssYY === 0 ? 0 : ssXY / Math.sqrt(ssXX * ssYY);
    const r2 = Math.max(0, Math.min(1, r * r));

    // Residual standard error
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
      const pred = intercept + slope * xs[i];
      const res = ys[i] - pred;
      ssRes += res * res;
    }
    const df = Math.max(1, n - 2);
    const sRes = Math.sqrt(ssRes / df);
    const seSlope = sRes / Math.sqrt(ssXX);
    const t = seSlope === 0 ? 0 : slope / seSlope;
    const p = tDistributionTwoTailedP(t, df);

    return {
      n,
      slope,
      intercept,
      r,
      r2,
      t,
      df,
      p,
      seSlope,
      isSig: p < 0.05,
      direction: slope > 0.005 ? 'increasing' : (slope < -0.005 ? 'decreasing' : 'stable')
    };
  }

  /* ── 2. Welch's t-Test (Two-Period Split) ── */
  function computeWelchTTest(records) {
    const n = records.length;
    if (n < 4) return null;
    const sorted = [...records].sort((a, b) => a.ts - b.ts);
    const mid = Math.floor(n / 2);
    const g1 = sorted.slice(0, mid).map(r => r.level);
    const g2 = sorted.slice(mid).map(r => r.level);

    const n1 = g1.length, n2 = g2.length;
    const m1 = g1.reduce((s, v) => s + v, 0) / n1;
    const m2 = g2.reduce((s, v) => s + v, 0) / n2;

    const var1 = g1.reduce((s, v) => s + (v - m1) ** 2, 0) / Math.max(1, n1 - 1);
    const var2 = g2.reduce((s, v) => s + (v - m2) ** 2, 0) / Math.max(1, n2 - 1);

    const se1 = var1 / n1;
    const se2 = var2 / n2;
    const seDiff = Math.sqrt(se1 + se2);

    if (seDiff === 0) {
      return { n1, n2, m1, m2, sd1: Math.sqrt(var1), sd2: Math.sqrt(var2), diff: m2 - m1, d: 0, t: 0, df: n - 2, p: 1, isSig: false };
    }

    const t = (m2 - m1) / seDiff;
    const dfNum = (se1 + se2) ** 2;
    const dfDen = ((se1 ** 2) / Math.max(1, n1 - 1)) + ((se2 ** 2) / Math.max(1, n2 - 1));
    const df = dfDen === 0 ? (n1 + n2 - 2) : Math.max(1, dfNum / dfDen);

    // Pooled SD for Cohen's d
    const sPool = Math.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / Math.max(1, n1 + n2 - 2));
    const d = sPool === 0 ? 0 : (m2 - m1) / sPool;
    const p = tDistributionTwoTailedP(t, df);

    return {
      n1, n2,
      m1, m2,
      sd1: Math.sqrt(var1),
      sd2: Math.sqrt(var2),
      diff: m2 - m1,
      d,
      t,
      df,
      p,
      isSig: p < 0.05
    };
  }

  /* ── 3. Mann-Kendall Monotonic Trend Test ── */
  function computeMannKendallTest(records) {
    const n = records.length;
    if (n < 3) return null;
    const sorted = [...records].sort((a, b) => a.ts - b.ts);
    const ys = sorted.map(r => r.level);

    let S = 0;
    const slopes = [];
    for (let k = 0; k < n - 1; k++) {
      for (let j = k + 1; j < n; j++) {
        const dy = ys[j] - ys[k];
        if (dy > 0) S += 1;
        else if (dy < 0) S -= 1;

        const dt = (sorted[j].ts - sorted[k].ts) / 86400000;
        if (dt > 0.001) slopes.push(dy / dt);
      }
    }

    // Tie counts for levels 1..5
    const tieCounts = {};
    ys.forEach(y => { tieCounts[y] = (tieCounts[y] || 0) + 1; });
    let tieSum = 0;
    Object.values(tieCounts).forEach(tp => {
      if (tp > 1) tieSum += tp * (tp - 1) * (2 * tp + 5);
    });

    const varS = (n * (n - 1) * (2 * n + 5) - tieSum) / 18;
    let Z = 0;
    if (varS > 0) {
      if (S > 0) Z = (S - 1) / Math.sqrt(varS);
      else if (S < 0) Z = (S + 1) / Math.sqrt(varS);
    }

    const p = normalTwoTailedP(Z);
    const tau = (2 * S) / (n * (n - 1));

    // Sen's slope (median of slopes)
    slopes.sort((a, b) => a - b);
    const sensSlope = slopes.length ? slopes[Math.floor(slopes.length / 2)] : 0;

    return {
      n,
      S,
      tau,
      Z,
      p,
      sensSlope,
      isSig: p < 0.05
    };
  }

  /* ── Render Advanced Stats View ────────────────────────────────────────── */
  function renderAdvancedStats(records, period) {
    const bannerEl = document.getElementById('advanced-stats-banner');
    const testsGridEl = document.getElementById('advanced-tests-grid');
    const canvas = document.getElementById('analytics-regression-chart');
    const emptyEl = document.getElementById('analytics-regression-empty');

    if (!bannerEl || !testsGridEl || !canvas || !emptyEl) return;

    if (records.length < 3) {
      canvas.style.display = 'none';
      emptyEl.style.display = 'flex';
      bannerEl.className = 'advanced-stats-banner';
      bannerEl.innerHTML = `
        <div class="advanced-stats-banner-icon">ℹ️</div>
        <div class="advanced-stats-banner-content">
          <div class="advanced-stats-banner-title">More Data Needed for Significance Tests</div>
          <div class="advanced-stats-banner-desc">You currently have ${records.length} prompt(s) recorded in this period. At least 3–4 prompts are required to compute regression slopes, Welch's t-tests, and Mann-Kendall trend metrics.</div>
        </div>`;
      testsGridEl.innerHTML = `
        <div class="stat-test-card" style="grid-column: 1 / -1; text-align: center; color: var(--color-text-muted);">
          <p style="margin: 8px 0; font-size: 0.8rem;">Send a few more prompts to unlock real-time statistical significance testing.</p>
        </div>`;
      return;
    }

    canvas.style.display = 'block';
    emptyEl.style.display = 'none';

    // Compute tests
    const ols = computeLinearRegression(records);
    const welch = computeWelchTTest(records);
    const mk = computeMannKendallTest(records);

    const isAnySig = (ols && ols.isSig) || (welch && welch.isSig) || (mk && mk.isSig);

    // 1. Summary Banner
    if (isAnySig) {
      bannerEl.className = 'advanced-stats-banner significant';
      const dirText = (ols && ols.slope > 0) ? 'an increase in AI autonomy' : 'a shift toward lower AI dependence / more human editing';
      bannerEl.innerHTML = `
        <div class="advanced-stats-banner-icon">📈</div>
        <div class="advanced-stats-banner-content">
          <div class="advanced-stats-banner-title" style="color: #15803d;">Statistically Significant Change Detected (p < 0.05)</div>
          <div class="advanced-stats-banner-desc">Your prompt patterns show ${dirText} over time with statistical significance (${ols ? `OLS slope = ${(ols.slope > 0 ? '+' : '') + ols.slope.toFixed(2)}/day, p ${formatPValue(ols.p)}` : ''}).</div>
        </div>`;
    } else {
      bannerEl.className = 'advanced-stats-banner';
      bannerEl.innerHTML = `
        <div class="advanced-stats-banner-icon">⚖️</div>
        <div class="advanced-stats-banner-content">
          <div class="advanced-stats-banner-title">No Statistically Significant Trend (p ≥ 0.05)</div>
          <div class="advanced-stats-banner-desc">Your AI interaction levels have remained statistically stable across this timeframe (${ols ? `OLS slope = ${(ols.slope > 0 ? '+' : '') + ols.slope.toFixed(2)}/day, p ${formatPValue(ols.p)}` : ''}). Variations are consistent with standard fluctuations.</div>
        </div>`;
    }

    // 2. Render Regression Time Series Canvas Chart
    const DPR = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 700;
    const H = 160;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);

    const PAD = { top: 20, right: 24, bottom: 30, left: 45 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    // Y Axis levels 1 to 5
    ctx.strokeStyle = 'rgba(90,60,180,0.08)';
    ctx.lineWidth = 1;
    for (let lvl = 1; lvl <= 5; lvl++) {
      const y = PAD.top + chartH - ((lvl - 1) / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + chartW, y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(90,80,130,0.6)';
      ctx.font = '10px Inter, system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(`L${lvl}`, PAD.left - 6, y + 3);
    }

    // Sorted points
    const sorted = [...records].sort((a, b) => a.ts - b.ts);
    const minT = sorted[0].ts;
    const maxT = Math.max(minT + 86400000, sorted[sorted.length - 1].ts);
    const tSpan = Math.max(1, maxT - minT);

    function getX(ts) {
      return PAD.left + ((ts - minT) / tSpan) * chartW;
    }
    function getY(level) {
      return PAD.top + chartH - ((level - 1) / 4) * chartH;
    }

    // Draw individual prompt points
    sorted.forEach(r => {
      const px = getX(r.ts);
      const py = getY(r.level);

      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = LEVEL_META[r.level].color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    });

    // Draw OLS Regression Fit Line
    if (ols) {
      const x0 = PAD.left;
      const x1 = PAD.left + chartW;
      const daysTotal = tSpan / 86400000;
      const yStartLevel = ols.intercept;
      const yEndLevel = ols.intercept + ols.slope * daysTotal;

      const y0 = getY(Math.max(1, Math.min(5, yStartLevel)));
      const y1 = getY(Math.max(1, Math.min(5, yEndLevel)));

      // Glowing regression line
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = ols.isSig ? '#10b981' : '#7c3aed';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Regression Equation & p-value label on canvas
      ctx.fillStyle = ols.isSig ? '#047857' : '#5b21b6';
      ctx.font = 'bold 10px Inter, system-ui';
      ctx.textAlign = 'right';
      const slopeStr = (ols.slope >= 0 ? '+' : '') + ols.slope.toFixed(2);
      ctx.fillText(`OLS Trend: ${slopeStr}/day (R² = ${ols.r2.toFixed(2)}, p ${formatPValue(ols.p)})`, PAD.left + chartW, PAD.top - 6);
    }

    // X Axis Labels
    const startStr = new Date(minT).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const endStr = new Date(maxT).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    ctx.fillStyle = 'rgba(90,80,130,0.6)';
    ctx.font = '10px Inter, system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(startStr, PAD.left, PAD.top + chartH + 18);
    ctx.textAlign = 'right';
    ctx.fillText(endStr, PAD.left + chartW, PAD.top + chartH + 18);

    // 3. Render 3 Statistical Test Cards
    const sigBadge = (isSig, p) => isSig
      ? `<span class="stat-badge stat-badge-sig">p < 0.05 • Sig</span>`
      : `<span class="stat-badge stat-badge-insig">p ≥ 0.05 • Not Sig</span>`;

    let html = '';

    // Card 1: Linear Regression
    if (ols) {
      html += `
        <div class="stat-test-card">
          <div class="stat-test-header">
            <span class="stat-test-name">1. Linear Regression (OLS)</span>
            ${sigBadge(ols.isSig, ols.p)}
          </div>
          <div class="stat-test-metrics">
            <div class="stat-test-metric">
              <span class="stat-metric-key">R² Variance</span>
              <span class="stat-metric-val">${(ols.r2 * 100).toFixed(1)}%</span>
            </div>
            <div class="stat-test-metric">
              <span class="stat-metric-key">p-value</span>
              <span class="stat-metric-val p-val">${formatPValue(ols.p)}</span>
            </div>
            <div class="stat-test-metric">
              <span class="stat-metric-key">Slope (Δ/day)</span>
              <span class="stat-metric-val">${(ols.slope >= 0 ? '+' : '') + ols.slope.toFixed(2)}</span>
            </div>
            <div class="stat-test-metric">
              <span class="stat-metric-key">t-statistic</span>
              <span class="stat-metric-val">${ols.t.toFixed(2)}</span>
            </div>
          </div>
          <div class="stat-test-desc">
            ${ols.isSig
              ? `Significant ${ols.direction} trajectory (${ols.slope > 0 ? 'higher' : 'lower'} AI level over time, t(${ols.df}) = ${ols.t.toFixed(2)}).`
              : `Slope is not significantly different from zero (p = ${ols.p.toFixed(3)}). Usage is statistically flat.`}
          </div>
        </div>`;
    }

    // Card 2: Welch's t-Test
    if (welch) {
      html += `
        <div class="stat-test-card">
          <div class="stat-test-header">
            <span class="stat-test-name">2. Welch's t-Test (Split)</span>
            ${sigBadge(welch.isSig, welch.p)}
          </div>
          <div class="stat-test-metrics">
            <div class="stat-test-metric">
              <span class="stat-metric-key">Early vs Recent Mean</span>
              <span class="stat-metric-val">${welch.m1.toFixed(1)} → ${welch.m2.toFixed(1)}</span>
            </div>
            <div class="stat-test-metric">
              <span class="stat-metric-key">p-value</span>
              <span class="stat-metric-val p-val">${formatPValue(welch.p)}</span>
            </div>
            <div class="stat-test-metric">
              <span class="stat-metric-key">Mean Shift (Δμ)</span>
              <span class="stat-metric-val">${(welch.diff >= 0 ? '+' : '') + welch.diff.toFixed(2)}</span>
            </div>
            <div class="stat-test-metric">
              <span class="stat-metric-key">Cohen's d</span>
              <span class="stat-metric-val">${welch.d.toFixed(2)}</span>
            </div>
          </div>
          <div class="stat-test-desc">
            ${welch.isSig
              ? `Statistically significant difference between earlier (μ=${welch.m1.toFixed(1)}) and recent (μ=${welch.m2.toFixed(1)}) prompts (d = ${welch.d.toFixed(2)}).`
              : `No significant difference between early (μ=${welch.m1.toFixed(1)}) and recent (μ=${welch.m2.toFixed(1)}) prompts.`}
          </div>
        </div>`;
    } else {
      html += `
        <div class="stat-test-card">
          <div class="stat-test-header">
            <span class="stat-test-name">2. Welch's t-Test (Split)</span>
            <span class="stat-badge stat-badge-insig">N < 4</span>
          </div>
          <div class="stat-test-desc">Requires at least 4 prompts to split into earlier vs. recent groups.</div>
        </div>`;
    }

    // Card 3: Mann-Kendall Trend Test
    if (mk) {
      html += `
        <div class="stat-test-card">
          <div class="stat-test-header">
            <span class="stat-test-name">3. Mann-Kendall Trend</span>
            ${sigBadge(mk.isSig, mk.p)}
          </div>
          <div class="stat-test-metrics">
            <div class="stat-test-metric">
              <span class="stat-metric-key">Kendall's τ</span>
              <span class="stat-metric-val">${(mk.tau >= 0 ? '+' : '') + mk.tau.toFixed(2)}</span>
            </div>
            <div class="stat-test-metric">
              <span class="stat-metric-key">p-value</span>
              <span class="stat-metric-val p-val">${formatPValue(mk.p)}</span>
            </div>
            <div class="stat-test-metric">
              <span class="stat-metric-key">Z-Score</span>
              <span class="stat-metric-val">${mk.Z.toFixed(2)}</span>
            </div>
            <div class="stat-test-metric">
              <span class="stat-metric-key">Sen's Slope</span>
              <span class="stat-metric-val">${(mk.sensSlope >= 0 ? '+' : '') + mk.sensSlope.toFixed(2)}</span>
            </div>
          </div>
          <div class="stat-test-desc">
            ${mk.isSig
              ? `Non-parametric test confirms a monotonic trend across ordinal prompt levels (Z = ${mk.Z.toFixed(2)}, p < 0.05).`
              : `Non-parametric rank test indicates monotonic stability over time (Z = ${mk.Z.toFixed(2)}, p = ${mk.p.toFixed(3)}).`}
          </div>
        </div>`;
    }

    testsGridEl.innerHTML = html;
  }

  /* ── Full render ──────────────────────────────────────────────────────── */
  function renderAnalytics() {
    const all     = loadRecords();
    const records = filterByPeriod(all, activePeriod);
    if (activeView === 'advanced') {
      renderAdvancedStats(records, activePeriod);
    } else {
      renderStatCards(records);
      renderBarChart(records, activePeriod);
      renderDonut(records);
    }
  }

  /* ── Open / Close ─────────────────────────────────────────────────────── */
  function openAnalytics() {
    const modal = document.getElementById('analytics-modal');
    if (!modal) return;
    modal.classList.add('visible');
    // Chart needs real pixel dimensions – render after paint
    requestAnimationFrame(() => { requestAnimationFrame(renderAnalytics); });
  }
  function closeAnalytics() {
    const modal = document.getElementById('analytics-modal');
    if (modal) modal.classList.remove('visible');
  }

  /* ── Wire up events ───────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {}, { once: true });
  // Using a small timeout to ensure the DOM is ready (script runs deferred)
  setTimeout(() => {
    // Open button in sidebar
    const navBtn = document.getElementById('analytics-nav-btn');
    if (navBtn) navBtn.addEventListener('click', openAnalytics);

    // Advanced Stats View toggle button in header
    const viewToggleBtn = document.getElementById('analytics-view-toggle-btn');
    if (viewToggleBtn) viewToggleBtn.addEventListener('click', toggleAnalyticsView);

    // Close button
    const closeBtn = document.getElementById('analytics-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeAnalytics);

    // Click-outside to close
    const modal = document.getElementById('analytics-modal');
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) closeAnalytics();
      });
    }

    // Period tabs
    document.querySelectorAll('.analytics-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.analytics-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const p = tab.dataset.period;
        activePeriod = p === 'all' ? 'all' : parseInt(p, 10);
        renderAnalytics();
      });
    });

    // Clear data
    const clearBtn = document.getElementById('analytics-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Clear all your AI analytics data? This cannot be undone.')) {
          localStorage.removeItem(STORE_KEY);
          renderAnalytics();
        }
      });
    }

    // Escape key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeAnalytics();
    });

    // Re-render chart on window resize when open
    window.addEventListener('resize', () => {
      const modal = document.getElementById('analytics-modal');
      if (modal && modal.classList.contains('visible')) renderAnalytics();
    });
  }, 50);

  // Expose recordAssessment globally so other code can call it if needed
  window.ttRecordAssessment = recordAssessment;

})();
// ══ End AI Analytics System ═══════════════════════════════════════════════════


// ══ Resources & Web Research System ═══════════════════════════════════════════
const ResourcesApp = (() => {
  let attachedResources = []; // Up to 5 items: { id, title, url, domain, type, description }
  let userResources = []; // Cached array of user resources from DB
  let currentFilter = 'all';
  let searchQuery = '';

  // Web Research modal state
  let webHistory = [];
  let webHistoryIndex = -1;
  let currentPageData = null; // { url, title, domain, description, content, canEmbed, origin }

  // Helpers
  function getCsrfHeader() {
    return {
      'Content-Type': 'application/json',
      'CSRF-Token': window.csrfToken || ''
    };
  }

  function showToast(message, duration = 2800) {
    const toast = document.getElementById('tt-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.display = 'block';
    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.display = 'none';
    }, duration);
  }

  // --- Attached Resources (Composer) ---
  function renderAttachedChips() {
    const container = document.getElementById('attached-resources-container');
    if (!container) return;
    if (attachedResources.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }
    container.style.display = 'flex';
    container.innerHTML = '';
    attachedResources.forEach(res => {
      const chip = document.createElement('div');
      chip.className = 'attached-resource-chip';
      chip.title = `${res.title} (${res.domain || res.url})`;
      
      const icon = document.createElement('span');
      icon.className = 'attached-chip-icon';
      icon.textContent = res.type === 'document' ? '📄' : '🌐';
      
      const titleSpan = document.createElement('span');
      titleSpan.className = 'attached-chip-title';
      titleSpan.textContent = res.title || res.url;
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'attached-chip-remove';
      removeBtn.type = 'button';
      removeBtn.innerHTML = '&times;';
      removeBtn.setAttribute('aria-label', `Remove attached resource ${res.title}`);
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        detachResource(res.id);
      });
      
      chip.appendChild(icon);
      chip.appendChild(titleSpan);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  }

  function attachResource(res) {
    if (!res || !res.id) return;
    if (attachedResources.some(r => String(r.id) === String(res.id))) {
      showToast('Resource already attached to chat');
      return;
    }
    if (attachedResources.length >= 5) {
      showToast('Maximum 5 resources can be attached per message');
      return;
    }
    attachedResources.push(res);
    renderAttachedChips();
    showToast(`Attached "${res.title || 'Resource'}" to chat`);
  }

  function detachResource(resourceId) {
    attachedResources = attachedResources.filter(r => String(r.id) !== String(resourceId));
    renderAttachedChips();
  }

  function getAttachedResourceIds() {
    return attachedResources.map(r => r.id);
  }

  function getAttachedResources() {
    return [...attachedResources];
  }

  function clearAttachedResources() {
    attachedResources = [];
    renderAttachedChips();
  }

  // --- My Resources Modal ---
  async function loadUserResources() {
    try {
      const res = await fetch(`/api/resources?type=${currentFilter}`, {
        headers: { 'CSRF-Token': window.csrfToken || '' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          userResources = data.resources || [];
          renderResourceCards();
        }
      }
    } catch (e) {
      console.error('Error loading resources:', e);
    }
  }

  function renderResourceCards() {
    const container = document.getElementById('resources-cards-container');
    if (!container) return;

    let filtered = userResources;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(r => 
        (r.title && r.title.toLowerCase().includes(q)) ||
        (r.domain && r.domain.toLowerCase().includes(q)) ||
        (r.description && r.description.toLowerCase().includes(q)) ||
        (r.url && r.url.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="resources-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
          <h3>No resources found</h3>
          <p>${searchQuery ? 'Try adjusting your search query.' : 'Use Web Research to discover and save verified articles, clinical guidelines, and research papers.'}</p>
          <button class="resources-add-btn" id="empty-state-research-btn" type="button">
            <span>Open Web Research</span>
          </button>
        </div>
      `;
      const btn = document.getElementById('empty-state-research-btn');
      if (btn) {
        btn.addEventListener('click', () => {
          closeMyResourcesModal();
          openWebResearchModal();
        });
      }
      return;
    }

    container.innerHTML = '';
    filtered.forEach(res => {
      const card = document.createElement('div');
      card.className = 'resource-card';
      
      let domainDisplay = res.domain;
      if (!domainDisplay && res.url) {
        try { domainDisplay = new URL(res.url).hostname; } catch (_) { domainDisplay = 'web'; }
      }
      domainDisplay = domainDisplay || 'web';

      const isDoc = res.type === 'document';
      const formattedDate = res.created_at ? new Date(res.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Recently added';

      card.innerHTML = `
        <div>
          <div class="resource-card-header">
            <span class="resource-card-domain-badge">${isDoc ? '📄 doc' : `🌐 ${escapeHtml(domainDisplay)}`}</span>
            <span class="resource-card-type-tag">${escapeHtml(res.type || 'web')}</span>
          </div>
          <h4 class="resource-card-title">${escapeHtml(res.title || 'Untitled Resource')}</h4>
          ${res.url ? `<a href="${escapeHtml(res.url)}" target="_blank" rel="noopener noreferrer" class="resource-card-url">${escapeHtml(res.url)}</a>` : ''}
          ${res.description ? `<p class="resource-card-desc">${escapeHtml(res.description)}</p>` : ''}
        </div>
        <div class="resource-card-footer">
          <span class="resource-card-date">${formattedDate}</span>
          <div class="resource-card-actions">
            <button class="resource-card-btn-open" type="button" title="View in Web Research">Open</button>
            <button class="resource-card-btn-chat" type="button" title="Attach to Chat Composer">Use in Chat</button>
            <button class="resource-card-btn-delete" type="button" aria-label="Delete resource" title="Delete resource">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      `;

      // Open button
      card.querySelector('.resource-card-btn-open').addEventListener('click', () => {
        closeMyResourcesModal();
        openWebResearchModal(res.url);
      });

      // Use in chat button
      card.querySelector('.resource-card-btn-chat').addEventListener('click', () => {
        attachResource(res);
        closeMyResourcesModal();
      });

      // Delete button
      card.querySelector('.resource-card-btn-delete').addEventListener('click', async () => {
        if (!confirm(`Remove "${res.title}" from your resources?`)) return;
        try {
          const resp = await fetch(`/api/resources/${res.id}`, {
            method: 'DELETE',
            headers: getCsrfHeader()
          });
          if (resp.ok) {
            userResources = userResources.filter(r => r.id !== res.id);
            detachResource(res.id);
            renderResourceCards();
            showToast('Resource removed');
          }
        } catch (delErr) {
          console.error('Delete resource error:', delErr);
        }
      });

      container.appendChild(card);
    });
  }

  function openMyResourcesModal() {
    const modal = document.getElementById('my-resources-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    loadUserResources();
  }

  function closeMyResourcesModal() {
    const modal = document.getElementById('my-resources-modal');
    if (!modal) return;
    modal.style.display = 'none';
  }

  // --- Web Research Modal ---
  function openWebResearchModal(initialUrl = '') {
    const modal = document.getElementById('web-research-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    if (initialUrl) {
      navigateTo(initialUrl);
    } else if (!currentPageData) {
      renderDiscoveryHome();
    }
  }

  function closeWebResearchModal() {
    const modal = document.getElementById('web-research-modal');
    if (!modal) return;
    modal.style.display = 'none';
  }

  function renderDiscoveryHome() {
    currentPageData = null;
    updateWebResearchFooter();
    const body = document.getElementById('web-research-body');
    const input = document.getElementById('web-address-input');
    if (input) input.value = '';

    body.innerHTML = `
      <div class="web-discovery-home">
        <div class="web-discovery-hero">
          <h3>Academic &amp; Clinical Web Research</h3>
          <p>Search trusted educational databases or paste any article URL to preview reader mode and save key references to your project.</p>
          <div class="web-quick-topics">
            <button class="web-topic-btn" data-query="NICE guidelines asthma management">NICE Guidelines Asthma</button>
            <button class="web-topic-btn" data-query="Turing test artificial intelligence Alan Turing 1950">Alan Turing 1950 Paper</button>
            <button class="web-topic-btn" data-query="NHS blood test C-reactive protein CRP">NHS CRP Blood Tests</button>
            <button class="web-topic-btn" data-query="Higher Education AI assessment academic integrity JISC">JISC AI in Higher Ed</button>
          </div>
        </div>
      </div>
    `;

    body.querySelectorAll('.web-topic-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const query = btn.getAttribute('data-query');
        if (input) input.value = query;
        performSearch(query);
      });
    });
  }

  async function performSearch(query) {
    if (!query || !query.trim()) return;
    const body = document.getElementById('web-research-body');
    const loading = document.getElementById('web-research-loading');
    if (loading) loading.style.display = 'block';

    try {
      const res = await fetch(`/api/web-search?q=${encodeURIComponent(query.trim())}`, {
        headers: { 'CSRF-Token': window.csrfToken || '' }
      });
      if (loading) loading.style.display = 'none';
      if (!res.ok) {
        body.innerHTML = `<div class="web-fallback-notice"><h4>Search failed</h4><p>Unable to retrieve search results. Please try again or enter a direct URL.</p></div>`;
        return;
      }
      const data = await res.json();
      const results = data.results || [];

      if (results.length === 0) {
        body.innerHTML = `
          <div class="web-fallback-notice">
            <h4>No search results found</h4>
            <p>Try refining your search terms or entering a direct URL above.</p>
          </div>
        `;
        return;
      }

      body.innerHTML = `
        <div class="web-search-results-list">
          <div style="font-size: 0.85rem; font-weight: 600; color: #4c1d95; margin-bottom: 4px;">
            Search results for "${escapeHtml(query)}"
          </div>
          ${results.map((r, i) => {
            let resDomain = r.domain;
            if (!resDomain && r.url) {
              try { resDomain = new URL(r.url).hostname; } catch (_) { resDomain = 'web'; }
            }
            return `
              <div class="web-search-result-item" data-url="${escapeHtml(r.url)}">
                <div class="web-search-result-domain">🌐 ${escapeHtml(resDomain || 'web')}</div>
                <h3 class="web-search-result-title">${escapeHtml(r.title)}</h3>
                <p class="web-search-result-snippet">${escapeHtml(r.snippet || r.description || '')}</p>
              </div>
            `;
          }).join('')}
        </div>
      `;

      body.querySelectorAll('.web-search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          const url = item.getAttribute('data-url');
          navigateTo(url);
        });
      });

    } catch (err) {
      if (loading) loading.style.display = 'none';
      body.innerHTML = `<div class="web-fallback-notice"><h4>Search Error</h4><p>${escapeHtml(err.message || 'Error executing search')}</p></div>`;
    }
  }

  async function navigateTo(url, pushHistory = true) {
    if (!url || !url.trim()) return;
    const cleanUrl = url.trim();
    const input = document.getElementById('web-address-input');
    if (input) input.value = cleanUrl;

    const body = document.getElementById('web-research-body');
    const loading = document.getElementById('web-research-loading');
    if (loading) loading.style.display = 'block';

    if (pushHistory) {
      if (webHistoryIndex < webHistory.length - 1) {
        webHistory = webHistory.slice(0, webHistoryIndex + 1);
      }
      webHistory.push(cleanUrl);
      webHistoryIndex = webHistory.length - 1;
      updateNavButtons();
    }

    try {
      const res = await fetch('/api/web-resource', {
        method: 'POST',
        headers: getCsrfHeader(),
        body: JSON.stringify({ url: cleanUrl })
      });

      if (loading) loading.style.display = 'none';

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        renderFallbackView(cleanUrl, errData.error || 'This URL could not be loaded safely.');
        return;
      }

      const data = await res.json();
      const pageResource = data.resource || data;
      currentPageData = pageResource;
      updateWebResearchFooter();

      if (!pageResource.canEmbed && !pageResource.content && !pageResource.sanitizedContent) {
        renderFallbackView(cleanUrl, 'This website restricts embedded reading mode.');
        return;
      }

      renderReaderView(pageResource);

    } catch (err) {
      if (loading) loading.style.display = 'none';
      renderFallbackView(cleanUrl, err.message || 'Connection error.');
    }
  }

  function renderReaderView(data) {
    const body = document.getElementById('web-research-body');
    body.innerHTML = `
      <div class="web-reader-container">
        <div class="web-reader-header">
          <div class="web-reader-domain-row">
            <span class="web-reader-domain-tag">🌐 ${escapeHtml(data.domain || '')}</span>
            <a href="${escapeHtml(data.url)}" target="_blank" rel="noopener noreferrer" class="web-fallback-open-btn" style="padding: 4px 10px; font-size: 0.74rem;">
              Open in new tab ↗
            </a>
          </div>
          <h1 class="web-reader-title">${escapeHtml(data.title || 'Untitled Document')}</h1>
          <div class="web-reader-meta">
            <span>Verified Source</span>
            <span>Accessed: ${new Date().toLocaleDateString('en-GB')}</span>
          </div>
        </div>
        <div class="web-reader-content">
          ${data.content || data.sanitizedContent || `<p>${escapeHtml(data.description || 'No readable text content extracted.')}</p>`}
        </div>
      </div>
    `;
  }

  function renderFallbackView(url, reason) {
    const body = document.getElementById('web-research-body');
    let dom = '';
    try { dom = new URL(url).hostname; } catch (_) { dom = url; }
    currentPageData = {
      url: url,
      title: url,
      domain: dom,
      description: reason,
      content: '',
      origin: 'web'
    };
    updateWebResearchFooter();

    body.innerHTML = `
      <div class="web-fallback-notice">
        <h4>Embedded Viewing Restricted</h4>
        <p>${escapeHtml(reason || 'This website does not allow embedded viewing in web research mode.')}</p>
        <div class="web-fallback-actions">
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="web-fallback-open-btn">
            Open in new tab ↗
          </a>
        </div>
      </div>
    `;
  }

  function updateNavButtons() {
    const backBtn = document.getElementById('web-nav-back');
    const fwdBtn = document.getElementById('web-nav-forward');
    if (backBtn) backBtn.disabled = webHistoryIndex <= 0;
    if (fwdBtn) fwdBtn.disabled = webHistoryIndex >= webHistory.length - 1;
  }

  function updateWebResearchFooter() {
    const urlLabel = document.getElementById('web-current-url');
    const addBtn = document.getElementById('web-add-resource-btn');
    if (!urlLabel || !addBtn) return;

    if (!currentPageData || !currentPageData.url) {
      urlLabel.textContent = 'None selected';
      addBtn.disabled = true;
      addBtn.className = 'web-add-resource-btn';
      addBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>+ Add as Resource</span>
      `;
      return;
    }

    urlLabel.textContent = currentPageData.url;
    addBtn.disabled = false;

    // Check if URL is already in user resources
    const isAlreadySaved = userResources.some(r => r.url === currentPageData.url);
    if (isAlreadySaved) {
      addBtn.className = 'web-add-resource-btn in-resources-state';
      addBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>✓ In Resources</span>
      `;
    } else {
      addBtn.className = 'web-add-resource-btn';
      addBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>+ Add as Resource</span>
      `;
    }
  }

  async function saveCurrentPageAsResource() {
    if (!currentPageData || !currentPageData.url) return;
    const addBtn = document.getElementById('web-add-resource-btn');
    if (addBtn) addBtn.disabled = true;

    try {
      const resp = await fetch('/api/resources', {
        method: 'POST',
        headers: getCsrfHeader(),
        body: JSON.stringify({
          title: currentPageData.title || currentPageData.url,
          url: currentPageData.url,
          domain: currentPageData.domain,
          description: currentPageData.description || '',
          content: currentPageData.content || currentPageData.sanitizedContent || '',
          type: 'web_page',
          origin: 'web_search'
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.resource) {
          if (!userResources.some(r => r.id === data.resource.id)) {
            userResources.unshift(data.resource);
          }
        }
        showToast('✓ Page added to your resources');

        // State progression: + Add as Resource -> ✓ Added to Resources -> ✓ In Resources
        if (addBtn) {
          addBtn.className = 'web-add-resource-btn added-state';
          addBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>✓ Added to Resources</span>
          `;
          setTimeout(() => {
            addBtn.disabled = false;
            addBtn.className = 'web-add-resource-btn in-resources-state';
            addBtn.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>✓ In Resources</span>
            `;
          }, 2200);
        }
      } else {
        showToast('Failed to save resource');
        if (addBtn) addBtn.disabled = false;
      }
    } catch (err) {
      console.error('Save resource error:', err);
      showToast('Error saving resource');
      if (addBtn) addBtn.disabled = false;
    }
  }

  // --- Initialization ---
  function init() {
    // 1. Sidebar Accordion
    const accordionBtn = document.getElementById('resources-accordion-btn');
    const accordionPanel = document.getElementById('resources-dropdown');
    if (accordionBtn && accordionPanel) {
      accordionBtn.addEventListener('click', () => {
        const isOpen = accordionBtn.getAttribute('aria-expanded') === 'true';
        accordionBtn.setAttribute('aria-expanded', String(!isOpen));
        accordionPanel.classList.toggle('open', !isOpen);
      });
    }

    // 2. Submenu button clicks
    const myResBtn = document.getElementById('my-resources-btn');
    if (myResBtn) myResBtn.addEventListener('click', openMyResourcesModal);

    const webResBtn = document.getElementById('web-research-btn');
    if (webResBtn) webResBtn.addEventListener('click', () => openWebResearchModal());

    // 3. Modal close buttons & backdrop clicks
    const myResClose = document.getElementById('my-resources-close');
    if (myResClose) myResClose.addEventListener('click', closeMyResourcesModal);

    const myResModal = document.getElementById('my-resources-modal');
    if (myResModal) {
      myResModal.addEventListener('click', (e) => {
        if (e.target === myResModal) closeMyResourcesModal();
      });
    }

    const webResClose = document.getElementById('web-research-close');
    if (webResClose) webResClose.addEventListener('click', closeWebResearchModal);

    const webResModal = document.getElementById('web-research-modal');
    if (webResModal) {
      webResModal.addEventListener('click', (e) => {
        if (e.target === webResModal) closeWebResearchModal();
      });
    }

    // 4. Search & Filter in My Resources
    const searchInput = document.getElementById('resources-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderResourceCards();
      });
    }

    document.querySelectorAll('.resource-filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.resource-filter-tab').forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        currentFilter = tab.getAttribute('data-type') || 'all';
        loadUserResources();
      });
    });

    // 5. Quick Add modal in My Resources
    const quickAddBtn = document.getElementById('resources-add-quick-btn');
    const quickAddModal = document.getElementById('quick-add-modal');
    const quickAddClose = document.getElementById('quick-add-close');
    const quickAddCancel = document.getElementById('quick-add-cancel');
    const quickAddForm = document.getElementById('quick-add-form');

    if (quickAddBtn && quickAddModal) {
      quickAddBtn.addEventListener('click', () => {
        quickAddModal.style.display = 'flex';
      });
    }
    if (quickAddClose && quickAddModal) {
      quickAddClose.addEventListener('click', () => {
        quickAddModal.style.display = 'none';
      });
    }
    if (quickAddCancel && quickAddModal) {
      quickAddCancel.addEventListener('click', () => {
        quickAddModal.style.display = 'none';
      });
    }
    if (quickAddForm) {
      quickAddForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('quick-add-url').value.trim();
        const title = document.getElementById('quick-add-title-input').value.trim();
        const description = document.getElementById('quick-add-desc').value.trim();
        if (!url) return;

        try {
          const resp = await fetch('/api/resources', {
            method: 'POST',
            headers: getCsrfHeader(),
            body: JSON.stringify({ url, title: title || url, description, type: 'web_page' })
          });
          if (resp.ok) {
            quickAddModal.style.display = 'none';
            quickAddForm.reset();
            showToast('Resource added successfully');
            loadUserResources();
          }
        } catch (err) {
          console.error('Quick add error:', err);
        }
      });
    }

    // 6. Web Research Navigation & Address Bar
    const addressInput = document.getElementById('web-address-input');
    const addressSubmit = document.getElementById('web-address-submit');

    const handleAddressSubmit = () => {
      if (!addressInput) return;
      const val = addressInput.value.trim();
      if (!val) return;
      if (/^https?:\/\//i.test(val) || /^[\w-]+\.[\w.-]+(\/.*)?$/i.test(val)) {
        const targetUrl = /^https?:\/\//i.test(val) ? val : `https://${val}`;
        navigateTo(targetUrl);
      } else {
        performSearch(val);
      }
    };

    if (addressSubmit) addressSubmit.addEventListener('click', handleAddressSubmit);
    if (addressInput) {
      addressInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleAddressSubmit();
        }
      });
    }

    const backBtn = document.getElementById('web-nav-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (webHistoryIndex > 0) {
          webHistoryIndex--;
          updateNavButtons();
          navigateTo(webHistory[webHistoryIndex], false);
        }
      });
    }

    const fwdBtn = document.getElementById('web-nav-forward');
    if (fwdBtn) {
      fwdBtn.addEventListener('click', () => {
        if (webHistoryIndex < webHistory.length - 1) {
          webHistoryIndex++;
          updateNavButtons();
          navigateTo(webHistory[webHistoryIndex], false);
        }
      });
    }

    const refreshBtn = document.getElementById('web-nav-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        if (currentPageData && currentPageData.url) {
          navigateTo(currentPageData.url, false);
        } else {
          renderDiscoveryHome();
        }
      });
    }

    const addResourceBtn = document.getElementById('web-add-resource-btn');
    if (addResourceBtn) {
      addResourceBtn.addEventListener('click', saveCurrentPageAsResource);
    }

    // 7. Global Keyboard accessibility (ESC to close active modals)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (quickAddModal && quickAddModal.style.display !== 'none') {
          quickAddModal.style.display = 'none';
        } else if (webResModal && webResModal.style.display !== 'none') {
          closeWebResearchModal();
        } else if (myResModal && myResModal.style.display !== 'none') {
          closeMyResourcesModal();
        }
      }
    });

    // Preload user resources
    loadUserResources();
  }

  return {
    init,
    attachResource,
    detachResource,
    getAttachedResourceIds,
    getAttachedResources,
    clearAttachedResources,
    openMyResourcesModal,
    openWebResearchModal,
    showToast
  };
})();

// Initialize ResourcesApp on DOM readiness
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ResourcesApp.init());
} else {
  setTimeout(() => ResourcesApp.init(), 50);
}
// ══ End Resources & Web Research System ═══════════════════════════════════════
