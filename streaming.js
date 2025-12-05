import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import helmet from 'helmet';
import csrf from 'csurf';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import authRouter from './server/routes/auth.js';
import { attachDbUser, setCurrentUserId } from './server/db/postgres.js';
import bcrypt from 'bcrypt';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { registerUser, getUser, updateUserPassword, createSession, createTuringSession, saveMessage, getSessions, getMessages, deleteSession, getNextSessionId, saveFeedback, getFeedback, getMessageByContent, saveScaleLevel, getScaleLevels, updateMessageCollapsedState, createGroup, deleteGroup, getUserGroups, updateSessionGroup, renameGroup, renameSession, updateMessageContent, getSessionById, getSessionByMessageId, saveMessageWithScaleLevel, getEmptyAssistantMessage, ensureMessageMetadataColumns } from './server/db/postgres.js';
import { checkAuth } from './server/middleware/auth.js';

dotenv.config({ path: './APIkey.env' });

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const app = express();
// Allow overriding the port via env; default to 3000
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Allow large HTML payloads that include base64-encoded images from Turing Mode
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(cookieParser());

// Basic security headers (CSP disabled to avoid breaking inline scripts/styles)
app.use(helmet({ contentSecurityPolicy: false }));

// Ensure DB has metadata columns for durable Turing screenshots/refs
try {
    if (typeof ensureMessageMetadataColumns === 'function') {
        await ensureMessageMetadataColumns();
    }
} catch (e) {
    console.warn('Startup DB ensure failed (continuing):', e && e.message ? e.message : e);
}

// CSRF protection (cookie-based tokens)
const csrfProtection = csrf({
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
    }
});
app.use(csrfProtection);

// Sessions (used server-side); keep legacy cookies for compatibility
app.use(session({
    secret: process.env.SESSION_SECRET || 'change-me-in-env',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
    }
}));

// Attach DB request context for RLS: this will populate AsyncLocalStorage
// with the current user id (if present in req.session.user) so DB queries
// automatically set the session-local app.current_user_id before running.
app.use(attachDbUser);

// Rate limiting
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const generalLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 300 });
app.use(generalLimiter);

// checkAuth moved to server/middleware/auth.js

app.get('/', (req, res) => {
    res.sendFile(path.join(path.resolve(), 'public', 'home.html'));
});

// Tight CSP for public HTML that we refactored to remove inline JS/CSS
const cspStrict = helmet.contentSecurityPolicy({
    useDefaults: true,
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
    }
});

app.get('/login.html', cspStrict, (req, res) => {
    res.sendFile(path.join(path.resolve(), 'public', 'login.html'));
});

app.get('/register.html', cspStrict, (req, res) => {
    res.sendFile(path.join(path.resolve(), 'public', 'register.html'));
});

// CSP for main app (index.html): allow local scripts/styles and jsdelivr for html2canvas while we migrate to local vendor copy
// NOTE: html2canvas and some UI libraries create inline style attributes
// at runtime (element.style.*). Browsers will block those when CSP's
// style-src disallows inline styles. As a pragmatic short-term fix we
// include 'unsafe-inline' for the app index page. This is intended as a
// temporary mitigation while we progressively remove inline-style usage
// and migrate dynamic sizing to CSS classes or CSSOM rules.
const cspIndex = helmet.contentSecurityPolicy({
    useDefaults: true,
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Allow inline styles for now to support html2canvas and some UI
        // behaviors. Consider removing this later and implementing a
        // narrower solution (nonce/hash or dedicated capture endpoint).
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"]
    }
});

app.get('/index.html', cspIndex, (req, res) => {
    res.sendFile(path.join(path.resolve(), 'public', 'index.html'));
});

// Mount auth routes (register, login, logout, csrf-token)
app.use('/', authRouter);

// Rename a session
app.post('/rename-session', async (req, res) => {
    const { session_id, session_name } = req.body;
    if (!session_id || !session_name) return res.json({ success: false, message: 'Missing fields' });
    try {
        await renameSession(session_id, session_name);
        res.json({ success: true });
    } catch (err) {
        console.error('Error renaming session:', err);
        res.json({ success: false, message: 'Could not rename session' });
    }
});

app.get('/sessions', async (req, res) => {
    const username = req.cookies.username;
    try {
        const user = await getUser(username);
        if (!user) return res.json({ success: false, message: 'User not found' });
        const sessions = await getSessions(user.id);
        res.json({ success: true, sessions });
    } catch (err) {
        console.error('Error fetching sessions:', err);
        res.json({ success: false, message: 'Could not retrieve sessions' });
    }
});

