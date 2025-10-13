import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { registerUser, getUser, createSession, saveMessage, getSessions, getMessages, deleteSession, getNextSessionId, saveFeedback, getFeedback, getMessageByContent, saveScaleLevel, getScaleLevels, updateMessageCollapsedState, createGroup, deleteGroup,getUserGroups,updateSessionGroup, renameGroup, saveMessageWithScaleLevel } from './database.js';

dotenv.config({ path: './APIkey.env' });

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const app = express();
const port = 3000;

app.use(express.json());
app.use(cookieParser());

function checkAuth(req, res, next) {
    if (req.cookies.logged_in) {
        next();
    } else {
        if (req.path === '/' || req.path === '/login.html' || req.path === '/register.html') {
            next();
        } else {
            res.redirect('/');
        }
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(path.resolve(), 'public', 'home.html'));
});

app.use('/login.html', express.static(path.join(path.resolve(), 'public/login.html')));
app.use('/register.html', express.static(path.join(path.resolve(), 'public/register.html')));

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    registerUser(username, password, (err) => {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.json({ success: false, message: 'Username already exists' });
            } else {
                return res.json({ success: false, message: 'Registration failed' });
            }
        }
        res.json({ success: true });
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    getUser(username, (err, user) => {
        if (err || !user || user.password !== password) {
            return res.json({ success: false, message: 'Invalid credentials' });
        }
        res.cookie('logged_in', true, { httpOnly: true });
        res.cookie('username', username, { httpOnly: true });
        res.json({ success: true });
    });
});

app.get('/sessions', (req, res) => {
    const username = req.cookies.username;
    getUser(username, (err, user) => {
        if (err || !user) {
            return res.json({ success: false, message: 'User not found' });
        }
        getSessions(user.id, (err, sessions) => {
            if (err) {
                return res.json({ success: false, message: 'Could not retrieve sessions' });
            }
            res.json({ success: true, sessions });
        });
    });
});

app.get('/messages', (req, res) => {
    const session_id = req.query.session_id;

    getMessages(session_id, (err, messages) => {
        if (err) {
            console.error('Error fetching messages:', err);
            return res.json({ success: false, message: 'Error fetching messages' });
        }

        getFeedback(session_id, (err, feedbackData) => {
            if (err) {
                console.error('Error fetching feedback:', err);
                return res.json({ success: false, message: 'Error fetching feedback' });
            }

            // Fetch all scale levels for this session using getScaleLevels
            getScaleLevels(session_id, (err, rows) => {
                if (err) {
                    console.error('Error fetching scale levels:', err);
                    return res.json({ success: false, message: 'Error fetching scale levels' });
                }

                // Aggregate unique scale levels
                const scaleLevels = [...new Set(rows.map(row => row.scale_level))];

                // Return messages with their own scale_level and collapsed state
                res.json({
                    success: true,
                    messages: messages.map(m => ({
                        ...m,
                        scale_level: m.scale_level || 1,
                        collapsed: m.collapsed || 0
                    })),
                    feedbackData,
                    scale_levels: scaleLevels,
                });
            });
        });
    });
});



// Handle starting a new chat session
app.post('/start-session', (req, res) => {
    const username = req.cookies.username;

    if (!username) {
        console.error('Username not found in cookies.');
        return res.json({ success: false, message: 'Username not found in cookies. Please log in again.' });
    }

    console.log(`Starting a new session for user: ${username}`);

    getUser(username, async (err, user) => {
        if (err) {
            console.error('Error fetching user:', err);
            return res.json({ success: false, message: 'Error fetching user data' });
        }

        if (!user) {
            console.error('User not found in database.');
            return res.json({ success: false, message: 'User not found' });
        }

        try {
            // Ensure we get the next session ID to avoid conflicts
            const nextSessionId = await getNextSessionId();
            createSession(user.id, username, `Session ${Date.now()}`, (err, sessionId) => {
                if (err) {
                    console.error('Error creating session:', err);
                    return res.json({ success: false, message: 'Could not start new session' });
                }

                console.log(`Session created with ID: ${sessionId}`);

                // Automatically insert the default scale_level
                saveScaleLevel(sessionId, username, 1, (scaleErr) => {
                    if (scaleErr) {
                        console.error('Error initializing scale level:', scaleErr);
                        return res.json({ success: false, message: 'Error initializing scale level' });
                    }

                    console.log(`Default scale level initialized for session ID: ${sessionId}`);
                    res.json({ success: true, session_id: sessionId });
                });
            });
        } catch (error) {
            console.error('Error fetching next session ID:', error);
            res.json({ success: false, message: 'Error starting a new session' });
        }
    });
});


