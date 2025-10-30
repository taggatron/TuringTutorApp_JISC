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
import { registerUser, getUser, updateUserPassword, createSession, createTuringSession, saveMessage, getSessions, getMessages, deleteSession, getNextSessionId, saveFeedback, getFeedback, getMessageByContent, saveScaleLevel, getScaleLevels, updateMessageCollapsedState, createGroup, deleteGroup, getUserGroups, updateSessionGroup, renameGroup, renameSession, updateMessageContent, getSessionById, getSessionByMessageId, saveMessageWithScaleLevel } from './server/db/postgres.js';
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
const cspIndex = helmet.contentSecurityPolicy({
    useDefaults: true,
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
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

        const scaleLevels = [...new Set(scaleRows.map(row => row.scale_level))];

        res.json({
            success: true,
            is_turing: sess?.is_turing === 1 || sess?.is_turing === true ? 1 : 0,
            messages: messages.map(m => ({
                ...m,
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
                    const messageId = await saveMessage(session_id, username, message.role, message.content, message.collapsed || 0);
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
app.post('/update-message', async (req, res) => {
    const { message_id, content } = req.body;
    if (!message_id) return res.json({ success: false, message: 'message_id required' });
    const username = req.cookies.username;
    try {
        const sess = await getSessionIdForMessage(message_id);
        if (!sess || sess.username !== username) return res.json({ success: false, message: 'Not authorized for this message' });
        await updateMessageContent(message_id, content ?? '');
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
    });
}

tryListen(port, 50);

const wss = new WebSocketServer({ server });

class ChatGPTProcessor {
    constructor(openai, ws, session_id, conversationHistory, username) {
        this.openai = openai;
        this.ws = ws;
        this.session_id = session_id;
        this.conversationHistory = conversationHistory || [];
        this.username = username;
    }

    async processUserMessage(userMessage) {
        try {
            // Step 1: Process the user message as usual
            const stream = await this.openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    { role: 'system', content: 'You are a highly professional assessor...' },
                    ...this.conversationHistory.filter(msg => msg.content)
                ],
                stream: true,
            });

            let botMessageContent = '';
            for await (const chunk of stream) {
                botMessageContent += chunk.choices[0]?.delta?.content || '';
                this.ws.send(JSON.stringify({ type: 'assistant', content: chunk.choices[0]?.delta?.content || '' }));
            }

            // Step 2: Assess the conversation history to determine the scale level
            const scaleLevels = await this.assessScaleLevel(this.conversationHistory);
            this.ws.send(JSON.stringify({ type: 'scale', data: scaleLevels }));

            // Step 3: Add the assistant's message to the conversation history
            this.conversationHistory.push({ role: "assistant", content: botMessageContent });

            const scaleLevel = scaleLevels[0] || 1;
            const shouldCollapse = scaleLevel >= 3 ? 1 : 0;

            // Save the assistant message first to get its message_id, then (optionally) generate/send feedback with that id
            try {
                const messageId = await saveMessageWithScaleLevel(this.session_id, this.username, 'assistant', botMessageContent, shouldCollapse, scaleLevel);
                console.log(`Assistant message saved to session ID: ${this.session_id} with collapsed state: ${shouldCollapse} and scale_level: ${scaleLevel}; message_id=${messageId}`);

                // Step 4: Generate feedback if scale level is 3 or above, now including message_id
                if (scaleLevels.some(level => level >= 3)) {
                    const feedback = await this.generateFeedback(userMessage.content);
                    if (feedback) {
                        this.ws.send(JSON.stringify({ type: 'feedback', content: feedback, message_id: messageId }));
                    }
                }
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
                const id = await saveMessageWithScaleLevel(this.session_id, this.username, 'user', userMessage.content, 0, 1);
                console.log(`User message saved to session ID: ${this.session_id} id=${id}`);
            } catch (err) {
                console.error('Error saving user message:', err);
            }
        } else {
            console.warn("Received an empty or null message content, skipping processing.");
        }
    }

    async assessScaleLevel(conversationHistory) {
    try {
        const scaleLevels = []; // Example of multiple levels [1, 2, 3]

        // Find the most recent user message
        const recentUserMessage = [...conversationHistory].reverse().find(message => message.role === "user");
        const userMessageContent = recentUserMessage ? recentUserMessage.content : "";

        // Make the API call to OpenAI
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
                { role: 'user', content: userMessageContent }
            ]
        });

        // Extract the response from the API
        const assessmentResult = assessmentResponse.choices[0].message.content.trim();
        console.log(`Assessment result: ${assessmentResult}`);

        // Extract the number from the result and push to scaleLevels
        const scaleLevel = parseInt(assessmentResult[0], 10); // Extract the first number from the result
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


    async generateFeedback(userMessage) {
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    {
                        role: 'system',
                        content: "As a supportive chatbot, suggest an alternative prompt based on the user's input that avoid meeting the one of the following criteria: AI + Human Evaluation: Where AI generates content or suggestions, and humans refine or approve it. Full AI Responsibility: Where AI is fully responsible for the task with minimal or no human intervention. Create your your 50 word maximum response prompt example to align with either: Ideas and Structure: AI is used to generate ideas or structure content, but the primary creation remains human-driven; or Research: AI is utilized as a research tool to find credible resources on a given topic. Word this as a direct request and not a question. For example: 'Please generate ideas for an essay about (insert topic here)'."
                    },
                    {
                        role: 'user',
                        content: userMessage
                    }
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

wss.on('connection', async (ws, req) => {
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
                            messages: messages.map(m => ({ ...m, scale_level: m.scale_level || 1, collapsed: m.collapsed || 0 })),
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