app.get('/messages', async (req, res) => {
    const session_id = req.query.session_id;
    const username = req.cookies.username;
    try {
        const sess = await getSessionById(session_id);
        if (!sess || sess.username !== username) return res.json({ success: false, message: 'Not authorized for this session' });
        const [messages, feedbackData, scaleRows] = await Promise.all([
            getMessages(session_id),
            getFeedback(session_id),
            getScaleLevels(session_id)
        ]);

        // For legacy Turing sessions created before we seeded an assistant row,
        // ensure there is a blank assistant message with a persisted id.
        if ((sess?.is_turing === 1 || sess?.is_turing === true) && !messages.some(m => m.role === 'assistant')) {
            const blankId = await saveMessageWithScaleLevel(session_id, username, 'assistant', '', 0, 1);
            // Push a normalized message object to return immediately
            messages.push({
                id: blankId,
                message_id: blankId,
                session_id: Number(session_id),
                username,
                role: 'assistant',
                content: '',
                collapsed: 0,
                scale_level: 1,
                references: [],
                prompts: []
            });
        }

        const scaleLevels = [...new Set(scaleRows.map(row => row.scale_level))];

        // Normalize prompt shapes server-side so clients can render reliably
        const normalizePrompt = (p) => {
            try {
                if (typeof p === 'string') {
                    const s = p.trim();
                    if (/^data:image\//i.test(s)) return { type: 'image', src: s };
                    // Treat obvious image URLs (absolute or site-relative) as images
                    if (/^(https?:)?\/\//i.test(s) || s.startsWith('/')) {
                        if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(s)) {
                            return { type: 'image', src: s };
                        }
                    }
                    return s || null;
                }
                if (p && typeof p === 'object') {
                    if (p.src) return { type: p.type || 'image', src: p.src, alt: p.alt || '' };
                    const src = p.dataUrl || p.data || (p.image && p.image.src) || p.image || p.base64 || null;
                    if (src && typeof src === 'string') {
                        const ss = src.trim();
                        if (/^data:image\//i.test(ss) || /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(ss)) {
                            return { type: 'image', src: ss, alt: p.alt || '' };
                        }
                    }
                    if (p.text) return { text: p.text };
                }
            } catch (_) {}
            return p;
        };
        for (const m of messages) {
            if (Array.isArray(m.prompts)) {
                m.prompts = m.prompts.map(normalizePrompt).filter(x => x !== null && x !== undefined);
            } else {
                m.prompts = [];
            }
            if (!Array.isArray(m.references) || m.references === null) m.references = [];
        }

        res.json({
            success: true,
            is_turing: sess?.is_turing === 1 || sess?.is_turing === true ? 1 : 0,
            messages: messages.map(m => ({
                ...m,
                message_id: m.id ?? m.message_id,
                scale_level: m.scale_level || 1,
                collapsed: m.collapsed || 0
            })),
            feedbackData,
            scale_levels: scaleLevels,
        });
    } catch (err) {
        console.error('Error fetching messages payload:', err);
        res.json({ success: false, message: 'Error fetching messages' });
    }
});



// Handle starting a new chat session
app.post('/start-session', async (req, res) => {
    const username = req.cookies.username;

    if (!username) {
        console.error('Username not found in cookies.');
        return res.json({ success: false, message: 'Username not found in cookies. Please log in again.' });
    }

    console.log(`Starting a new session for user: ${username}`);

    try {
        const user = await getUser(username);
        if (!user) {
            console.error('User not found in database.');
            return res.json({ success: false, message: 'User not found' });
        }

        // Ensure we get the next session ID to avoid conflicts
        const nextSessionId = await getNextSessionId();
        const sessionId = await createSession(user.id, username, `Session ${Date.now()}`);
        console.log(`Session created with ID: ${sessionId}`);

        // Automatically insert the default scale_level
        await saveScaleLevel(sessionId, username, 1);
        console.log(`Default scale level initialized for session ID: ${sessionId}`);
        res.json({ success: true, session_id: sessionId });
    } catch (err) {
        console.error('Error starting a new session:', err);
        res.json({ success: false, message: 'Could not start new session' });
    }
});

// Start a Turing Mode session: create special session + a blank assistant message to edit
app.post('/start-turing', async (req, res) => {
    const username = req.cookies.username;
    if (!username) {
        return res.json({ success: false, message: 'Username not found in cookies. Please log in again.' });
    }
    try {
        const user = await getUser(username);
        if (!user) return res.json({ success: false, message: 'User not found' });
        const sessionId = await createTuringSession(user.id, username, 'Turing Mode');
        // Create an initial blank assistant message for editing
        const messageId = await saveMessageWithScaleLevel(sessionId, username, 'assistant', '', 0, 1);
        res.json({ success: true, session_id: sessionId, message_id: messageId });
    } catch (err) {
        console.error('Could not start Turing session:', err);
        res.json({ success: false, message: 'Could not start Turing session' });
    }
});


