import { callAzureOpenAI, sanitizeContent, assessScaleLevel, generateAlternativePrompt, generateSessionTitle } from './utils/azureOpenAI.js';

export const config = {
    runtime: 'nodejs',
    maxDuration: 60
};

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { content, conversationHistory = [], session_id, is_turing = false } = req.body || {};

    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Missing message content' });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const styleSystemPrompt = `You are a professional assistant that MUST return only well-formed HTML fragments (no Markdown, no surrounding <html>/<body> tags).

RENDERING RULES (strict):
- Return valid HTML only. Use semantic tags (h1,h2,h3,p,ul,li,strong,em,br) where appropriate.
- Do NOT include the literal word "Title:" or any leading label before the title. Output the title as an <h1> element (for example: <h1>Albert Einstein: ...</h1>).
- Do NOT include Markdown markers (###, **, __, _), nor plain-text label lines like "Body" or "Introduction"; instead use appropriate heading tags and paragraphs.
- Use inline Unicode emojis if helpful (⚡, 🧠, 💡).
- Avoid inline <style> tags, scripts, or event attributes. Keep markup simple and semantic.
- Do not emit horizontal rules of repeated hyphens ("---"); use <hr/> if a separator is needed.

Return only the HTML fragment for the requested response — nothing else (no commentary, no surrounding text).`;

        const MAX_MESSAGE_CHARS = 4000;
        const MAX_HISTORY_CHARS = 15000;
        const cleanUserContent = sanitizeContent(content, MAX_MESSAGE_CHARS);

        const sanitizedHistory = [];
        let acc = 0;
        for (let i = conversationHistory.length - 1; i >= 0; i--) {
            const m = conversationHistory[i];
            if (!m || !m.content) continue;
            const cleaned = sanitizeContent(m.content, MAX_MESSAGE_CHARS);
            if (acc + cleaned.length > MAX_HISTORY_CHARS) break;
            sanitizedHistory.unshift({ role: m.role || 'user', content: cleaned });
            acc += cleaned.length;
        }

        const messages = [
            { role: 'system', content: styleSystemPrompt },
            ...sanitizedHistory,
            { role: 'user', content: cleanUserContent }
        ];

        const streamRes = await callAzureOpenAI({ messages, stream: true });

        // Stream assistant response chunks
        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullBotContent = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep remainder
            for (const line of lines) {
                if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
                    try {
                        const data = JSON.parse(line.slice(6));
                        let deltaText = '';
                        if (data.type === 'response.content_part.added' && data.part && data.part.text) {
                            deltaText = data.part.text;
                        } else if (data.type === 'response.output_text.delta' && typeof data.delta === 'string') {
                            deltaText = data.delta;
                        } else if (data.choices && data.choices[0]?.delta?.content) {
                            deltaText = data.choices[0].delta.content;
                        }
                        if (deltaText) {
                            fullBotContent += deltaText;
                            const looksLikeHtml = /<\s*\w+[^>]*>/i.test(deltaText);
                            const format = looksLikeHtml ? 'html' : 'markdown';
                            sendEvent({ type: 'assistant', content: deltaText, format });
                        }
                    } catch (_) {}
                }
            }
        }

        // Assess scale level
        const scaleLevels = await assessScaleLevel(content);
        sendEvent({ type: 'scale', data: scaleLevels });

        const scaleLevel = scaleLevels[0] || 1;

        // Generate alternative prompt / feedback if scale level >= 3 and not in Turing mode
        if (!is_turing && scaleLevel >= 3) {
            const alt = await generateAlternativePrompt(content);
            if (alt) {
                sendEvent({
                    type: 'feedback',
                    content: alt,
                    message_id: 'client_' + Date.now(),
                    format: 'markdown'
                });
            }
        }

        // Check if session needs auto-titling (if session has <= 1 user message)
        const isFirstMessage = conversationHistory.filter(m => m.role === 'user').length <= 1;
        if (isFirstMessage) {
            const title = await generateSessionTitle(cleanUserContent);
            if (title) {
                sendEvent({
                    type: 'session-renamed',
                    session_id: session_id,
                    session_name: title,
                    title: title
                });
            }
        }

        sendEvent({ type: 'done', fullContent: fullBotContent });
        res.end();
    } catch (err) {
        console.error('Error in /api/chat:', err);
        sendEvent({ type: 'error', message: err.message || 'Internal Server Error' });
        res.end();
    }
}
