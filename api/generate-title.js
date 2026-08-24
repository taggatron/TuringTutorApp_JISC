import { generateSessionTitle } from './utils/azureOpenAI.js';

export const config = {
    runtime: 'nodejs',
    maxDuration: 30
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

    const { prompt, session_id } = req.body || {};

    if (!prompt) {
        return res.status(400).json({ success: false, message: 'Missing prompt' });
    }

    try {
        const title = await generateSessionTitle(prompt);
        if (title) {
            return res.status(200).json({ success: true, title, session_name: title, session_id });
        }
        return res.status(200).json({ success: false, message: 'Could not generate session title' });
    } catch (err) {
        console.error('Error in /api/generate-title:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}