app.post('/save-session', async (req, res) => {
    const { session_id, messages, feedbackData } = req.body;
    const username = req.cookies.username;

    try {
        const sess = await getSessionById(session_id);
        if (!sess || sess.username !== username) return res.json({ success: false, message: 'Not authorized for this session' });

        for (const message of messages) {
            try {
                const existingMessage = await getMessageByContent(session_id, message.content);
                if (!existingMessage) {
                    // Preserve raw HTML/markdown in stored messages per request.
                    // Historical sanitization is applied only when sending history to the ChatGPT API.
                    const cleaned = message.content || '';
                    // preserve optional structured metadata if provided by the client
                    const refs = (message.references && message.references.length) ? message.references : null;
                    const prompts = (message.prompts && message.prompts.length) ? message.prompts : null;
                    const messageId = await saveMessage(session_id, username, message.role, cleaned, message.collapsed || 0, refs, prompts);
                    console.log(`Message saved with ID: ${messageId}`);

                    const feedback = (feedbackData || []).find(fb => fb.messageId === message.id);
                    if (feedback) {
                        try {
                            console.log(`Saving feedback for message ID: ${messageId}`);
                            await saveFeedback(session_id, messageId, username, feedback.feedbackContent, feedback.feedbackPosition);
                            console.log(`Feedback saved for message ID: ${messageId}`);
                        } catch (fErr) {
                            console.error('Error saving feedback:', fErr);
                        }
                    }
                } else {
                    console.log(`Message already exists with content: ${message.content}, skipping save.`);
                }
            } catch (mErr) {
                console.error('Error checking/saving message:', mErr);
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error saving session payload:', err);
        res.json({ success: false, message: 'Error saving session data' });
    }
});

app.delete('/delete-session', async (req, res) => {
    const session_id = req.query.session_id;
    const username = req.cookies.username;
    try {
        const sess = await getSessionById(session_id);
        if (!sess || sess.username !== username) return res.json({ success: false, message: 'Not authorized for this session' });
        await deleteSession(session_id);
        res.json({ success: true, message: 'Session deleted successfully' });
    } catch (err) {
        console.error('Error deleting session:', err);
        res.json({ success: false, message: 'Could not delete session' });
    }
});

app.post('/save-feedback', async (req, res) => {
    const { session_id, feedbackContent, message_id } = req.body;
    const username = req.cookies.username;
    try {
        const sess = await getSessionById(session_id);
        if (!sess || sess.username !== username) return res.json({ success: false, message: 'Not authorized for this session' });
        console.log('[POST /save-feedback] Incoming (simplified):', { session_id, feedbackContent, message_id, username });
        await saveFeedback(session_id, message_id || null, username, feedbackContent, null);
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving feedback:', err);
        res.json({ success: false, message: 'Error saving feedback data' });
    }
});

// Update message content (used by Turing Mode autosave/close)
// Toggle verbose logging for Turing save flow by setting DEBUG_TURING_SAVE=1
function turingSaveDebug(...args) {
    if (process.env.DEBUG_TURING_SAVE === '1') {
        try { console.log('[TURING-SAVE]', ...args); } catch (_) {}
    }
}

app.post('/update-message', async (req, res) => {
    const { message_id, content, session_id, footer_removed } = req.body;
    const username = req.cookies.username;

    if (!message_id && !session_id) {
        return res.json({ success: false, message: 'message_id or session_id required' });
    }

    try {
        let targetMessageId = null;
        let sessRow = null; // session row for authorization and turing detection
        turingSaveDebug('incoming', { message_id, hasSession: !!session_id, contentLen: (content || '').length });

        if (message_id) {
            // validate message_id; if it's not an integer, fall back to session_id if provided
            const parsed = parseInt(message_id, 10);
            if (Number.isNaN(parsed)) {
                if (!session_id) return res.json({ success: false, message: 'message_id must be an integer or session_id must be provided' });
                // fallback to session-based path below
                turingSaveDebug('non-numeric message_id provided; will use session fallback');
            } else {
                targetMessageId = parsed;
                const sess = await getSessionIdForMessage(targetMessageId);
                if (!sess || sess.username !== username) return res.json({ success: false, message: 'Not authorized for this message' });
                sessRow = sess;
                turingSaveDebug('numeric message_id accepted', { targetMessageId, is_turing: !!(sess?.is_turing) });
            }
        }

        // Determine target by session when message_id is missing or not numeric.
        if (!targetMessageId && session_id) {
            const sess = await getSessionById(session_id);
            if (!sess || sess.username !== username) return res.json({ success: false, message: 'Not authorized for this session' });
            sessRow = sess;
            const messages = await getMessages(session_id);
            if (!messages || messages.length === 0) return res.json({ success: false, message: 'No messages found for session' });
            if (sess.is_turing === 1 || sess.is_turing === true) {
                // In Turing Mode always persist edits/metadata to the FIRST assistant message (sticky card)
                const firstAssistant = messages.find(m => m.role === 'assistant');
                if (firstAssistant && (firstAssistant.id || firstAssistant.message_id)) {
                    targetMessageId = firstAssistant.id || firstAssistant.message_id;
                    turingSaveDebug('turing session: targeting FIRST assistant', { targetMessageId });
                }
            }
            // Fallbacks when not Turing or no assistant found yet
            if (!targetMessageId) {
                // Prefer the last assistant if available, else the last message
                const assistants = messages.filter(m => m.role === 'assistant');
                const pick = assistants.length ? assistants[assistants.length - 1] : messages[messages.length - 1];
                targetMessageId = pick.id || pick.message_id;
                turingSaveDebug('fallback target', { targetMessageId, pickedRole: pick.role });
            }
            if (!targetMessageId) return res.json({ success: false, message: 'Could not determine target message for session' });
        }

    // Do not perform global server-side sanitization when saving message edits.
    // We keep the raw content in the DB; sanitization for model input happens
    // at the point where conversation history is prepared for the ChatGPT API.
    const cleanedContent = content ?? '';
    // Accept optional structured metadata (references, prompts) from client
    const refs = Array.isArray(req.body.references) ? req.body.references : null;
    const prompts = Array.isArray(req.body.prompts) ? req.body.prompts : null;
    const isTuring = !!(sessRow && (sessRow.is_turing === 1 || sessRow.is_turing === true));
    turingSaveDebug('updating message', {
        targetMessageId,
        is_turing: isTuring,
        refs_len: Array.isArray(refs) ? refs.length : 0,
        prompts_len: Array.isArray(prompts) ? prompts.length : 0,
        content_len: cleanedContent.length,
        footer_removed: footer_removed === true
    });
    await updateMessageContent(targetMessageId, cleanedContent, refs, prompts, footer_removed === true);
    turingSaveDebug('update complete', { targetMessageId });
        res.json({ success: true });
    } catch (err) {
        console.error('Could not update message:', err);
        res.json({ success: false, message: 'Could not update message' });
    }
});

// Add this new endpoint before the WebSocket server setup

app.post('/update-message-collapsed', async (req, res) => {
    const { message_id, collapsed } = req.body;
    const username = req.cookies.username;
    try {
        const sess = await getSessionIdForMessage(message_id);
        if (!sess || sess.username !== username) return res.json({ success: false, message: 'Not authorized for this message' });
        await updateMessageCollapsedState(message_id, collapsed);
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating message collapsed state:', err);
        res.json({ success: false, message: 'Error updating message collapsed state' });
    }
});

// Add these before the WebSocketServer setup

// Endpoint to create a new group
app.post('/create-group', async (req, res) => {
    const { group_name } = req.body;
    const username = req.cookies.username;
    try {
        const user = await getUser(username);
        if (!user) return res.json({ success: false, message: 'User not found' });
        const groupId = await createGroup(user.id, username, group_name);
        res.json({ success: true, group_id: groupId });
    } catch (err) {
        console.error('Error creating group:', err);
        res.json({ success: false, message: 'Could not create group' });
    }
});

// Endpoint to delete a group
app.delete('/delete-group', async (req, res) => {
    const group_id = req.query.group_id;
    const username = req.cookies.username;
    try {
        const user = await getUser(username);
        if (!user) return res.json({ success: false, message: 'User not found' });
        const groups = await getUserGroups(user.id);
        const owns = groups.some(g => String(g.id) === String(group_id));
        if (!owns) return res.json({ success: false, message: 'Not authorized for this group' });
        await deleteGroup(group_id);
        res.json({ success: true, message: 'Group deleted successfully' });
    } catch (err) {
        console.error('Error deleting group:', err);
        res.json({ success: false, message: 'Could not delete group' });
    }
});

// Endpoint to get all groups for a user
app.get('/groups', async (req, res) => {
    const username = req.cookies.username;
    try {
        const user = await getUser(username);
        if (!user) return res.json({ success: false, message: 'User not found' });
        const groups = await getUserGroups(user.id);
        res.json({ success: true, groups });
    } catch (err) {
        console.error('Error fetching groups:', err);
        res.json({ success: false, message: 'Could not retrieve groups' });
    }
});

// Endpoint to update a session's group
app.post('/update-session-group', async (req, res) => {
    const { session_id, group_id } = req.body;
    const username = req.cookies.username;
    try {
        const sess = await getSessionById(session_id);
        if (!sess || sess.username !== username) return res.json({ success: false, message: 'Not authorized for this session' });
        const user = await getUser(username);
        if (!user) return res.json({ success: false, message: 'User not found' });
        const groups = await getUserGroups(user.id);
        if (group_id !== null && group_id !== undefined && group_id !== '' && !groups.some(g => String(g.id) === String(group_id))) {
            return res.json({ success: false, message: 'Not authorized for this group' });
        }
        await updateSessionGroup(session_id, group_id || null);
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating session group:', err);
        res.json({ success: false, message: 'Could not update session group' });
    }
});
 

// Add this alongside the other group endpoints

// Endpoint to rename a group
// Add checkAuth specifically to this endpoint
app.post('/rename-group', checkAuth, async (req, res) => {
    const { group_id, group_name } = req.body;
    try {
        await renameGroup(group_id, group_name);
        res.json({ success: true });
    } catch (err) {
        console.error('Error renaming group:', err);
        res.json({ success: false, message: 'Could not rename group' });
    }
});


// Serve static assets first so public files (CSS/JS/images) are reachable
app.use(express.static(path.join(path.resolve(), 'public')));

// Then enforce auth for protected routes
app.use(checkAuth);

// Upload image endpoint: accepts a base64 data URL and returns a /uploads URL
app.post('/upload-image', async (req, res) => {
    try {
        const dataUrl = (req.body && req.body.dataUrl) ? String(req.body.dataUrl) : '';
        if (!dataUrl) return res.status(400).json({ success: false, message: 'dataUrl required' });
        // Accept common image data URLs; allow optional charset parameter
        const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+)(;charset=[^;]+)?;base64,(.+)$/);
        if (!m) return res.status(400).json({ success: false, message: 'Invalid image data URL' });
        const mime = m[1].toLowerCase();
        const base64 = m[3];
        const buf = Buffer.from(base64, 'base64');
        // Size guard: 10MB per image
        if (buf.length > 10 * 1024 * 1024) return res.status(413).json({ success: false, message: 'Image too large' });
        const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
        const ext = extMap[mime] || 'bin';
        const uploadsDir = path.join(path.resolve(), 'public', 'uploads');
        await fs.promises.mkdir(uploadsDir, { recursive: true });
        const filename = `${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
        const fullPath = path.join(uploadsDir, filename);
        await fs.promises.writeFile(fullPath, buf);
        // Return a path relative to the site root
        const url = `/uploads/${filename}`;
        return res.json({ success: true, url });
    } catch (err) {
        console.error('Upload image failed:', err);
        return res.status(500).json({ success: false, message: 'Failed to upload image' });
    }
});

// CSRF error handler
app.use((err, req, res, next) => {
    if (err && err.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({ success: false, message: 'Invalid CSRF token' });
    }
    return next(err);
});

// Create HTTP or HTTPS server based on env flags
let server;
if (process.env.HTTPS_ENABLED === 'true') {
    try {
        const keyPath = process.env.SSL_KEY_PATH;
        const certPath = process.env.SSL_CERT_PATH;
        if (!keyPath || !certPath) {
            console.warn('HTTPS_ENABLED is true but SSL_KEY_PATH/SSL_CERT_PATH not set. Falling back to HTTP.');
            server = http.createServer(app);
        } else {
            const credentials = {
                key: fs.readFileSync(keyPath),
                cert: fs.readFileSync(certPath)
            };
            server = https.createServer(credentials, app);
            console.log('HTTPS is enabled');
        }
    } catch (e) {
        console.warn('Failed to initialize HTTPS; falling back to HTTP:', e?.message || e);
        server = http.createServer(app);
    }
} else {
    server = http.createServer(app);
}

// Try to listen on the requested port; if taken, try the next port(s) to be developer-friendly
// Defer WebSocketServer creation until after a successful listen to avoid EADDRINUSE crashes.
let wss; // initialized after server starts listening
function tryListen(p, attemptsLeft = 10) {
    server.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            console.warn(`Port ${p} is in use. Attempting port ${p + 1}...`);
            if (attemptsLeft <= 0) {
                console.error('No available ports found after multiple attempts. Exiting.');
                process.exit(1);
            }
            // Small delay before retrying
            setTimeout(() => tryListen(p + 1, attemptsLeft - 1), 200);
        } else {
            console.error('Server failed to start:', err);
            process.exit(1);
        }
    });

    server.listen(p, () => {
        // Remove the temporary error handler set for this listen attempt
        server.removeAllListeners('error');
        const proto = (process.env.HTTPS_ENABLED === 'true') ? 'https' : 'http';
        console.log(`Server running at ${proto}://localhost:${p}`);

        // Initialize WebSocket server only after HTTP/S server is successfully listening
        if (!wss) {
            wss = new WebSocketServer({ server });
        }
    });
}