app.post('/save-session', (req, res) => {
    const { session_id, messages, feedbackData } = req.body;
    const username = req.cookies.username;

    messages.forEach((message, index) => {
        // First check if the message with the same content already exists in the database
        getMessageByContent(session_id, message.content, (err, existingMessage) => {
            if (err) {
                console.error('Error checking if message exists:', err);
                return res.json({ success: false, message: 'Error checking for existing messages' });
            }

            if (!existingMessage) {
                // If message doesn't exist, proceed to save it
                saveMessage(session_id, username, message.role, message.content, message.collapsed || 0, (err, messageId) => {
                    if (err) {
                        console.error('Error saving message:', err);
                        return res.json({ success: false, message: 'Error saving session data' });
                    }

                    console.log(`Message saved with ID: ${messageId}`);

                    // Save associated feedback, if any
                    const feedback = feedbackData.find(fb => fb.messageId === message.id);

                    if (feedback) {
                        console.log(`Saving feedback for message ID: ${messageId}`);
                        saveFeedback(session_id, messageId, username, feedback.feedbackContent, feedback.feedbackPosition, (err) => {
                            if (err) {
                                console.error('Error saving feedback:', err);
                                return res.json({ success: false, message: 'Error saving feedback data' });
                            }
                            console.log(`Feedback saved for message ID: ${messageId}`);
                        });
                    }
                });
            } else {
                console.log(`Message already exists with content: ${message.content}, skipping save.`);
            }
        });
    });

    res.json({ success: true });
});

app.delete('/delete-session', (req, res) => {
    const session_id = req.query.session_id;
    deleteSession(session_id, (err) => {
        if (err) {
            console.error('Error deleting session:', err);
            return res.json({ success: false, message: 'Could not delete session' });
        }
        res.json({ success: true, message: 'Session deleted successfully' });
    });
});

app.post('/save-feedback', (req, res) => {
    const { session_id, feedbackContent, message_id } = req.body;
    const username = req.cookies.username;

    console.log('[POST /save-feedback] Incoming (simplified):', {
        session_id,
        feedbackContent,
        message_id,
        username
    });

    // Store feedback linked to latest message if message_id not provided
    saveFeedback(session_id, message_id || null, username, feedbackContent, null, (err) => {
        if (err) {
            console.error('Error saving feedback:', err);
            return res.json({ success: false, message: 'Error saving feedback data' });
        }
        res.json({ success: true });
    });
});

// Add this new endpoint before the WebSocket server setup

app.post('/update-message-collapsed', (req, res) => {
    const { message_id, collapsed } = req.body;
    
    updateMessageCollapsedState(message_id, collapsed, (err) => {
        if (err) {
            console.error('Error updating message collapsed state:', err);
            return res.json({ success: false, message: 'Error updating message collapsed state' });
        }
        res.json({ success: true });
    });
});

// Add these before the WebSocketServer setup

// Endpoint to create a new group
app.post('/create-group', (req, res) => {
  const { group_name } = req.body;
  const username = req.cookies.username;
  
  getUser(username, (err, user) => {
    if (err || !user) {
      return res.json({ success: false, message: 'User not found' });
    }
    
    createGroup(user.id, username, group_name, (err, groupId) => {
      if (err) {
        console.error('Error creating group:', err);
        return res.json({ success: false, message: 'Could not create group' });
      }
      res.json({ success: true, group_id: groupId });
    });
  });
});

// Endpoint to delete a group
app.delete('/delete-group', (req, res) => {
  const group_id = req.query.group_id;
  
  deleteGroup(group_id, (err) => {
    if (err) {
      console.error('Error deleting group:', err);
      return res.json({ success: false, message: 'Could not delete group' });
    }
    res.json({ success: true, message: 'Group deleted successfully' });
  });
});

// Endpoint to get all groups for a user
app.get('/groups', (req, res) => {
  const username = req.cookies.username;
  
  getUser(username, (err, user) => {
    if (err || !user) {
      return res.json({ success: false, message: 'User not found' });
    }
    
    getUserGroups(user.id, (err, groups) => {
      if (err) {
        console.error('Error fetching groups:', err);
        return res.json({ success: false, message: 'Could not retrieve groups' });
      }
      res.json({ success: true, groups });
    });
  });
});