tryListen(port, 50);

class ChatGPTProcessor {
    constructor(openai, ws, session_id, conversationHistory, username) {
        this.openai = openai;
        this.ws = ws;
        this.session_id = session_id;
        this.conversationHistory = conversationHistory || [];
        this.username = username;
    }

    // Sanitize content before sending to the model: remove data: URIs, strip HTML/JSX tags,
    // remove Markdown image/link syntaxes that embed data, collapse whitespace and truncate.
    sanitizeContent(raw, maxLen = 4000) {
        if (!raw) return '';
        let s = String(raw);
        // Remove data: URIs (images/audio/etc.) which are very large and unnecessary for context
        s = s.replace(/data:[^\s"'>]+;base64,[A-Za-z0-9+/=]+/g, ' [removed embedded data] ');
        // Remove common Markdown image syntax with embedded data URIs: ![alt](data:...)
        s = s.replace(/!\[[^\]]*\]\([^\)]*data:[^\)]+\)/g, ' [removed image] ');
        // Strip HTML tags but keep their inner text
        s = s.replace(/<\/?[^>]+>/g, ' ');
        // Remove any remaining HTML entities that look suspicious (optional)
        s = s.replace(/&nbsp;|&lt;|&gt;|&amp;|&quot;|&#\d+;/g, ' ');
        // Collapse whitespace
        s = s.replace(/\s+/g, ' ').trim();
        // Truncate to maxLen characters to avoid sending huge messages
        if (s.length > maxLen) {
            s = s.slice(0, maxLen) + ' [truncated]';
        }
        return s;
    }

    async processUserMessage(userMessage) {
        try {
            // Step 1: Process the user message with style guidelines + current conversation
            const styleSystemPrompt = `You are a professional assistant that MUST return only well-formed HTML fragments (no Markdown, no surrounding <html>/<body> tags).

RENDERING RULES (strict):
- Return valid HTML only. Use semantic tags (h1,h2,h3,p,ul,li,strong,em,br) where appropriate.
- Do NOT include the literal word "Title:" or any leading label before the title. Output the title as an <h1> element (for example: <h1>Albert Einstein: ...</h1>).
- Do NOT include Markdown markers (###, **, __, _), nor plain-text label lines like "Body" or "Introduction"; instead use appropriate heading tags and paragraphs.
- Use inline Unicode emojis if helpful (⚡, 🧠, 💡).
- Avoid inline <style> tags, scripts, or event attributes. Keep markup simple and semantic.
- Do not emit horizontal rules of repeated hyphens ("---"); use <hr/> if a separator is needed.

Return only the HTML fragment for the requested response — nothing else (no commentary, no surrounding text).`;

            const userContent = (userMessage && typeof userMessage === 'object') ? (userMessage.content || '') : String(userMessage || '');

            // Prevent very large embedded blobs (base64 images, HTML) from being sent to the model.
            const MAX_MESSAGE_CHARS = 4000; // per-message cap
            const MAX_HISTORY_CHARS = 15000; // total chars of included history (approx)

            const cleanUserContent = this.sanitizeContent(userContent, MAX_MESSAGE_CHARS);

            // Build a trimmed, sanitized conversation history (keep most recent messages until MAX_HISTORY_CHARS)
            const sanitizedHistory = [];
            let acc = 0;
            for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
                const m = this.conversationHistory[i];
                if (!m || !m.content) continue;
                // Apply server-side sanitization only when preparing historic
                // messages to be sent to the ChatGPT API. This keeps the DB
                // stored content raw while ensuring model inputs don't contain
                // dangerous or very large embedded data.
                const raw = m.content || '';
                const preclean = serverSanitizeHtml(raw);
                const cleaned = this.sanitizeContent(preclean, MAX_MESSAGE_CHARS);
                const len = cleaned.length;
                if (acc + len > MAX_HISTORY_CHARS) break;
                sanitizedHistory.unshift({ role: m.role || 'user', content: cleaned });
                acc += len;
            }

            const stream = await this.openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    { role: 'system', content: styleSystemPrompt },
                    // retain previous sanitized conversation context (most recent first)
                    ...sanitizedHistory,
                    // add the user's latest cleaned message into the streaming request
                    { role: 'user', content: cleanUserContent }
                ],
                stream: true,
            });

            let botMessageContent = '';
            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta?.content || '';
                botMessageContent += delta;
                // Heuristic: if the delta contains HTML tags, mark this chunk as HTML
                // so the client can render it as sanitized HTML instead of escaping it.
                const looksLikeHtml = /<\s*\w+[^>]*>/i.test(delta);
                const format = looksLikeHtml ? 'html' : 'markdown';
                // Include a hint about the content format so the client can render markdown/HTML appropriately
                this.ws.send(JSON.stringify({ type: 'assistant', content: delta, format }));
            }

            // Step 2: Assess using the latest user content to ensure accuracy
            const scaleLevels = await this.assessScaleLevel(this.conversationHistory, userMessage && userMessage.content ? String(userMessage.content) : null);
            this.ws.send(JSON.stringify({ type: 'scale', data: scaleLevels }));

            // Step 3: Add the assistant's message to the conversation history
            this.conversationHistory.push({ role: "assistant", content: botMessageContent });

            const scaleLevel = scaleLevels[0] || 1;
            const shouldCollapse = scaleLevel >= 3 ? 1 : 0;

            // Save the assistant message first to get its message_id, then (optionally) generate/send feedback with that id
            try {
                // Prefer updating an existing empty assistant row (created when Turing session started)
                // to avoid inserting a duplicate assistant message. If none exists, insert normally.
                const empty = await getEmptyAssistantMessage(this.session_id);
                let messageId;
                    if (empty && empty.id) {
                    messageId = empty.id;
                    // Convert assistant content to HTML (if needed) before saving so
                    // the client sees rendered HTML rather than raw markdown artifacts.
                    const htmlToSave = serverRenderMarkdownToHtml(botMessageContent);
                    await updateMessageContent(messageId, htmlToSave);
                    // Ensure scale level row exists for this session/message
                    try { await saveScaleLevel(this.session_id, this.username, scaleLevel); } catch (slErr) { /* non-fatal */ }
                    console.log(`Updated existing empty assistant message id=${messageId} for session ${this.session_id}`);
                } else {
                    const htmlToSave = serverRenderMarkdownToHtml(botMessageContent);
                    messageId = await saveMessageWithScaleLevel(this.session_id, this.username, 'assistant', htmlToSave, shouldCollapse, scaleLevel);
                    console.log(`Assistant message saved to session ID: ${this.session_id} with collapsed state: ${shouldCollapse} and scale_level: ${scaleLevel}; message_id=${messageId}`);
                }

                // Step 4: Generate feedback if scale level is 3 or above AND session is not Turing Mode
                // This preserves Decipher-only behavior for Turing edit mode while keeping
                // automatic feedback for standard chat sessions.
                try {
                    const sessRow = await getSessionById(this.session_id);
                    const isTuringSession = !!(sessRow && (sessRow.is_turing === 1 || sessRow.is_turing === true));
                    if (!isTuringSession && scaleLevels.length) {
                        const topLevel = Math.max(...scaleLevels);
                        if (topLevel >= 3) {
                            // For Level 3 and above, provide a short alternative prompt to reduce AI reliance
                            const alt = await this.generateAlternativePrompt(userMessage.content);
                            if (alt) {
                                this.ws.send(JSON.stringify({ type: 'feedback', content: alt, message_id: messageId, format: 'markdown' }));
                            }
                        }
                    }
                } catch (e) {
                    // If we fail to resolve session type, do not block the message flow
                    console.warn('Feedback generation skipped due to session lookup error:', e?.message || e);
                }
                // Notify client of the saved message id so the UI can reconcile streaming placeholders
                try { this.ws.send(JSON.stringify({ type: 'message-saved', message_id: messageId })); } catch (notifyErr) { /* ignore */ }
            } catch (saveErr) {
                console.error('Error saving bot message:', saveErr);
            }
        } catch (error) {
            console.error('Error during OpenAI API call or streaming:', error);
        }
    }

    async addUserMessage(userMessage) {
            if (userMessage.content) {
            this.conversationHistory.push({ role: "user", content: userMessage.content });
            try {
                // Store raw user content; model-safe cleanup will be applied when building history
                const id = await saveMessageWithScaleLevel(this.session_id, this.username, 'user', userMessage.content, 0, 1);
                console.log(`User message saved to session ID: ${this.session_id} id=${id}`);
            } catch (err) {
                console.error('Error saving user message:', err);
            }
        } else {
            console.warn("Received an empty or null message content, skipping processing.");
        }
    }

    async assessScaleLevel(conversationHistory, latestUserContent = null) {
    try {
        const scaleLevels = []; // Example of multiple levels [1, 2, 3]

        // Prefer the provided latest user content; otherwise find the most recent 'user' message
        let userMessageContent = latestUserContent || "";
        if (!userMessageContent) {
            const recentUserMessage = [...conversationHistory].reverse().find(message => message.role === "user");
            userMessageContent = recentUserMessage ? recentUserMessage.content : "";
        }
        console.log('[Assessment] Using content:', (userMessageContent || '').slice(0, 200));

        // Make the API call to OpenAI
        const MAX_MESSAGE_CHARS = 2000;
        const cleanedUserMessage = this.sanitizeContent(userMessageContent, MAX_MESSAGE_CHARS);

        // Heuristic: classify clear generative requests as Level 5 immediately
        // Examples: "create/write/generate an essay/paragraph", "compose a report"
        try {
            // Expanded heuristic: allow intervening words (e.g., "make me a 2 paragraph essay")
            // Match verb, then up to ~60 chars before the content type keyword
            const gen5Pattern = /(create|write|generate|compose|draft|produce|make|build)[^\n]{0,60}\b(essay|paragraph|report|article|poem|story|code|program|script|presentation|slide\s*deck|slides)\b/i;
            if (gen5Pattern.test(cleanedUserMessage)) {
                scaleLevels.push(5);
                try { await saveScaleLevel(this.session_id, this.username, 5); } catch (_) {}
                return scaleLevels;
            }
        } catch (_) {}
        const assessmentResponse = await this.openai.chat.completions.create({
            model: "gpt-4o", // Changed model to gpt-4o
            messages: [
                {
                    role: 'system',
                    content: `Assess the User input according to the following scale: \n
1. No AI: This represents tasks or processes that are done entirely by humans without any AI involvement.\n
2. Ideas and Structure: This level indicates that AI is used to generate ideas or structure content, but the primary content creation is still human-driven.\n
3. AI Editing: At this stage, AI is used to assist with editing or refining content that has been primarily generated by a human.\n
4. AI + Human Evaluation: Here, both AI and humans are involved in creating and evaluating the content. This stage likely involves a collaborative effort where AI generates content or makes suggestions, and humans refine or approve it. This does not include examples where AI generates most of the content.\n
5. Full AI: AI is almost fully responsible for the task or process with little to no human intervention. For example: create me a essay about ... or create me a paragraph about... \n
Please return only the number and category (e.g., '5. Full AI') that the user's messages correspond to.`
                },
                { role: 'user', content: cleanedUserMessage }
            ]
        });

        // Extract the response from the API
        const assessmentResult = assessmentResponse.choices[0].message.content.trim();
        console.log(`Assessment result: ${assessmentResult}`);

        // Extract the number from the result and push to scaleLevels
        // Be robust to model phrasing like "4. AI ...", "Level 4 - AI ...", or "AI Editing (3)"
        let scaleLevel = NaN;
        try {
            // Prefer the first standalone digit 1-5 anywhere in the string
            const digitMatch = assessmentResult.match(/\b([1-5])\b/);
            if (digitMatch) {
                scaleLevel = parseInt(digitMatch[1], 10);
            } else {
                // Fallback: infer from known labels if a digit wasn't returned
                const lower = assessmentResult.toLowerCase();
                if (lower.includes('full ai')) scaleLevel = 5;
                else if (lower.includes('ai + human') || lower.includes('ai and human')) scaleLevel = 4;
                else if (lower.includes('editing')) scaleLevel = 3;
                else if (lower.includes('ideas') || lower.includes('structure')) scaleLevel = 2;
                else if (lower.includes('no ai')) scaleLevel = 1;
                // Additional fallback: if original user text looked generative, treat as 5
                if (isNaN(scaleLevel)) {
                    const gen5Pattern2 = /(create|write|generate|compose|draft|produce|make|build)[^\n]{0,60}\b(essay|paragraph|report|article|poem|story|code|program|script|presentation|slide\s*deck|slides)\b/i;
                    if (gen5Pattern2.test((cleanedUserMessage || ''))) {
                        scaleLevel = 5;
                    }
                }
            }
        } catch (_) {
            // keep NaN and fall through to invalid handler
        }
        if (!isNaN(scaleLevel)) {
            scaleLevels.push(scaleLevel);

            // Save each scale level to the database
            try {
                await saveScaleLevel(this.session_id, this.username, scaleLevel);
            } catch (err) {
                console.error('Error saving scale level:', err);
            }
        } else {
            console.error('Invalid assessment result:', assessmentResult);
        }

        return scaleLevels; // Return array of levels
    } catch (error) {
        console.error('Error during OpenAI API assessment:', error);
        return [1]; // Default to No AI if there's an error
    }
}


    // Generate a supportive alternative prompt to reduce AI reliance (used for Level 5)
    async generateAlternativePrompt(userMessage) {
        try {
            const supportivePrompt = `As a supportive chatbot, suggest an alternative prompt based on the user's input that avoid meeting one of the following criteria: AI + Human Evaluation (AI generates content and humans refine/approve) or Full AI Responsibility (AI fully responsible with minimal human input). Create a maximum 50-word response prompt example aligned with either:\n• Ideas and Structure: AI generates ideas or structure while humans create the content, or\n• Research: AI is used as a research tool to find credible resources on a topic.\nWord this as a direct request (not a question). For example: 'Please generate ideas for an essay about (insert topic here)'.`;

            const MAX_MESSAGE_CHARS = 4000;
            const cleanedUser = this.sanitizeContent(userMessage, MAX_MESSAGE_CHARS);
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    { role: 'system', content: supportivePrompt },
                    { role: 'user', content: cleanedUser }
                ]
            });

            const result = response.choices[0].message.content.trim();
            console.log("Generated Alternative Prompt:", result);
            return result;
        } catch (error) {
            console.error('Error generating alternative prompt:', error);
            return '';
        }
    }

    async generateFeedback(userMessage) {
        try {
            const feedbackSystemPrompt = `You are an academic assessor. Evaluate the provided editable content (up to the References section) against the following rubric and guidance. Return:
1) A concise criteria summary with headings P1, P2, M2, D1, each with Pass/Merit/Distinction alignment and 1–2 actionable improvements.
2) A short overall note (max 60 words) encouraging next steps.

Rubric (abbreviated):
P1: Use research to identify a range of potential diseases that the patients might have. At least four possible diseases per patient. (PO4)
M1: Assess two suspected diseases for each patient in terms of potential likelihood given the symptoms; include a hypothesis backed by facts. (PO3)
P2: Create a detailed method including equipment (sizes/quantities/PPE), tests and techniques to investigate samples, informed by P1. (PO4)
M2: Explain the rationale for chosen tests/techniques based on suspected diseases (extends P2/M1). (PO2)
D1: Justify the choice/settings of appropriate equipment for chosen tests/techniques (extends M2). (PO3)
P3: Complete an appropriate risk assessment using the provided template, considering risks/hazards for each test/technique. (PO4)

Guidance:
P1: Students explain independent research process, sources, and rationale; minimum four diseases per patient.
P2: Step-by-step method; list equipment with sizes/quantities/PPE; align tests/techniques to suspected diseases and available kit.
P3: Thorough risk assessment per test/technique.
M1: Reasoned judgement for two diseases per patient; likelihood based on symptoms; include hypotheses supported by research.
M2: Further analysis building on P2/M1.
D1: Justify equipment choice/settings as part of the rationale.

Output format (markdown allowed):
P1: Status – brief improvement
P2: Status – brief improvement
M2: Status – brief improvement
D1: Status – brief improvement
Overall: …`;

            const MAX_MESSAGE_CHARS = 15000;
            const cleanedUser = this.sanitizeContent(userMessage, MAX_MESSAGE_CHARS);
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    { role: 'system', content: feedbackSystemPrompt },
                    { role: 'user', content: cleanedUser }
                ]
            });

            const result = response.choices[0].message.content.trim(); // Get the result from the API
            console.log("Generated Feedback:", result); // Add this line for debugging

            // Return the result as feedback, so it dynamically adjusts to the user's message context
            return result;

        } catch (error) {
            console.error('Error generating feedback:', error);
            return '';
        }
    }
}