// Endpoint to update a session's group
app.post('/update-session-group', (req, res) => {
  const { session_id, group_id } = req.body;
  
  updateSessionGroup(session_id, group_id, (err) => {
    if (err) {
      console.error('Error updating session group:', err);
      return res.json({ success: false, message: 'Could not update session group' });
    }
    res.json({ success: true });
  });
});

// Add this alongside the other group endpoints

// Endpoint to rename a group
// Add checkAuth specifically to this endpoint
app.post('/rename-group', checkAuth, (req, res) => {
  const { group_id, group_name } = req.body;
  
  renameGroup(group_id, group_name, (err) => {
    if (err) {
      console.error('Error renaming group:', err);
      return res.json({ success: false, message: 'Could not rename group' });
    }
    res.json({ success: true });
  });
});


app.use(checkAuth);
app.use(express.static(path.join(path.resolve(), 'public')));

const server = app.listen(port, () => {
    console.log(`HTTP server running at http://localhost:${port}`);
});

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
            await new Promise((resolve) => {
                saveMessageWithScaleLevel(this.session_id, this.username, 'assistant', botMessageContent, shouldCollapse, scaleLevel, async (err, messageId) => {
                    if (err) {
                        console.error('Error saving bot message:', err);
                        resolve();
                        return;
                    }
                    console.log(`Assistant message saved to session ID: ${this.session_id} with collapsed state: ${shouldCollapse} and scale_level: ${scaleLevel}; message_id=${messageId}`);

                    // Step 4: Generate feedback if scale level is 3 or above, now including message_id
                    if (scaleLevels.some(level => level >= 3)) {
                        const feedback = await this.generateFeedback(userMessage.content);
                        if (feedback) {
                            this.ws.send(JSON.stringify({ type: 'feedback', content: feedback, message_id: messageId }));
                        }
                    }
                    resolve();
                });
            });
        } catch (error) {
            console.error('Error during OpenAI API call or streaming:', error);
        }
    }

    addUserMessage(userMessage) {
        if (userMessage.content) {
            this.conversationHistory.push({ role: "user", content: userMessage.content });
            saveMessageWithScaleLevel(this.session_id, this.username, 'user', userMessage.content, 0, 1, (err) => {
                if (err) {
                    console.error('Error saving user message:', err);
                } else {
                    console.log(`User message saved to session ID: ${this.session_id}`);
                }
            });
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
            saveScaleLevel(this.session_id, this.username, scaleLevel, (err) => {
                if (err) {
                    console.error('Error saving scale level:', err);
                }
            });
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

wss.on('connection', (ws, req) => {
    let session_id = null;
    let conversationHistory = [];

    const cookies = req.headers.cookie;
    const username = cookies.split(';').find(c => c.trim().startsWith('username=')).split('=')[1];

    if (!username) {
        console.error('Username not found in cookies. Cannot proceed with session.');
        ws.close();
        return;
    }

    ws.on('message', async (message) => {
        const userMessage = JSON.parse(message);

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
                    processor.addUserMessage(userMessage);
                    await processor.processUserMessage(userMessage);
                } else {
                    // Send a richer history payload including DB-backed messages, feedback and scale levels
                    const [messages, feedbackData, scaleRows] = await Promise.all([
                        new Promise((res) => getMessages(session_id, (e, rows) => res(e ? [] : rows))),
                        new Promise((res) => getFeedback(session_id, (e, rows) => res(e ? [] : rows))),
                        new Promise((res) => getScaleLevels(session_id, (e, rows) => res(e ? [] : rows)))
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
                    createSession(username, username, `Session ${session_id}`, async (err, newSessionId) => {
                        if (err) {
                            console.error('Error creating session:', err);
                            return;
                        }
                        session_id = newSessionId;
                        const processor = new ChatGPTProcessor(openai, ws, session_id, conversationHistory, username);
                        processor.addUserMessage(userMessage);
                        await processor.processUserMessage(userMessage);
                    });
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


console.log('WebSocket server running with HTTP server on ws://localhost:3000');

async function loadSessionHistory(session_id) {
    return new Promise((resolve, reject) => {
        console.log('Loading session history for session_id:', session_id);
        getMessages(session_id, (err, messages) => {
            if (err) {
                console.error('Error loading session history:', err);
                return reject(err);
            }
            console.log('Messages retrieved:', messages);
            resolve(messages);
        });
    });
}