// Ensure WebSocketServer exists even if server binding was retried
if (!wss) {
    try {
        wss = new WebSocketServer({ server });
    } catch (_) {}
}

wss && wss.on('connection', async (ws, req) => {
    let session_id = null;
    let conversationHistory = [];

    const cookies = req.headers.cookie || '';
    const username = (cookies.split(';').find(c => c.trim().startsWith('username=')) || '').split('=')[1];

    if (!username) {
        console.error('Username not found in cookies. Cannot proceed with session.');
        ws.close();
        return;
    }

    // Resolve user for this WS connection so we can set DB context for each message
    let wsUser = null;
    try {
        wsUser = await getUser(username);
        if (!wsUser) {
            console.error('WebSocket connection: user not found for username:', username);
            ws.close();
            return;
        }
    } catch (err) {
        console.error('Error fetching user for WebSocket connection:', err);
        ws.close();
        return;
    }

    ws.on('message', async (message) => {
        // Ensure AsyncLocalStorage contains current user id for DB RLS checks
        try {
            setCurrentUserId(wsUser.id);
        } catch (e) {
            console.error('Could not set DB context for WebSocket message:', e);
        }
        let userMessage;
        try {
            userMessage = JSON.parse(message);
        } catch (parseErr) {
            console.error('Invalid JSON in WS message:', parseErr);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
            return;
        }

        if (userMessage.action === "generateFeedback") {
            // Generate feedback without saving the user message again
            const processor = new ChatGPTProcessor(openai, ws, session_id, conversationHistory);
            const feedback = await processor.generateFeedback(userMessage.content);
            if (feedback) {
                ws.send(JSON.stringify({ type: 'feedback', content: feedback }));
            }
        } else {
            // Ensure session ID and message processing logic
            if (userMessage.session_id) {
                session_id = userMessage.session_id;
                conversationHistory = await loadSessionHistory(session_id);
                    if (userMessage.content) {
                    const processor = new ChatGPTProcessor(openai, ws, session_id, conversationHistory, username);
                    await processor.addUserMessage(userMessage);
                    await processor.processUserMessage(userMessage);
                } else {
                    // Send a richer history payload including DB-backed messages, feedback and scale levels
                        const [messages, feedbackData, scaleRows] = await Promise.all([
                        getMessages(session_id),
                        getFeedback(session_id),
                        getScaleLevels(session_id)
                    ]);
                    const scaleLevels = [...new Set(scaleRows.map(r => r.scale_level))];
                    ws.send(JSON.stringify({
                        type: 'history',
                        data: {
                            messages: messages.map(m => ({ ...m, message_id: m.id ?? m.message_id, scale_level: m.scale_level || 1, collapsed: m.collapsed || 0 })),
                            feedbackData,
                            scale_levels: scaleLevels
                        }
                    }));
                }
            } else {
                // Handle cases when there's no session_id provided (new session)
                if (!session_id) {
                    session_id = await getNextSessionId();
                    // We only have the username from the WebSocket cookie here —
                    // look up the user's numeric id before creating the session.
                    try {
                        const user = await getUser(username);
                        if (!user) {
                            console.error('Could not find user for username when creating session over WS:', username);
                            ws.send(JSON.stringify({ type: 'error', message: 'User not found' }));
                            return;
                        }
                        const newSessionId = await createSession(user.id, username, `Session ${session_id}`);
                        session_id = newSessionId;
                        const processor = new ChatGPTProcessor(openai, ws, session_id, conversationHistory, username);
                        processor.addUserMessage(userMessage);
                        await processor.processUserMessage(userMessage);
                    } catch (err) {
                        console.error('Error creating session over WS:', err);
                        ws.send(JSON.stringify({ type: 'error', message: 'Could not create session' }));
                        return;
                    }
                } else {
                    const processor = new ChatGPTProcessor(openai, ws, session_id, conversationHistory, username);
                    processor.addUserMessage(userMessage);
                    await processor.processUserMessage(userMessage);
                }
            }
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});


console.log('WebSocket server attached to the same HTTP/HTTPS server');

async function loadSessionHistory(session_id) {
    try {
        console.log('Loading session history for session_id:', session_id);
        const messages = await getMessages(session_id);
        console.log('Messages retrieved:', messages);
        return messages;
    } catch (err) {
        console.error('Error loading session history:', err);
        throw err;
    }
}

// Helper to get session ownership from a message id
async function getSessionIdForMessage(message_id) {
    if (message_id === undefined || message_id === null) {
        throw new Error('message_id is required');
    }
    const id = parseInt(message_id, 10);
    if (Number.isNaN(id)) {
        throw new Error('message_id must be an integer');
    }
    return await getSessionByMessageId(id);
}

// Server-side HTML sanitizer to remove dangerous tags/attributes before saving to DB
function serverSanitizeHtml(raw) {
    if (!raw) return '';
    let s = String(raw);
    // Remove script/style/iframe/object/embed/form/input/button/svg tags and their contents
    s = s.replace(/<\s*(script|style|iframe|object|embed|form|input|button|svg)[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ');
    // Remove any standalone dangerous tags
    s = s.replace(/<\s*(script|style|iframe|object|embed|form|input|button|svg)[^>]*\/?\s*>/gi, ' ');
    // Remove inline event handlers like onclick="..."
    s = s.replace(/\s*on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    // Remove style attributes
    s = s.replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    // Remove javascript:, data:, vbscript: in href/src attributes
    s = s.replace(/\s(href|src)\s*=\s*(?:"|')?\s*(?:javascript:|data:|vbscript:)[^"'\s>]*(?:"|')?/gi, '');
    // Collapse whitespace
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

// Server-side lightweight Markdown -> HTML renderer used to normalize assistant
// content before persisting. It preserves HTML when the content already
// appears to contain HTML tags; otherwise it escapes HTML and converts common
// markdown patterns (headings, bold, italic, links, line breaks) to HTML.
function serverRenderMarkdownToHtml(raw) {
    if (!raw) return '';
    const s = String(raw);
    const looksLikeHtml = /<\s*\w+[^>]*>/i.test(s);
    if (looksLikeHtml) {
        // If content already contains HTML tags, trust it as HTML but
        // perform a light sanitization pass to remove dangerous attributes.
        return serverSanitizeHtml(s);
    }

    // Escape HTML entities first to avoid accidental tag injection
    const escape = (u) => String(u)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const lines = s.split(/\r?\n/);
    const out = [];
    let paragraphBuffer = [];

    function flushParagraph() {
        if (paragraphBuffer.length === 0) return;
        const joined = paragraphBuffer.join('<br>');
        out.push(`<p>${processInline(joined)}</p>`);
        paragraphBuffer = [];
    }

    function processInline(t) {
        let w = escape(t);
        // Restore intentional escaped <br> tokens if present
        w = w.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
        // Bold **text** or __text__
        w = w.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
        w = w.replace(/__([\s\S]+?)__/g, '<strong>$1</strong>');
        // Italic *text* or _text_
        w = w.replace(/(^|\s)\*([^*]+?)\*(\s|$)/g, '$1<em>$2</em>$3');
        w = w.replace(/(^|\s)_([^_]+?)_(\s|$)/g, '$1<em>$2</em>$3');
        // Headings will be handled separately
        // Autolink
        w = w.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
        return w;
    }

    for (let rawLine of lines) {
        const line = rawLine.trim();
        if (line === '') {
            flushParagraph();
            continue;
        }
        const m = line.match(/^(#{1,6})\s+(.*)$/);
        if (m) {
            // heading
            flushParagraph();
            const level = Math.min(6, m[1].length);
            out.push(`<h${level}>${processInline(m[2])}</h${level}>`);
            continue;
        }
        // accumulate paragraphs; keep original spacing for internal <br>
        paragraphBuffer.push(rawLine);
    }
    flushParagraph();
    return out.join('\n');
}
